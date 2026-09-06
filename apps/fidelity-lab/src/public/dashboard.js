import { MirroredInputGate } from "/inputGate.mjs";

const $ = (selector) => document.querySelector(selector);
const nativeCanvas = $("#native-canvas");
const portCanvas = $("#port-canvas");
const compositeCanvas = $("#composite-canvas");
const portLiveVideo = $("#port-live-video");
const canvases = [nativeCanvas, portCanvas, compositeCanvas];
const contexts = new Map(canvases.map((canvas) => [canvas, canvas.getContext("2d")]));
const comparison = $("#comparison");
const observations = $("#observations");
const metrics = $("#metrics");
const differenceA = document.createElement("canvas");
const differenceB = document.createElement("canvas");
differenceA.width = differenceB.width = 480;
differenceA.height = differenceB.height = 320;
const differenceContextA = differenceA.getContext("2d", { willReadFrequently: true });
const differenceContextB = differenceB.getContext("2d", { willReadFrequently: true });
// Reused rather than allocated per composite: the heat map redraws continuously.
const differenceScratch = document.createElement("canvas");
differenceScratch.width = 480;
differenceScratch.height = 320;
const differenceScratchContext = differenceScratch.getContext("2d");

let nativeImage;
let portImage;
const nativeLiveImage = new Image();
const portLiveImage = new Image();
let portVideoPeer;
let portVideoConnectionId;
let portVideoReady = false;
let portVideoGeneration = 0;
let portVideoFrames = 0;
let portVideoFrameTimes = [];
let portVideoLastReportAt = 0;
let portFallbackConnected = false;
let status;
let recording = false;
let frameSerial = 0;
let lastLoadedCaptureAt = 0;
let stableDifferenceFrames = 0;
let lastAutomaticNotice = 0;
let latestComparison = { available: false };
let renderedTaskId;
let renderedEvidenceKey;
let latestDifference;
let lastDifferenceAt = 0;
const activePointers = new Map();
// Normalized coordinates describe the frame the operator clicked, so a gesture captured while a
// previous one is still changing scenes cannot be replayed later safely. Keep one in flight and
// reject stale attempts instead of buffering them behind the HTTP request.
const mirroredInputGate = new MirroredInputGate();
const stateDifferenceStability = new Map();
const reportedStateDifferences = new Set();
let reportedDegradedGesture;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`);
  return body;
}

function baseInputHint() {
  if (status?.nativeInput === "scripted") {
    return "The task clock schedules each port input against the matching TouchHLE script timestamp. Dashboard gestures are disabled while that synchronized task owns input.";
  }
  if (status?.nativeInput === "harness") {
    return "Drag or tap either game surface. TouchHLE receives the mirrored gesture through its background harness without moving your cursor or taking foreground focus.";
  }
  if (status?.native?.captureMode === "framebuffer") {
    return "Drag or tap either game surface. On release, the gesture is mirrored to both games and your cursor and dashboard focus are restored automatically.";
  }
  return "Drag or tap either visible game surface. On release, the gesture is mirrored to both games and your cursor and dashboard focus are restored automatically.";
}

function remoteInputBusy() {
  return status?.replaying === true || status?.task?.running === true ||
    ["preparing", "replaying"].includes(status?.inputSync?.state);
}

function renderInputGate() {
  const locked = mirroredInputGate.busy || remoteInputBusy();
  comparison.dataset.inputState = mirroredInputGate.state;
  comparison.classList.toggle("input-locked", locked);
  for (const canvas of canvases) canvas.setAttribute("aria-busy", String(locked));
  $("#input-mode-hint").textContent = mirroredInputGate.state === "capturing"
    ? "Finish this gesture to mirror it to both panels. A second pointer cannot join the gesture."
    : mirroredInputGate.state === "mirroring"
      ? "Mirroring this gesture to both panels… wait for Input to return to synced before clicking again."
      : remoteInputBusy()
        ? "Another synchronized input sequence owns both panels. Wait for Input to return to synced."
        : baseInputHint();
}

function rejectBusyPointer() {
  comparison.classList.remove("input-rejected");
  void comparison.offsetWidth;
  comparison.classList.add("input-rejected");
  setTimeout(() => comparison.classList.remove("input-rejected"), 180);
}

function sendMirroredGesture(gesture) {
  renderInputGate();
  void api("/api/gesture", { method: "POST", body: JSON.stringify(gesture) })
    .then((result) => {
      if (status !== undefined && result.inputSync !== undefined) status.inputSync = result.inputSync;
    })
    .catch((error) => addObservation({
      severity: "error",
      kind: "mirrored-input-failed",
      message: `Mirrored gesture failed: ${String(error)}`,
    }))
    .finally(() => {
      mirroredInputGate.complete();
      renderInputGate();
    });
}

const loadImage = (url) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = reject;
  image.src = `${url}?v=${frameSerial}`;
});

function connectLiveImage(image, url) {
  image.onerror = () => {
    image.removeAttribute("src");
    setTimeout(() => { image.src = `${url}?v=${Date.now()}`; }, 750);
  };
  image.src = `${url}?v=${Date.now()}`;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitForIceGathering(peer, timeoutMs = 5_000) {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", changed);
      resolve();
    }
    function changed() {
      if (peer.iceGatheringState === "complete") done();
    }
    peer.addEventListener("icegatheringstatechange", changed);
  });
}

function measuredPortVideoFps(now) {
  portVideoFrameTimes = portVideoFrameTimes.filter((capturedAt) => capturedAt >= now - 2_000);
  if (portVideoFrameTimes.length < 2) return 0;
  return (portVideoFrameTimes.length - 1) * 1_000 /
    (portVideoFrameTimes.at(-1) - portVideoFrameTimes[0]);
}

function reportPortVideo(now) {
  if (portVideoConnectionId === undefined || now - portVideoLastReportAt < 500) return;
  portVideoLastReportAt = now;
  const state = ["new", "checking"].includes(portVideoPeer?.connectionState)
    ? "connecting"
    : portVideoPeer?.connectionState ?? "disconnected";
  void api("/api/live/port/stats", {
    method: "POST",
    body: JSON.stringify({
      id: portVideoConnectionId,
      state,
      frames: portVideoFrames,
      deliveredFps: measuredPortVideoFps(now),
    }),
  }).catch(() => undefined);
}

function observePortVideoFrames() {
  const generation = ++portVideoGeneration;
  let lastCurrentTime = -1;
  const observed = (now) => {
    if (generation !== portVideoGeneration) return;
    portVideoReady = true;
    portVideoFrames++;
    portVideoFrameTimes.push(now);
    contexts.get(portCanvas).clearRect(0, 0, portCanvas.width, portCanvas.height);
    reportPortVideo(now);
  };
  if (typeof portLiveVideo.requestVideoFrameCallback === "function") {
    const next = (now) => {
      observed(now);
      portLiveVideo.requestVideoFrameCallback(next);
    };
    portLiveVideo.requestVideoFrameCallback(next);
    return;
  }
  const next = (now) => {
    if (generation !== portVideoGeneration) return;
    if (portLiveVideo.currentTime !== lastCurrentTime) {
      lastCurrentTime = portLiveVideo.currentTime;
      observed(now);
    }
    requestAnimationFrame(next);
  };
  requestAnimationFrame(next);
}

function connectPortFallback(error) {
  if (portFallbackConnected) return;
  portFallbackConnected = true;
  portVideoReady = false;
  portVideoGeneration++;
  portVideoPeer?.close();
  portVideoPeer = undefined;
  portLiveVideo.srcObject = null;
  connectLiveImage(portLiveImage, "/api/live/port.mjpeg");
  if (error !== undefined) addObservation({
    severity: "warning",
    kind: "port-video-fallback",
    message: `Direct canvas video was unavailable; using the lower-rate screencast fallback. ${String(error)}`,
  }, false);
}

async function connectDirectPortVideo() {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt++) {
    let peer;
    try {
      const remote = await api("/api/live/port/offer");
      peer = new RTCPeerConnection({ iceServers: [] });
      const receivedStream = new Promise((resolve) => {
        peer.addEventListener("track", (event) => {
          resolve(event.streams[0] ?? new MediaStream([event.track]));
        }, { once: true });
      });
      await peer.setRemoteDescription(remote.offer);
      await peer.setLocalDescription(await peer.createAnswer());
      await waitForIceGathering(peer);
      await api("/api/live/port/answer", {
        method: "POST",
        body: JSON.stringify({
          id: remote.id,
          answer: { type: peer.localDescription.type, sdp: peer.localDescription.sdp },
        }),
      });
      const stream = await Promise.race([
        receivedStream,
        wait(5_000).then(() => { throw new Error("Direct port video produced no track"); }),
      ]);
      portVideoPeer?.close();
      portVideoPeer = peer;
      portVideoConnectionId = remote.id;
      portVideoFrames = 0;
      portVideoFrameTimes = [];
      portVideoLastReportAt = 0;
      portLiveVideo.srcObject = stream;
      await portLiveVideo.play();
      observePortVideoFrames();
      peer.addEventListener("connectionstatechange", () => {
        if (["failed", "closed"].includes(peer.connectionState) && peer === portVideoPeer) {
          connectPortFallback(`WebRTC connection ${peer.connectionState}`);
        }
      });
      return;
    } catch (error) {
      lastError = error;
      peer?.close();
      const canvasIsStarting = String(error).includes("has not mounted its Pixi canvas yet");
      if (!canvasIsStarting && attempt >= 1) break;
      await wait(250);
    }
  }
  connectPortFallback(lastError);
}

async function connectPortViewer() {
  try {
    const initial = status ?? await api("/api/status");
    if (initial.viewerMode === "wait" || typeof RTCPeerConnection !== "function") {
      connectPortFallback();
      return;
    }
    await connectDirectPortVideo();
  } catch (error) {
    connectPortFallback(error);
  }
}

function disconnectLiveImages() {
  const blank = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
  portFallbackConnected = true;
  for (const image of [nativeLiveImage, portLiveImage]) {
    image.onerror = null;
    image.src = blank;
  }
  portVideoGeneration++;
  portVideoReady = false;
  portVideoPeer?.close();
  portVideoPeer = undefined;
  portLiveVideo.srcObject = null;
}

const readyImage = (liveImage, evidenceImage) =>
  liveImage.naturalWidth > 0 && liveImage.naturalHeight > 0 ? liveImage : evidenceImage;

const readyPortSource = () => portVideoReady && portLiveVideo.videoWidth > 0
  ? portLiveVideo
  : readyImage(portLiveImage, portImage);

function setStatus(element, label, ok, detail = "") {
  element.textContent = detail ? `${label}: ${detail}` : label;
  element.className = `status ${ok ? "ok" : "bad"}`;
}

function drawSource(canvas, image) {
  const context = contexts.get(canvas);
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (image) context.drawImage(image, 0, 0, canvas.width, canvas.height);
}

function calculateDifference(nativeSource = readyImage(nativeLiveImage, nativeImage), portSource = readyPortSource()) {
  if (!$("#auto-diff").checked && $("#view-mode").value !== "diff") return undefined;
  if (!nativeSource || !portSource) return undefined;
  differenceContextA.drawImage(nativeSource, 0, 0, 480, 320);
  differenceContextB.drawImage(portSource, 0, 0, 480, 320);
  const nativePixels = differenceContextA.getImageData(0, 0, 480, 320).data;
  const portPixels = differenceContextB.getImageData(0, 0, 480, 320).data;
  const threshold = Number($("#threshold").value);
  const tileWidth = 30;
  const tileHeight = 20;
  const columns = 16;
  const rows = 16;
  const tileMismatches = new Uint32Array(columns * rows);
  let mismatches = 0;
  let deltaTotal = 0;
  for (let y = 0; y < 320; y++) {
    for (let x = 0; x < 480; x++) {
      const index = (y * 480 + x) * 4;
      const dr = Math.abs(nativePixels[index] - portPixels[index]);
      const dg = Math.abs(nativePixels[index + 1] - portPixels[index + 1]);
      const db = Math.abs(nativePixels[index + 2] - portPixels[index + 2]);
      const delta = Math.max(dr, dg, db);
      deltaTotal += delta;
      if (delta > threshold) {
        mismatches++;
        const tileX = Math.min(columns - 1, Math.floor(x / tileWidth));
        const tileY = Math.min(rows - 1, Math.floor(y / tileHeight));
        tileMismatches[tileY * columns + tileX]++;
      }
    }
  }
  const hotspots = [...tileMismatches.entries()]
    .map(([index, count]) => ({
      x: (index % columns) * tileWidth * 2,
      y: Math.floor(index / columns) * tileHeight * 2,
      w: tileWidth * 2,
      h: tileHeight * 2,
      ratio: count / (tileWidth * tileHeight),
    }))
    .filter((tile) => tile.ratio >= 0.2)
    .sort((left, right) => right.ratio - left.ratio)
    .slice(0, 8);
  return {
    mismatchRatio: mismatches / (480 * 320),
    meanDelta: deltaTotal / (480 * 320),
    hotspots,
    nativePixels,
    portPixels,
  };
}

function drawComposite(difference, nativeSource = readyImage(nativeLiveImage, nativeImage), portSource = readyPortSource()) {
  const context = contexts.get(compositeCanvas);
  context.clearRect(0, 0, compositeCanvas.width, compositeCanvas.height);
  const mode = $("#view-mode").value;
  const blend = Number($("#blend").value) / 100;
  if (!nativeSource || !portSource) return;
  if (mode === "wipe") {
    context.drawImage(nativeSource, 0, 0, compositeCanvas.width, compositeCanvas.height);
    context.save();
    context.beginPath();
    context.rect(0, 0, compositeCanvas.width * blend, compositeCanvas.height);
    context.clip();
    context.drawImage(portSource, 0, 0, compositeCanvas.width, compositeCanvas.height);
    context.restore();
    context.fillStyle = "#ffffff";
    context.fillRect(compositeCanvas.width * blend - 1, 0, 2, compositeCanvas.height);
    return;
  }
  if (mode === "overlay") {
    context.globalAlpha = 1;
    context.drawImage(nativeSource, 0, 0, compositeCanvas.width, compositeCanvas.height);
    context.globalAlpha = blend;
    context.drawImage(portSource, 0, 0, compositeCanvas.width, compositeCanvas.height);
    context.globalAlpha = 1;
    return;
  }
  if (mode === "diff" && difference) {
    context.globalAlpha = 0.22;
    context.drawImage(nativeSource, 0, 0, compositeCanvas.width, compositeCanvas.height);
    context.globalAlpha = 1;
    const output = context.createImageData(480, 320);
    for (let index = 0; index < output.data.length; index += 4) {
      const delta = Math.max(
        Math.abs(difference.nativePixels[index] - difference.portPixels[index]),
        Math.abs(difference.nativePixels[index + 1] - difference.portPixels[index + 1]),
        Math.abs(difference.nativePixels[index + 2] - difference.portPixels[index + 2]),
      );
      output.data[index] = Math.min(255, delta * 3);
      output.data[index + 1] = delta > 80 ? 24 : Math.min(180, delta);
      output.data[index + 2] = delta > 30 ? 32 : 0;
      output.data[index + 3] = Math.min(230, delta * 4);
    }
    differenceScratchContext.putImageData(output, 0, 0);
    context.drawImage(differenceScratch, 0, 0, 960, 640);
    for (const hotspot of difference.hotspots) {
      context.strokeStyle = "rgba(255, 226, 91, .9)";
      context.lineWidth = 2;
      context.strokeRect(hotspot.x, hotspot.y, hotspot.w, hotspot.h);
    }
  }
}

function addObservation(observation, persist = true) {
  const item = document.createElement("li");
  item.className = observation.severity ?? "notice";
  item.textContent = `${new Date().toLocaleTimeString()} · ${observation.message}`;
  observations.prepend(item);
  while (observations.children.length > 40) observations.lastElementChild.remove();
  if (persist) void api("/api/observation", { method: "POST", body: JSON.stringify(observation) });
}

function updateDifference(difference) {
  if (!difference) {
    latestComparison = { available: false };
    metrics.textContent = "Pixel analysis paused\nEnable Live pixel analysis or select Difference heat map.";
    setStatus($("#diff-status"), "Diff", true, "paused");
    return;
  }
  latestComparison = {
    available: true,
    mismatchRatio: difference.mismatchRatio,
    meanDelta: difference.meanDelta,
    hotspots: difference.hotspots,
  };
  const ratioPercent = difference.mismatchRatio * 100;
  metrics.textContent = `changed pixels  ${ratioPercent.toFixed(2)}%\nmean RGB delta  ${difference.meanDelta.toFixed(1)}\nhot regions     ${difference.hotspots.length}`;
  const noticeAt = Number($("#notice-ratio").value);
  const required = Number($("#stable-frames").value);
  if (ratioPercent >= noticeAt) stableDifferenceFrames++;
  else stableDifferenceFrames = 0;
  const notable = stableDifferenceFrames >= required;
  setStatus($("#diff-status"), "Diff", !notable,
    notable ? `${ratioPercent.toFixed(1)}% stable` : `${ratioPercent.toFixed(1)}%`);
  if (notable && Date.now() - lastAutomaticNotice > 5_000) {
    lastAutomaticNotice = Date.now();
    addObservation({
      severity: "warning",
      kind: "stable-visual-difference",
      mismatchRatio: difference.mismatchRatio,
      meanDelta: difference.meanDelta,
      hotspots: difference.hotspots,
      message: `Noticeable visual difference persisted for ${required} samples (${ratioPercent.toFixed(2)}% changed).`,
    });
  }
}

function renderEvidence(evidence) {
  const items = [...(evidence?.task ?? []), ...(evidence?.manual ? [evidence.manual] : [])];
  const key = JSON.stringify(items.map(({ id, directory }) => [id, directory]));
  if (key === renderedEvidenceKey) return;
  renderedEvidenceKey = key;
  const gallery = $("#evidence-gallery");
  gallery.replaceChildren();
  $("#evidence-panel").classList.toggle("hidden", items.length === 0);
  for (const item of items) {
    const card = document.createElement("article");
    card.className = "evidence-card";
    const title = document.createElement("h3");
    title.textContent = `${item.pass === false ? "Failed" : "Captured"} · ${item.label}`;
    const pair = document.createElement("div");
    pair.className = "evidence-pair";
    for (const [label, source] of [["TouchHLE", item.nativeUrl], ["Web port", item.portUrl]]) {
      const figure = document.createElement("figure");
      const image = document.createElement("img");
      image.src = `${source}?v=${Date.now()}`;
      image.alt = `${label} ${item.label}`;
      const caption = document.createElement("figcaption");
      caption.textContent = label;
      figure.append(image, caption);
      pair.append(figure);
    }
    const directory = document.createElement("div");
    directory.className = "evidence-path";
    directory.textContent = item.directory;
    card.append(title, pair, directory);
    gallery.append(card);
  }
  if (items.length > 0) setTimeout(() => $("#evidence-panel").scrollIntoView({ behavior: "smooth", block: "start" }), 50);
}

async function refresh() {
  try {
    status = await api("/api/status");
    if (status.launcherUrl && status.sessionId) {
      $("#session-actions").classList.remove("hidden");
      $("#new-comparison").href = status.launcherUrl;
    }
    renderInputGate();
    const nativeStream = status.liveStreams?.native;
    const portStream = status.liveStreams?.port;
    const streamDetail = (stream) => stream?.deliveredFps > 0
      ? `${stream.deliveredFps.toFixed(0)} fps`
      : stream?.error ? "stream error" : "stream starting";
    setStatus($("#native-status"), "Native", status.native.connected && nativeStream?.error === undefined,
      status.native.connected ? `${status.native.bounds?.[2]}×${status.native.bounds?.[3]} · ${streamDetail(nativeStream)}` : "disconnected");
    setStatus($("#port-status"), "Port", status.port.connected && portStream?.error === undefined,
      status.port.connected ? `${Math.round(status.port.bounds?.width)}×${Math.round(status.port.bounds?.height)} · ${streamDetail(portStream)}` : "waiting");
    $("#viewer-cadence").textContent = portStream?.pairing === "native-source-time"
      ? `Viewer source-time paired · native ${nativeStream?.deliveredFps ?? 0} / port ${portStream?.deliveredFps ?? 0} fps · ` +
        `latest source skew ${Math.round(portStream?.latestPairSkewMs ?? 0)}ms · evidence/state ${status.captureFps} fps`
      : portStream?.transport === "canvas-webrtc"
        ? `Viewer direct canvas · native ${nativeStream?.deliveredFps ?? 0} / port ${portStream?.deliveredFps ?? 0} presented fps · ` +
          `${portStream?.renderer ?? "renderer pending"} · evidence/state ${status.captureFps} fps`
        : `Viewer screencast fallback · native ${nativeStream?.deliveredFps ?? 0} / port ${portStream?.deliveredFps ?? 0} fps · ` +
          `evidence/state ${status.captureFps} fps`;
    const inputSkewLimit = status.inputSync?.mode === "live" ? 32 : 100;
    const degraded = status.inputSync?.state === "degraded";
    const inputOk = !degraded && (status.inputSync?.state !== "synced" ||
      status.inputSync.maxSkewMs === undefined || status.inputSync.maxSkewMs <= inputSkewLimit);
    setStatus($("#input-status"), "Input", mirroredInputGate.busy || inputOk,
      mirroredInputGate.state === "capturing"
        ? "capturing one gesture"
        : mirroredInputGate.state === "mirroring"
          ? "mirroring to both panels"
          : degraded
        ? `${status.inputSync.droppedNativePhases ?? 0} phase(s) not delivered natively`
        : status.inputSync?.state === "synced"
          ? `±${Math.round(status.inputSync.maxSkewMs ?? 0)}ms`
          : status.inputSync?.state ?? "idle");
    const rngSync = status.rngSync;
    const rngComparable = rngSync?.native !== undefined && rngSync?.port !== undefined;
    const anchorCorrection = rngSync?.lastAnchor?.portBefore?.correction;
    const rngAligned = rngComparable && rngSync.drift === 0 && rngSync.stateMatches &&
      (anchorCorrection === undefined || anchorCorrection === 0);
    const rngDetail = !rngComparable
      ? "waiting for patched ACK"
      : `native ${rngSync.native.calls} / port ${rngSync.port.calls} ` +
        `(drift ${rngSync.drift >= 0 ? "+" : ""}${rngSync.drift}, ` +
        `last anchor correction ${anchorCorrection === undefined
          ? "unknown"
          : `${anchorCorrection >= 0 ? "+" : ""}${anchorCorrection}`}, ${rngSync.native.source})`;
    setStatus($("#rng-status"), "RNG", !rngComparable || rngAligned, rngDetail);
    if (degraded && status.inputSync.id !== reportedDegradedGesture) {
      reportedDegradedGesture = status.inputSync.id;
      addObservation({
        severity: "error",
        kind: "one-sided-input-phase",
        inputSync: status.inputSync,
        message: `TouchHLE did not accept ${status.inputSync.droppedNativePhases ?? 0} phase(s) of ` +
          `gesture ${status.inputSync.id ?? "?"}; the port received them. ` +
          `${status.inputSync.recoveredRelease ? "A release was synthesized to clear the press. " : ""}` +
          `${status.inputSync.error ?? ""}`.trim(),
      });
    }
    // The failure reason outranks the snapshot. A port that stops answering keeps its last state
    // available as context, but never presents it as the live one.
    $("#port-state").textContent = status.port.error !== undefined
      ? `${status.port.error}\n\nLast state before the port stopped answering:\n${
        status.port.lastState === undefined
          ? "(none)"
          : JSON.stringify(status.port.lastState, null, 2)}`
      : status.port.state
        ? JSON.stringify(status.port.state, null, 2)
        : "Waiting for render_game_to_text…";
    $("#native-state").textContent = status.native.scene
      ? JSON.stringify(status.native.scene, null, 2)
      : status.native.error ?? "No complete HSCENE dump has been observed.";
    $("#dungeon-topology").textContent = status.dungeonTopology
      ? JSON.stringify(status.dungeonTopology, null, 2)
      : "Enter a dungeon to accumulate native RoomNodes.";
    $("#browser-errors").textContent = status.browserErrors.length > 0
      ? status.browserErrors.join("\n")
      : "None";
    renderEvidence(status.evidence);
    const loadedTask = status.task?.loaded;
    if (loadedTask?.id !== renderedTaskId) {
      renderedTaskId = loadedTask?.id;
      $("#task-title").textContent = loadedTask?.title ?? "No automated task in this session";
      $("#task-purpose").textContent = loadedTask?.purpose ?? "Use live controls here, or start an Automated task from the setup dashboard.";
      $("#task-review").replaceChildren(...(loadedTask?.reviewFocus ?? []).map((focus) => {
        const item = document.createElement("li");
        item.textContent = focus;
        return item;
      }));
    }
    const scriptedComplete = status.nativeInput === "scripted" && status.task.lastResult !== undefined;
    $("#run-task").disabled = loadedTask === undefined || status.task.running || scriptedComplete;
    $("#run-task").textContent = status.task.running
      ? "Task running…"
      : scriptedComplete ? "Completed · start a new session to rerun" : "Run loaded task";
    $("#task-state").textContent = status.task.running
      ? `Running ${status.task.currentStep?.id ?? "startup"} (${status.task.currentStep?.kind ?? ""})`
      : status.task.lastResult
        ? JSON.stringify({
            status: status.task.lastResult.status,
            runDirectory: status.task.lastResult.runDirectory,
            error: status.task.lastResult.error,
            steps: status.task.lastResult.steps.map(({ id, kind, evaluation }) => ({
              id,
              kind,
              pass: evaluation?.pass,
            })),
          }, null, 2)
        : "Idle";
    for (const result of status.stateDifferences ?? []) {
      const count = result.status === "different"
        ? (stateDifferenceStability.get(result.id) ?? 0) + 1
        : 0;
      stateDifferenceStability.set(result.id, count);
      if (count >= 3 && !reportedStateDifferences.has(result.id)) {
        reportedStateDifferences.add(result.id);
        addObservation({
          severity: "error",
          kind: "deterministic-state-difference",
          rule: result,
          message: `${result.label}: port=${result.portValue}, native=${result.nativeValue}; ` +
            `delta ${result.delta} exceeds margin ${result.margin}.`,
        });
      }
      if (result.status !== "different") reportedStateDifferences.delete(result.id);
    }
    if (status.lastCaptureAt > lastLoadedCaptureAt) {
      frameSerial = status.lastCaptureAt;
      [nativeImage, portImage] = await Promise.all([
        status.native.frameReady ? loadImage("/api/frame/native").catch(() => nativeImage) : nativeImage,
        status.port.frameReady ? loadImage("/api/frame/port").catch(() => portImage) : portImage,
      ]);
      lastLoadedCaptureAt = status.lastCaptureAt;
    }
  } catch (error) {
    setStatus($("#diff-status"), "Lab", false, String(error));
  }
}

function normalizedEvent(canvas, event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
  };
}

for (const canvas of canvases) {
  canvas.addEventListener("pointerdown", (event) => {
    if (status?.nativeInput === "scripted") return;
    if (remoteInputBusy() || !mirroredInputGate.begin(event.pointerId)) {
      rejectBusyPointer();
      renderInputGate();
      return;
    }
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (error) {
      mirroredInputGate.cancel(event.pointerId);
      addObservation({
        severity: "error",
        kind: "pointer-capture-failed",
        message: `Could not capture dashboard gesture: ${String(error)}`,
      });
      renderInputGate();
      return;
    }
    activePointers.set(event.pointerId, {
      id: `${Date.now()}-${event.pointerId}`,
      canvas,
      startedAt: performance.now(),
      events: [{ phase: "down", tMs: 0, ...normalizedEvent(canvas, event) }],
    });
    renderInputGate();
  });
  canvas.addEventListener("pointermove", (event) => {
    const gesture = activePointers.get(event.pointerId);
    if (gesture === undefined) return;
    if (gesture.events.length >= 999) return;
    gesture.events.push({
      phase: "move",
      tMs: Math.min(10_000, performance.now() - gesture.startedAt),
      ...normalizedEvent(gesture.canvas, event),
    });
  });
  const release = (event) => {
    const gesture = activePointers.get(event.pointerId);
    if (gesture === undefined) return;
    activePointers.delete(event.pointerId);
    gesture.events.push({
      phase: "up",
      tMs: Math.min(10_000, performance.now() - gesture.startedAt),
      ...normalizedEvent(gesture.canvas, event),
    });
    if (!mirroredInputGate.commit(event.pointerId)) return;
    sendMirroredGesture({ id: gesture.id, events: gesture.events });
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
}

$("#view-mode").addEventListener("change", () => {
  const mode = $("#view-mode").value;
  comparison.className = `comparison ${mode === "side" ? "side" : mode}`;
  $("#composite-title").textContent = ({ wipe: "Port ← wipe → native", overlay: "Overlay", diff: "Difference" })[mode] ?? "Composite";
  latestDifference = calculateDifference();
  updateDifference(latestDifference);
  drawComposite(latestDifference);
});
$("#blend").addEventListener("input", () => drawComposite(latestDifference));
$("#threshold").addEventListener("input", () => {
  latestDifference = calculateDifference();
  updateDifference(latestDifference);
  drawComposite(latestDifference);
});
$("#auto-diff").addEventListener("change", () => {
  latestDifference = calculateDifference();
  updateDifference(latestDifference);
  drawComposite(latestDifference);
});
$("#refresh-frames").addEventListener("click", async () => {
  $("#refresh-frames").disabled = true;
  try {
    await api("/api/capture", { method: "POST", body: "{}" });
    await refresh();
  } finally {
    $("#refresh-frames").disabled = false;
  }
});

$("#record").addEventListener("click", async () => {
  if (!recording) {
    const result = await api("/api/record/start", { method: "POST", body: "{}" });
    recording = true;
    $("#record").textContent = "Stop recording";
    addObservation({ severity: "notice", message: `Recording started: ${result.directory}` }, false);
  } else {
    const result = await api("/api/record/stop", { method: "POST", body: "{}" });
    recording = false;
    $("#record").textContent = "Record macro + frames";
    addObservation({ severity: "notice", message: `Recording stopped (${result.result?.inputs ?? 0} input phases).` }, false);
  }
});
$("#run-task").addEventListener("click", async () => {
  const result = await api("/api/task/run", { method: "POST", body: "{}" });
  addObservation({ severity: "notice", message: `Started machine task ${result.taskId}.` }, false);
});
$("#replay").addEventListener("click", async () => {
  await api("/api/macro/replay", { method: "POST", body: "{}" });
  addObservation({ severity: "notice", message: "Replaying the last mirrored-input macro." }, false);
});
$("#checkpoint").addEventListener("click", async () => {
  const note = $("#checkpoint-note").value;
  const result = await api("/api/checkpoint", {
    method: "POST",
    body: JSON.stringify({ label: "manual", note, comparison: latestComparison }),
  });
  addObservation({ severity: "notice", message: `Checkpoint saved: ${result.directory}` }, false);
});
$("#add-observation").addEventListener("click", () => {
  const input = $("#observation-note");
  const message = input.value.trim();
  if (!message) return;
  addObservation({ severity: $("#severity").value, kind: "manual", message, comparison: latestComparison });
  input.value = "";
});
$("#end-session").addEventListener("click", async () => {
  if (!status?.launcherUrl || !status?.sessionId) return;
  $("#end-session").disabled = true;
  disconnectLiveImages();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await fetch(`${status.launcherUrl}/api/sessions/${encodeURIComponent(status.sessionId)}/stop`, { method: "POST" });
  location.assign(status.launcherUrl);
});

function renderLive(now) {
  const nativeSource = readyImage(nativeLiveImage, nativeImage);
  const portSource = readyPortSource();
  const mode = $("#view-mode").value;
  if (mode === "side") {
    drawSource(nativeCanvas, nativeSource);
    if (portSource === portLiveVideo) {
      contexts.get(portCanvas).clearRect(0, 0, portCanvas.width, portCanvas.height);
    } else {
      drawSource(portCanvas, portSource);
    }
  } else if (mode !== "diff") {
    drawComposite(latestDifference, nativeSource, portSource);
  }
  const analysisEnabled = $("#auto-diff").checked || mode === "diff";
  if (analysisEnabled && now - lastDifferenceAt >= 100) {
    lastDifferenceAt = now;
    latestDifference = calculateDifference(nativeSource, portSource);
    updateDifference(latestDifference);
    if (mode === "diff") drawComposite(latestDifference, nativeSource, portSource);
  }
  requestAnimationFrame(renderLive);
}

connectLiveImage(nativeLiveImage, "/api/live/native.mjpeg");
void connectPortViewer();
updateDifference(undefined);
requestAnimationFrame(renderLive);
setInterval(() => void refresh(), 500);
void refresh();
