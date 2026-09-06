// A presentation-only pointer highlighter for streams and recorded demos. It listens to the DOM
// canvas rather than a Pixi scene, so scene-level swallowing and transitions do not hide the
// viewer's input. The listeners never prevent default or stop propagation, and the Pixi overlay
// itself is non-interactive, leaving the game's normal input arbitration untouched.
const [
  { Container, Graphics, Rectangle },
  { makeTtfLabel },
  { Popup },
  { optionsLayout },
  runtimeSettings,
] = await Promise.all([
  dibMod.modules.load("pixi.js"),
  dibMod.modules.load("@dib/renderer"),
  dibMod.modules.load("web/ui/popup.ts"),
  dibMod.modules.load("web/world/optionsMath.ts"),
  dibMod.modules.load("web/runtimeSettings.ts"),
]);

const EMIT_INTERVAL_MS = 32;
const TRAIL_SPACING_PX = 7;
const MAX_MOVE_SAMPLES = 28;
const MAX_PARTICLES = 220;
const STORAGE_KEY = "dev.dragonislandblue.wand-pointer-trail.settings.v1";
const MIN_SCALE = 0.5;
const MAX_SCALE = 5;
const SCALE_STEP = 0.05;
const SLIDER_TRACK_WIDTH = 130;
const PARTICLE_COLORS = Object.freeze([
  0xffffff,
  0xfff4a8,
  0x8ff8ff,
  0x9bc7ff,
  0xe4a8ff,
]);

function normalizeScale(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, numeric));
  return Number((Math.round(clamped / SCALE_STEP) * SCALE_STEP).toFixed(2));
}

function loadScale() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return 1;
    return normalizeScale(JSON.parse(raw)?.scale);
  } catch {
    return 1;
  }
}

let trailScale = loadScale();
function setTrailScale(value) {
  trailScale = normalizeScale(value);
  activeSnapshot = Object.freeze({ ...activeSnapshot, scale: trailScale });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scale: trailScale }));
  } catch {
    // Storage-disabled browsers retain the selection for this active mod instance.
  }
  return trailScale;
}

let uninstallActive = () => {};
let activeSnapshot = Object.freeze({
  installed: false,
  activePointers: 0,
  particles: 0,
  scale: trailScale,
});

