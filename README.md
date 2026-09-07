# Dragon Island Blue Web Engine

<img src="apps/web/app-icon-512.png" alt="Dragon Island Blue Web Engine icon" width="128" height="128">

This is a playable TypeScript/PixiJS reimplementation of the discontinued pre-iOS 11 game *Dragon Island Blue*, **supporting play on all modern devices**. This work does not host or require any copyrighted material from the original game, and simply provides a flexible framework that reproduces mechanics for preservation. 

> [!NOTE]
> **Project status:** All mechanics from the original game have been fully reimplemented, and a full RNG-perfect playthrough of the game is possible. If you notice any deviations from the source or would like to contribute, feel free to reach out!

The mobile app was designed to support the 480×320 iPhone and 512×384 iPad screens. We attempt to retain both of these screen dimensions ported and upscaled to modern devices, although iPad mode is less-thoroughly tested due to mechanical limitations. See [current status](docs/STATUS.md) for limits, and [keyboard controls](docs/keyboard-controls.md) for some default QoL keyboard shortcuts for computer users.

## Quick start

Requires: Node ≥ 20.11 with [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm --filter @dib/web dev
```

Open the printed URL, choose a compatible `.ipa` or `.zip`, attest that you have the right to use it, and choose **Offline** to play locally. Learn more about expected asset formats in our [Modding Guide](https://dib.opq.sh/modding.html).

Assets are stored locally on the browser and are never uploaded or copied into the web build. After an initial load, some browsers may remember these asset bundles in a local cache for faster startup on reload. Assets used in this way never leave your device.

Game saves are stored in the same format used by the original game, and can be loaded and exported directly between compatible emulators or pre-iOS 11 devices. Game saves are stored locally on the browser between sessions, and may be vulnerable to aggressive cache-cleaning browser configurations or extensions; it is reccomended to export saves as backups regularly.

> Note: Do not use this software with content that you do not have a legal right to use. 


## Adding to Home Screen

This web app supports PWA, which means you can add it directly to the home screen of any device with a modern web browser. This also has the added benefit of telling your device not to erase save data while clearing old cache data. [Here is a guide](https://www.cdc.gov/niosh/mining/tools/installpwa.html) to doing this on iOS, Android, and Windows/Mac.


## Modding

Fully reimplementing Dragon Island Blue's engine allows a much more legible interface for modding. Our engine supports injectable `.dibmod` bundles which can contain JS and extra assets that are loaded directly into the tab's current runtime, allowing full access to change just about all in-game behaviors. Learn how to create DIB mods in our [Modding Guide](https://dib.opq.sh/modding.html#code-mods).

Only load mods you trust: mods are injected immediately and can read, write, and transfer most data in your tab's current runtime. Additionally, compatability issues may arise when using multiple mods, or reusing the same save for multiple different mods. Save frequently. Use of mods disables access to the Online Mode.

```bash
pnpm mods:examples
```

This builds some example mods we've created under `examples/mods/dist/`. See the [example catalog](examples/mods/README.md) and [mod API](docs/code-mod-api.md).


## Fidelity Lab

This is an experimental developer tool that loads a single save file into a local TouchHLE build and the Web Engine simultaneously, and compares differences in behavior and performance. Both pieces of software are given the same starting RNG seed and have inputs mirrored across both platforms, and can be inspected and recorded for any visual differences.

```bash
pnpm fidelity:lab
```

It needs the local emulator/source artifacts and is not shipped with the game. Follow the [Fidelity Lab guide](docs/fidelity-lab.md) for setup.


## Online Mode (WIP)

Our project also supports server-hosted saves and server-authoritative RNG. This is currently in development and may be slower and less stable than the offline version, but supports cross-device syncing, unspoofable leaderboards, and the potential for much more (e.g. PvP battles).

### Online Mode Local Setup

On Windows, `start-dev.cmd` starts the web client by default; use `start-dev.cmd --online` to also start the API after completing the setup below. **Online** remains disabled until the client detects a ready server. If you start the API later, refresh the page to check again.

The API needs operator-installed compatible logic data; selecting a browser archive does not install server rules. Follow the [local service setup](docs/save-system.md#local-operation) for data paths and storage configuration.

To exercise Online Mode locally, run the authoritative API and web client in separate terminals. Keep the same secret when restarting the API. Access is **token-gated**: the content gate can mint a login token for anyone (one per client address per five minutes), and an operator can still issue one directly.

Terminal 1 (leave it running):

```powershell
$env:DIB_GAME_HMAC_SECRET = '<at-least-32-byte-random-secret>'
pnpm game:dev
```

Instead of exporting the secret each time, you can drop it into a gitignored `hmac.txt` at the repo
root (or point `DIB_GAME_HMAC_SECRET_FILE` elsewhere); `game:dev`/`game:cli` load it automatically,
so the env var above becomes optional.

Players can mint their own token from the gate itself ("Create account"), so this step is
optional. To hand one out instead (in another terminal, same secret and data dir):

```powershell
$env:DIB_GAME_HMAC_SECRET = '<same-secret-as-above>'
pnpm game:cli invite "Ada's laptop"   # `save:cli` remains an alias for this operator command
pnpm game:cli invite "Ada's laptop" --username "Ada"   # also give it a scoreboard account
```

Terminal 2:

```powershell
pnpm --filter @dib/web dev
```

Choose the archive, select **Online**, paste the token, and press **Log in**. The gate checks the
token and archive compatibility together, then enables **Play Online**. A self-created token
carries a username and a public-scoreboard preference, changeable
later under Options → Scores in the in-game menu. The
source-shaped title screen opens the three-slot picker. On reload, restore or select the compatible archive, authenticate, and choose the same slot. The API prints its state-directory path at startup. See
[the save-system guide](docs/save-system.md) for the storage/security contract, the token workflow,
and key/session management details.
