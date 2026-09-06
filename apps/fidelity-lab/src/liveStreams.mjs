import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parsePpm } from "./nativeCapture.mjs";

const PORT_BOUNDARY = "dib-port-frame";
const NATIVE_BOUNDARY = "dib-native-frame";

function streamHeaders(boundary) {
  return {
    "content-type": `multipart/x-mixed-replace; boundary=${boundary}`,
    "cache-control": "no-store, no-cache, must-revalidate",
    "x-accel-buffering": "no",
    connection: "close",
  };
}

function frameRate(frameTimes, now = Date.now()) {
  while (frameTimes.length > 0 && frameTimes[0] < now - 2_000) frameTimes.shift();
  if (frameTimes.length < 2) return 0;
  return (frameTimes.length - 1) * 1_000 / (frameTimes.at(-1) - frameTimes[0]);
}

export function nearestFrame(frames, capturedAt) {
  if (frames.length === 0) return undefined;
  let selected = frames[0];
  for (const candidate of frames.slice(1)) {
    if (Math.abs(candidate.capturedAt - capturedAt) < Math.abs(selected.capturedAt - capturedAt)) {
      selected = candidate;
    }
  }
  return selected;
}

export class PortScreencast {
  constructor(cdp, { targetFps = 60, synchronized = false } = {}) {
    this.cdp = cdp;
    this.targetFps = targetFps;
    this.synchronized = synchronized;
    this.clients = new Set();
    this.frameTimes = [];
    this.frames = 0;
    this.capturedFrames = 0;
    this.latestFrame = undefined;
    this.latestPairedFrame = undefined;
    this.frameHistory = [];
    this.latestPairSkewMs = undefined;
    this.error = undefined;
    this.started = false;
    this.onFrame = ({ data, sessionId }) => {
      void this.cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
      const frame = { jpeg: Buffer.from(data, "base64"), capturedAt: Date.now() };
      this.latestFrame = frame;
      this.capturedFrames++;
      if (this.synchronized) {
        this.frameHistory.push(frame);
        if (this.frameHistory.length > 180) this.frameHistory.splice(0, this.frameHistory.length - 180);
      } else {
        this.publish(frame);
      }
    };
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.cdp.on("Page.screencastFrame", this.onFrame);
    try {
      await this.cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: 84,
        maxWidth: 960,
        maxHeight: 640,
        everyNthFrame: 1,
      });
    } catch (error) {
      this.error = String(error);
      throw error;
    }
  }

  writeFrame(client, jpeg) {
    if (!client.ready || client.response.destroyed || client.response.writableEnded) return;
    const header = Buffer.from(
      `--${PORT_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`,
    );
    client.ready = client.response.write(header);
    client.response.write(jpeg);
    client.response.write("\r\n");
  }

  publish(frame) {
    this.frames++;
    this.frameTimes.push(Date.now());
    for (const client of this.clients) this.writeFrame(client, frame.jpeg);
  }

  releaseNearest(nativeCapturedAt) {
    if (!this.synchronized || this.latestFrame === undefined) return;
    const candidates = this.frameHistory.length > 0 ? this.frameHistory : [this.latestFrame];
    const selected = nearestFrame(candidates, nativeCapturedAt);
    if (selected === undefined) return;
    if (selected !== this.latestPairedFrame) {
      this.latestPairSkewMs = selected.capturedAt - nativeCapturedAt;
      this.latestPairedFrame = selected;
    }
    this.publish(selected);
    const retainFrom = Math.max(0, this.frameHistory.indexOf(selected) - 1);
    if (retainFrom > 0) this.frameHistory.splice(0, retainFrom);
  }

  serve(response) {
    response.writeHead(200, streamHeaders(PORT_BOUNDARY));
    const client = { response, ready: true };
    this.clients.add(client);
    response.on("drain", () => { client.ready = true; });
    response.once("close", () => this.clients.delete(client));
    const initial = this.latestPairedFrame ?? (!this.synchronized ? this.latestFrame : undefined);
    if (initial !== undefined) this.writeFrame(client, initial.jpeg);
  }

  status() {
    return {
      available: this.started && this.error === undefined,
      targetFps: this.targetFps,
      deliveredFps: Number(frameRate(this.frameTimes).toFixed(1)),
      frames: this.frames,
      capturedFrames: this.capturedFrames,
      pairing: this.synchronized ? "native-source-time" : "independent",
      latestPairSkewMs: this.latestPairSkewMs,
      clients: this.clients.size,
      error: this.error,
    };
  }

  async close() {
    for (const { response } of this.clients) response.end();
    this.clients.clear();
    if (!this.started) return;
    this.cdp.off("Page.screencastFrame", this.onFrame);
    await this.cdp.send("Page.stopScreencast").catch(() => undefined);
    await this.cdp.detach().catch(() => undefined);
  }
}