function installTrail(boot) {
  const { stage } = boot;
  const app = stage.app;
  const canvas = app.canvas;
  const overlay = new Graphics();
  overlay.label = "wandPointerTrail";
  overlay.eventMode = "none";
  overlay.zIndex = Number.MAX_SAFE_INTEGER;
  app.stage.addChild(overlay);

  const pointers = new Map();
  const particles = [];
  let elapsedMs = 0;
  let disposed = false;

  const publishSnapshot = () => {
    activeSnapshot = Object.freeze({
      installed: !disposed,
      activePointers: pointers.size,
      particles: particles.length,
      scale: trailScale,
    });
    // These fields let the opt-in browser fixture inspect the external package through the
    // ordinary Pixi devtools tree without adding anything to the game's diagnostic state.
    overlay.activePointerCount = pointers.size;
    overlay.particleCount = particles.length;
    overlay.effectScale = trailScale;
  };

  const canvasPoint = (event) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = (event.clientX - rect.left) * (app.screen.width / rect.width);
    const y = (event.clientY - rect.top) * (app.screen.height / rect.height);
    if (x < 0 || y < 0 || x > app.screen.width || y > app.screen.height) return null;
    return { x, y };
  };

  const spawnParticle = (x, y, strength = 1) => {
    const angle = Math.random() * Math.PI * 2;
    const speed = (12 + Math.random() * 48) * strength;
    particles.push({
      x: x + (Math.random() - 0.5) * 7 * strength,
      y: y + (Math.random() - 0.5) * 7 * strength,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 18 * strength,
      ageMs: 0,
      lifetimeMs: 260 + Math.random() * 280,
      radius: (1.4 + Math.random() * 3.4) * strength,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 7,
      color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
      star: Math.random() < 0.42,
    });
    const particleLimit = Math.round(MAX_PARTICLES * Math.max(1, trailScale));
    if (particles.length > particleLimit) {
      particles.splice(0, particles.length - particleLimit);
    }
  };

  const sparkleAt = (point, count, strength = 1) => {
    const scaledCount = Math.max(1, Math.round(count * trailScale));
    for (let index = 0; index < scaledCount; index += 1) {
      spawnParticle(point.x, point.y, strength * trailScale);
    }
  };

  const begin = (event) => {
    // The game is operated with the primary mouse button. Touch and pen pointer-down events use
    // the same button value, so they naturally share this path.
    if (event.button !== 0) return;
    const point = canvasPoint(event);
    if (point === null) return;
    pointers.set(event.pointerId, { point, last: point, emitElapsedMs: 0 });
    sparkleAt(point, 11, 1.15);
    publishSnapshot();
  };

  const move = (event) => {
    const pointer = pointers.get(event.pointerId);
    if (pointer === undefined) return;
    // A missed mouseup must not leave an emitter alive. Touch/pen implementations do not all
    // report a useful `buttons` bitfield, so this recovery check is mouse-specific.
    if (event.pointerType === "mouse" && (event.buttons & 1) === 0) {
      pointers.delete(event.pointerId);
      publishSnapshot();
      return;
    }
    const point = canvasPoint(event);
    if (point === null) {
      pointer.point = null;
      pointer.last = null;
      return;
    }
    if (pointer.last !== null) {
      const dx = point.x - pointer.last.x;
      const dy = point.y - pointer.last.y;
      const distance = Math.hypot(dx, dy);
      const samples = Math.min(MAX_MOVE_SAMPLES, Math.ceil(distance / TRAIL_SPACING_PX));
      for (let index = 1; index <= samples; index += 1) {
        const ratio = index / Math.max(1, samples);
        sparkleAt({
          x: pointer.last.x + dx * ratio,
          y: pointer.last.y + dy * ratio,
        }, 2, 0.88);
      }
    }
    pointer.point = point;
    pointer.last = point;
    publishSnapshot();
  };

  const end = (event) => {
    if (!pointers.delete(event.pointerId)) return;
    publishSnapshot();
  };
  const endAll = () => {
    if (pointers.size === 0) return;
    pointers.clear();
    publishSnapshot();
  };

  const redraw = () => {
    overlay.clear();
    for (const particle of particles) {
      const remaining = Math.max(0, 1 - particle.ageMs / particle.lifetimeMs);
      const radius = particle.radius * (0.35 + remaining * 0.65);
      const alpha = remaining * remaining * 0.92;
      if (particle.star) {
        overlay
          .star(particle.x, particle.y, 4, radius * 1.7, radius * 0.32, particle.rotation)
          .fill({ color: particle.color, alpha });
      } else {
        overlay.circle(particle.x, particle.y, radius).fill({ color: particle.color, alpha });
      }
    }
    // A bright wand-tip marker makes a stationary press visible. It disappears immediately on
    // release; only already-emitted particles remain for the short after-effect.
    for (const pointer of pointers.values()) {
      if (pointer.point === null) continue;
      const pulse = 1 + Math.sin(elapsedMs / 55) * 0.18;
      overlay
        .circle(pointer.point.x, pointer.point.y, 10 * pulse * trailScale)
        .stroke({ color: 0x8ff8ff, width: 1.5 * trailScale, alpha: 0.3 })
        .star(
          pointer.point.x,
          pointer.point.y,
          4,
          7 * pulse * trailScale,
          1.8 * trailScale,
          elapsedMs / 260,
        )
        .fill({ color: 0xffffff, alpha: 0.96 });
    }
  };

  const update = (ticker) => {
    if (disposed) return;
    const deltaMs = Math.max(0, Math.min(100, Number(ticker.deltaMS) || 0));
    const deltaSeconds = deltaMs / 1_000;
    elapsedMs += deltaMs;

    for (let index = particles.length - 1; index >= 0; index -= 1) {
      const particle = particles[index];
      particle.ageMs += deltaMs;
      if (particle.ageMs >= particle.lifetimeMs) {
        particles.splice(index, 1);
        continue;
      }
      particle.x += particle.vx * deltaSeconds;
      particle.y += particle.vy * deltaSeconds;
      particle.vy += 42 * deltaSeconds;
      particle.rotation += particle.spin * deltaSeconds;
    }

    for (const pointer of pointers.values()) {
      if (pointer.point === null) continue;
      pointer.emitElapsedMs += deltaMs;
      let bursts = 0;
      while (pointer.emitElapsedMs >= EMIT_INTERVAL_MS && bursts < 4) {
        pointer.emitElapsedMs -= EMIT_INTERVAL_MS;
        sparkleAt(pointer.point, 2, 0.82);
        bursts += 1;
      }
      if (bursts === 4) pointer.emitElapsedMs %= EMIT_INTERVAL_MS;
    }
    redraw();
    publishSnapshot();
  };

  canvas.addEventListener("pointerdown", begin, { passive: true });
  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("pointerup", end, { passive: true });
  window.addEventListener("pointercancel", end, { passive: true });
  window.addEventListener("blur", endAll);
  app.ticker.add(update);
  publishSnapshot();

  return () => {
    if (disposed) return;
    disposed = true;
    pointers.clear();
    particles.length = 0;
    canvas.removeEventListener("pointerdown", begin);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    window.removeEventListener("blur", endAll);
    if (!stage.destroyed) {
      app.ticker.remove(update);
      if (!overlay.destroyed) overlay.destroy();
    }
    publishSnapshot();
  };
}

