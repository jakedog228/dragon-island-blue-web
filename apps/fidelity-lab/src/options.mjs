import path from "node:path";

const integer = (value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer in [${min}, ${max}], got ${value}`);
  }
  return parsed;
};

export function parseOptions(argv, cwd = process.cwd()) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument ${argument}`);
    if (["--help", "--headed-port", "--open", "--accept-content-rights", "--auto-run-task", "--prune-native-captures", "--wait-for-viewer-sync", "--mute-port-audio"].includes(argument)) {
      flags.add(argument);
      continue;
    }
    const value = argv[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    values.set(argument, value);
  }

  const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
  return Object.freeze({
    help: flags.has("--help"),
    dashboardPort: integer(values.get("--port") ?? 4317, "--port", { min: 1, max: 65535 }),
    webUrl: values.get("--web-url") ?? "http://localhost:5173",
    nativePid: values.has("--native-pid")
      ? integer(values.get("--native-pid"), "--native-pid", { min: 1 })
      : undefined,
    nativeTitle: values.get("--native-title") ?? "touchHLE",
    nativeLog: values.has("--native-log") ? path.resolve(cwd, values.get("--native-log")) : undefined,
    nativeCaptureDir: values.has("--native-capture-dir")
      ? path.resolve(cwd, values.get("--native-capture-dir"))
      : undefined,
    nativeInput: values.get("--native-input") ?? "win32",
    nativeLiveInput: values.has("--native-live-input") ? path.resolve(cwd, values.get("--native-live-input")) : undefined,
    nativeLiveAck: values.has("--native-live-ack") ? path.resolve(cwd, values.get("--native-live-ack")) : undefined,
    portDisplayMode: values.get("--display-mode") ?? "iphone",
    portTextMode: values.get("--text-mode") ?? "original",
    archive: values.has("--archive") ? path.resolve(cwd, values.get("--archive")) : undefined,
    nativeSave: values.has("--save") ? path.resolve(cwd, values.get("--save")) : undefined,
    rules: values.has("--rules") ? path.resolve(cwd, values.get("--rules")) : undefined,
    task: values.has("--task") ? path.resolve(cwd, values.get("--task")) : undefined,
    launcherUrl: values.get("--launcher-url"),
    sessionId: values.get("--session-id"),
    managedPolicy: values.get("--managed-policy"),
    edgePath: values.get("--edge") ??
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    ffmpegPath: values.get("--ffmpeg") ?? "ffmpeg",
    outputRoot: path.resolve(
      cwd,
      values.get("--output") ?? path.join(repositoryRoot, "output/fidelity-lab"),
    ),
    captureFps: integer(values.get("--capture-fps") ?? 2, "--capture-fps", { min: 1, max: 30 }),
    rngState: integer(values.get("--rng-state") ?? 0, "--rng-state", { min: 0, max: 0xffffffff }),
    rngSkip: integer(values.get("--rng-skip") ?? 0, "--rng-skip", { min: 0 }),
    headedPort: flags.has("--headed-port"),
    acceptContentRights: flags.has("--accept-content-rights"),
    open: flags.has("--open"),
    autoRunTask: flags.has("--auto-run-task"),
    pruneNativeCaptures: flags.has("--prune-native-captures"),
    waitForViewerSync: flags.has("--wait-for-viewer-sync"),
    mutePortAudio: flags.has("--mute-port-audio") || flags.has("--auto-run-task"),
  });
}

export const HELP = `Dragon Island Blue Fidelity Lab

Usage:
  pnpm fidelity:lab -- [options]

Options:
  --web-url <url>       Running web port (default http://localhost:5173)
  --native-pid <pid>    Attach to a specific TouchHLE process
  --native-title <text> Window-title substring (default touchHLE)
  --native-log <path>   Optional TouchHLE log containing HSCENE dumps
  --native-capture-dir <path>
                        Read the custom harness framebuffer PPMs instead of the visible desktop
  --prune-native-captures
                        Delete converted managed PPMs so high-rate live capture stays bounded
  --wait-for-viewer-sync
                        Buffer web frames and release the closest pair after native is ready
  --mute-port-audio     Silence controlled-port output while keeping its game audio active
  --native-input <mode> Native input mode: harness, win32, or scripted (default win32)
  --native-live-input <path>
                        Private TouchHLE harness command file (required by harness mode)
  --native-live-ack <path>
                        Private TouchHLE harness acknowledgement file (required by harness mode)
  --display-mode <mode> Controlled port tier: iphone or ipad (default iphone)
  --text-mode <mode>    Controlled port text: original or modern (default original)
  --archive <path>      Automatically load this local IPA/ZIP in the port
  --save <path>         Import the same copied native save into port slot 1
  --accept-content-rights
                        Required with --archive; confirms the content-gate statement
  --rules <path>        Optional numeric native-text ↔ port-state comparison rules
  --task <path>         Load a machine-readable Fidelity Lab task
  --auto-run-task       Run the loaded task as soon as the comparison is ready
  --launcher-url <url>  Setup dashboard that owns this managed session
  --session-id <id>     Managed session identifier
  --managed-policy <id> Internal managed launcher/worker determinism contract
  --port <number>       Dashboard port (default 4317)
  --capture-fps <1-30>  Evidence/state sample rate (default 2; viewer streams stay high-rate)
  --ffmpeg <path>       FFmpeg executable used for the 60 fps TouchHLE viewer
  --rng-state <uint32>  TouchHLE arc4random state before replay (default 0)
  --rng-skip <count>    Native draws already consumed before the compared route
  --output <directory>  Recording/checkpoint root
  --headed-port         Also show the controlled port browser window
  --edge <path>         Chromium/Edge executable
  --open                Open the dashboard in the default browser
  --help                Show this help

TouchHLE must already be running. Managed sessions use the direct framebuffer and may be covered;
advanced sessions without --native-capture-dir use window capture and must remain visible.
Start the web app separately with pnpm --filter @dib/web dev.
For exact RNG normalization, begin both runtimes at the same route boundary or supply the native
draw count with --rng-skip. The current port draw cursor is shown in render_game_to_text.
`;