/**
 * Runs inside the controlled port page through Playwright's page.evaluate(). Keeping the complete
 * browser-side peer lifecycle in one serializable function prevents the lab worker from depending
 * on browser globals and lets a dashboard reconnect replace a stale peer cleanly.
 */
export async function portCanvasPeerCommand(command) {
  const peers = globalThis.__DIB_FIDELITY_PORT_VIDEO_PEERS__ ??= new Map();
  if (command.action === "close") {
    const selected = command.id === undefined ? [...peers.entries()] : [[command.id, peers.get(command.id)]];
    for (const [id, entry] of selected) {
      if (entry === undefined) continue;
      for (const track of entry.stream.getTracks()) track.stop();
      entry.peer.close();
      peers.delete(id);
    }
    return { closed: true };
  }

  if (command.action === "answer") {
    const entry = peers.get(command.id);
    if (entry === undefined) throw new Error(`Unknown Fidelity Lab port-video peer ${command.id}`);
    await entry.peer.setRemoteDescription(command.answer);
    return { connectionState: entry.peer.connectionState };
  }

  if (command.action !== "offer") throw new Error(`Unknown port-video action ${command.action}`);
  for (const entry of peers.values()) {
    for (const track of entry.stream.getTracks()) track.stop();
    entry.peer.close();
  }
  peers.clear();

  const app = globalThis.__PIXI_APP__;
  const canvas = app?.canvas;
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("The controlled port has not mounted its Pixi canvas yet");
  }
  if (typeof canvas.captureStream !== "function" || typeof RTCPeerConnection !== "function") {
    throw new Error("This controlled browser cannot stream its canvas through WebRTC");
  }

  const stream = canvas.captureStream(command.targetFps);
  const track = stream.getVideoTracks()[0];
  if (track === undefined) throw new Error("Pixi canvas capture produced no video track");
  try { track.contentHint = "motion"; } catch {}
  const peer = new RTCPeerConnection({ iceServers: [] });
  peer.addTrack(track, stream);
  peers.set(command.id, { peer, stream });

  try {
    await peer.setLocalDescription(await peer.createOffer());
    if (peer.iceGatheringState !== "complete") {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          peer.removeEventListener("icegatheringstatechange", changed);
          reject(new Error("Timed out gathering the local port-video ICE candidate"));
        }, 2_000);
        const changed = () => {
          if (peer.iceGatheringState !== "complete") return;
          clearTimeout(timeout);
          peer.removeEventListener("icegatheringstatechange", changed);
          resolve();
        };
        peer.addEventListener("icegatheringstatechange", changed);
      });
    }
    const local = peer.localDescription;
    if (local === null) throw new Error("The controlled port produced no WebRTC offer");
    let renderer;
    try {
      const gl = app?.renderer?.gl;
      const debug = gl?.getExtension("WEBGL_debug_renderer_info");
      renderer = gl === undefined
        ? undefined
        : String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER));
    } catch {}
    return {
      offer: { type: local.type, sdp: local.sdp },
      width: canvas.width,
      height: canvas.height,
      renderer,
    };
  } catch (error) {
    for (const candidate of stream.getTracks()) candidate.stop();
    peer.close();
    peers.delete(command.id);
    throw error;
  }
}

export class PortCanvasWebRtc {
  constructor(page, { targetFps = 60, now = () => Date.now() } = {}) {
    this.page = page;
    this.targetFps = targetFps;
    this.now = now;
    this.serial = 0;
    this.connection = undefined;
    this.frames = 0;
    this.deliveredFps = 0;
    this.error = undefined;
  }

  async createOffer() {
    const id = `port-video-${this.now()}-${++this.serial}`;
    this.error = undefined;
    try {
      const result = await this.page.evaluate(portCanvasPeerCommand, {
        action: "offer",
        id,
        targetFps: this.targetFps,
      });
      this.connection = {
        id,
        state: "offered",
        width: result.width,
        height: result.height,
        renderer: result.renderer,
      };
      this.frames = 0;
      this.deliveredFps = 0;
      return { id, ...result };
    } catch (error) {
      this.error = String(error);
      throw error;
    }
  }