// `showOptionsPanel` builds one common `portOptionsContent` body for startup, world, and dungeon,
// then passes that completed body through Popup.show. Intercepting the class's static method lets
// the package append one row before Popup measures it without changing the base Options model.
const extendedOptions = new WeakSet();
function appendScaleSlider(content, onClick) {
  if (extendedOptions.has(content)) return;
  extendedOptions.add(content);

  const existingControls = content.children.filter((child) =>
    child.children?.some((entry) =>
      typeof entry.label === "string" && entry.label.startsWith("optionsChoice:"),
    ),
  );
  if (existingControls.length < 2) {
    throw new Error("Wand Pointer Trail: Options row layout is unavailable");
  }
  const firstControls = existingControls[0];
  const lastControls = existingControls.at(-1);
  const firstIndex = content.children.indexOf(firstControls);
  const firstLabel = content.children[firstIndex - 1];
  if (firstLabel === undefined || lastControls === undefined) {
    throw new Error("Wand Pointer Trail: Options label/control pairing changed");
  }
  const rowStep = existingControls[1].position.y - firstControls.position.y;
  const rowY = lastControls.position.y + rowStep;
  const layout = optionsLayout(runtimeSettings.DISPLAY_MODE);

  const rowLabel = makeTtfLabel("Trail:", layout.fontSize, {
    outlineWidthPt: layout.outlineWidth,
    outlineAlpha: 0.5,
  });
  rowLabel.anchor.set(0, 0.5);
  rowLabel.position.set(firstLabel.position.x, rowY);

  const controls = new Container();
  controls.label = "optionsChoice:wandTrailScale:slider";
  controls.eventMode = "static";
  controls.cursor = "pointer";
  controls.position.set(firstControls.position.x, rowY);
  controls.hitArea = new Rectangle(-9, -14, SLIDER_TRACK_WIDTH + 18, 28);
  const track = new Graphics();
  const thumb = new Graphics();
  const valueLabel = makeTtfLabel("", layout.fontSize, {
    outlineWidthPt: layout.outlineWidth,
    outlineAlpha: 0.5,
  });
  track.eventMode = "none";
  track.label = "wandTrailScaleTrack";
  thumb.eventMode = "none";
  thumb.label = "wandTrailScaleThumb";
  valueLabel.eventMode = "none";
  valueLabel.label = "wandTrailScaleValue";
  valueLabel.anchor.set(0, 0.5);
  valueLabel.position.set(SLIDER_TRACK_WIDTH + 14, 0);
  controls.addChild(track, thumb, valueLabel);

  const refresh = () => {
    const ratio = (trailScale - MIN_SCALE) / (MAX_SCALE - MIN_SCALE);
    track
      .clear()
      .roundRect(0, -3, SLIDER_TRACK_WIDTH, 6, 3)
      .fill({ color: 0x252b34, alpha: 0.96 })
      .roundRect(0, -3, SLIDER_TRACK_WIDTH * ratio, 6, 3)
      .fill({ color: 0x8ff8ff, alpha: 0.9 });
    thumb
      .clear()
      .circle(SLIDER_TRACK_WIDTH * ratio, 0, 7)
      .fill({ color: 0xffffff, alpha: 1 })
      .stroke({ color: 0x68cfe4, width: 1.5 });
    valueLabel.text = `${trailScale.toFixed(2)}x`;
  };
  const selectAt = (event) => {
    const local = event.getLocalPosition(controls);
    const ratio = Math.max(0, Math.min(1, local.x / SLIDER_TRACK_WIDTH));
    setTrailScale(MIN_SCALE + ratio * (MAX_SCALE - MIN_SCALE));
    refresh();
  };
  let pointerId = null;
  controls.on("pointerdown", (event) => {
    event.stopPropagation();
    pointerId = event.pointerId;
    onClick?.();
    selectAt(event);
  });
  controls.on("globalpointermove", (event) => {
    if (event.pointerId !== pointerId) return;
    event.stopPropagation();
    selectAt(event);
  });
  const finish = (event) => {
    if (event.pointerId !== pointerId) return;
    event.stopPropagation();
    selectAt(event);
    pointerId = null;
  };
  controls.on("pointerup", finish);
  controls.on("pointerupoutside", finish);
  controls.on("pointercancel", (event) => {
    if (event.pointerId === pointerId) pointerId = null;
  });
  refresh();
  content.addChild(rowLabel, controls);
}

dibMod.intercept(Popup, "show", function (next, parent, options) {
  if (options?.content?.label === "portOptionsContent") {
    appendScaleSlider(options.content, options.sfx?.onButtonPress);
  }
  return next(parent, options);
});

dibMod.hooks.on("boot:ready", ({ value: boot }) => {
  uninstallActive();
  uninstallActive = installTrail(boot);
});
dibMod.onDispose(() => {
  uninstallActive();
  uninstallActive = () => {};
});

dibMod.exports.snapshot = () => activeSnapshot;
dibMod.exports.storageKey = STORAGE_KEY;
dibMod.exports.scaleRange = Object.freeze({ min: MIN_SCALE, max: MAX_SCALE, step: SCALE_STEP });