  async acceptAnswer(id, answer) {
    if (this.connection?.id !== id) throw new Error(`Stale Fidelity Lab port-video answer ${id}`);
    if (answer?.type !== "answer" || typeof answer.sdp !== "string") {
      throw new Error("Port-video answer must contain an answer SDP");
    }
    try {
      const result = await this.page.evaluate(portCanvasPeerCommand, { action: "answer", id, answer });
      this.connection.state = result.connectionState ?? "connecting";
      this.error = undefined;
      return result;
    } catch (error) {
      this.error = String(error);
      throw error;
    }
  }

  report(id, { state, frames, deliveredFps }) {
    if (this.connection?.id !== id) return false;
    if (!Number.isSafeInteger(frames) || frames < 0) throw new Error("Port-video frames must be a non-negative integer");
    if (!Number.isFinite(deliveredFps) || deliveredFps < 0 || deliveredFps > 240) {
      throw new Error("Port-video deliveredFps must be in [0, 240]");
    }
    if (!["connecting", "connected", "disconnected", "failed", "closed"].includes(state)) {
      throw new Error(`Unknown port-video connection state ${state}`);
    }
    this.connection.state = state;
    this.frames = frames;
    this.deliveredFps = deliveredFps;
    if (state === "failed") this.error = "The direct canvas video connection failed";
    return true;
  }

  status() {
    return {
      available: this.error === undefined,
      targetFps: this.targetFps,
      deliveredFps: Number(this.deliveredFps.toFixed(1)),
      frames: this.frames,
      capturedFrames: this.frames,
      pairing: "independent",
      transport: "canvas-webrtc",
      clients: this.connection === undefined || this.connection.state === "closed" ? 0 : 1,
      connectionState: this.connection?.state ?? "idle",
      width: this.connection?.width,
      height: this.connection?.height,
      renderer: this.connection?.renderer,
      error: this.error,
    };
  }

  async close() {
    const id = this.connection?.id;
    this.connection = undefined;
    this.frames = 0;
    this.deliveredFps = 0;
    await this.page.evaluate(portCanvasPeerCommand, { action: "close", id }).catch(() => undefined);
  }
}

export function nativeMjpegArguments(bounds, targetFps = 60) {
  const [x, y, width, height] = bounds;
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-f", "gdigrab",
    "-framerate", String(targetFps),
    "-draw_mouse", "0",
    "-offset_x", String(x),
    "-offset_y", String(y),
    "-video_size", `${width}x${height}`,
    "-i", "desktop",
    "-vf", "scale=960:640:flags=fast_bilinear",
    "-an",
    "-c:v", "mjpeg",
    "-q:v", "4",
    "-flush_packets", "1",
    "-f", "mpjpeg",
    "-boundary_tag", NATIVE_BOUNDARY,
    "pipe:1",
  ];
}

export function nativeFramebufferMjpegArguments(targetFps = 60) {
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-f", "image2pipe",
    "-framerate", String(targetFps),
    "-vcodec", "ppm",
    "-i", "pipe:0",
    "-vf", "vflip,scale=960:640:flags=fast_bilinear",
    "-fps_mode", "passthrough",
    "-an",
    "-c:v", "mjpeg",
    "-q:v", "4",
    "-flush_packets", "1",
    "-f", "mpjpeg",
    "-boundary_tag", NATIVE_BOUNDARY,
    "pipe:1",
  ];
}

export class NativeFramebufferStream {
  constructor({ directory, ffmpegPath = "ffmpeg", targetFps = 60, onFrame = () => undefined } = {}) {
    this.directory = directory;
    this.ffmpegPath = ffmpegPath;
    this.targetFps = targetFps;
    this.onFrame = onFrame;
    this.processes = new Set();
    this.frameTimes = [];
    this.frames = 0;
    this.error = undefined;
    this.latestSource = undefined;
    this.latestPublicationLatencyMs = undefined;
  }

  serve(response) {
    response.writeHead(200, streamHeaders(NATIVE_BOUNDARY));
    this.error = undefined;
    const child = spawn(this.ffmpegPath, nativeFramebufferMjpegArguments(this.targetFps), {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.processes.add(child);
    let lastSource;
    const pendingSources = [];
    let inputReady = true;
    let pumpInFlight = false;
    child.stdin.on("drain", () => { inputReady = true; void pump(); });
    child.stdin.on("error", () => undefined);
    const pump = async () => {
      if (pumpInFlight || !inputReady || child.exitCode !== null) return;
      pumpInFlight = true;
      try {
        const names = (await fs.promises.readdir(this.directory))
          .map((name) => ({ name, match: /^frame_(\d+)_\d+ms\.ppm$/i.exec(name) }))
          .filter(({ match }) => match !== null)
          .sort((left, right) => Number(right.match[1]) - Number(left.match[1]));
        for (const { name } of names.slice(0, 3)) {
          const source = path.join(this.directory, name);
          if (source === lastSource) break;
          try {
            const ppm = await fs.promises.readFile(source);
            parsePpm(ppm);
            const stat = await fs.promises.stat(source);
            lastSource = source;
            pendingSources.push({ source, capturedAt: stat.mtimeMs });
            inputReady = child.stdin.write(ppm);
            break;
          } catch {
            // Try a complete predecessor while the newest final filename is partial.
          }
        }
      } catch {
        // The harness exposes its final filename before the current PPM is complete.
      } finally {
        pumpInFlight = false;
      }
    };
    const watcher = fs.watch(this.directory, () => void pump());
    // fs.watch can coalesce events on Windows. Complete frames are atomically renamed into place,
    // and this short fallback prevents a missed rename from becoming visible viewer latency.
    const poll = setInterval(() => void pump(), 16);
    let pumpStopped = false;
    const stopPump = () => {
      if (pumpStopped) return;
      pumpStopped = true;
      clearInterval(poll);
      watcher.close();
    };
    void pump();
    let previousByte;
    child.stdout.on("data", (chunk) => {
      for (let index = 0; index < chunk.length; index++) {
        if (previousByte === 0xff && chunk[index] === 0xd8) {
          this.frames++;
          this.frameTimes.push(Date.now());
        }
        if (previousByte === 0xff && chunk[index] === 0xd9) {
          const source = pendingSources.shift();
          if (source !== undefined) {
            this.latestSource = source.source;
            this.latestPublicationLatencyMs = Date.now() - source.capturedAt;
            setImmediate(() => this.onFrame(source));
          }
        }
        previousByte = chunk[index];
      }
    });
    child.stdout.pipe(response);
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4_000); });
    child.once("error", (error) => { this.error = String(error); });
    child.once("exit", (code) => {
      stopPump();
      this.processes.delete(child);
      if (code !== 0 && code !== null && stderr.trim()) this.error = stderr.trim();
      if (!response.writableEnded) response.end();
    });
    response.once("close", () => {
      stopPump();
      child.stdout.unpipe(response);
      if (child.exitCode === null) child.kill();
    });
  }

  status() {
    return {
      available: this.error === undefined,
      targetFps: this.targetFps,
      deliveredFps: Number(frameRate(this.frameTimes).toFixed(1)),
      frames: this.frames,
      clients: this.processes.size,
      error: this.error,
      source: "framebuffer",
      latestSource: this.latestSource,
      latestPublicationLatencyMs: this.latestPublicationLatencyMs,
    };
  }

  close() {
    for (const child of this.processes) if (child.exitCode === null) child.kill();
    this.processes.clear();
  }
}

export class NativeWindowStream {
  constructor({ ffmpegPath = "ffmpeg", targetFps = 60 } = {}) {
    this.ffmpegPath = ffmpegPath;
    this.targetFps = targetFps;
    this.processes = new Set();
    this.frameTimes = [];
    this.frames = 0;
    this.error = undefined;
  }

  serve(response, bounds) {
    if (!Array.isArray(bounds) || bounds.length !== 4) {
      response.writeHead(503, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      response.end("TouchHLE window is not attached yet");
      return;
    }
    this.error = undefined;
    response.writeHead(200, streamHeaders(NATIVE_BOUNDARY));
    const child = spawn(this.ffmpegPath, nativeMjpegArguments(bounds, this.targetFps), {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.processes.add(child);
    let previousByte;
    child.stdout.on("data", (chunk) => {
      for (let index = 0; index < chunk.length; index++) {
        if (previousByte === 0xff && chunk[index] === 0xd8) {
          this.frames++;
          this.frameTimes.push(Date.now());
        }
        previousByte = chunk[index];
      }
    });
    child.stdout.pipe(response);
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4_000); });
    child.once("error", (error) => { this.error = String(error); });
    child.once("exit", (code) => {
      this.processes.delete(child);
      if (code !== 0 && code !== null && stderr.trim()) this.error = stderr.trim();
      if (!response.writableEnded) response.end();
    });
    response.once("close", () => {
      child.stdout.unpipe(response);
      if (child.exitCode === null) child.kill();
    });
  }

  status() {
    return {
      available: this.error === undefined,
      targetFps: this.targetFps,
      deliveredFps: Number(frameRate(this.frameTimes).toFixed(1)),
      frames: this.frames,
      clients: this.processes.size,
      error: this.error,
    };
  }

  close() {
    for (const child of this.processes) if (child.exitCode === null) child.kill();
    this.processes.clear();
  }
}
