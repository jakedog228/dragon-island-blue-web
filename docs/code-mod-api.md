# Full-Trust Offline Mod Runtime v4

`.dibmod` files are dependency-ordered JavaScript bundles that execute directly in the game page.
This is an intentional full-trust boundary, not a sandbox. A mod has the same browser authority as
the client: it can import game modules, replace methods and properties, mutate live objects, alter
the DOM, read or change browser-local saves and storage, make network requests, and load further
code. Only load mods whose source and publisher you trust completely.

Mods remain Offline/scenario-only. Selecting any mod disables Official launch. Once mod code has
run, Official stays disabled for that tab even if the picker is cleared, because only a document
reload can establish a clean page realm. Mod bytes and mod-authored state are never sent to or
admitted by the authoritative command service.

## Bundle and manifest

A bundle contains a strict `manifest.json`, one JavaScript entry, and any other files the mod
wants. JavaScript is the common runtime language. TypeScript authors compile or bundle to the
declared JavaScript entry.

```text
manifest.json
scripts/main.js
scripts/optional-helper.js
assets/overhaul.css
assets/custom-panel.png
data/rules.json
```

```json
{
  "schemaVersion": 4,
  "id": "dev.example.total-conversion",
  "version": "1.0.0",
  "displayName": "Total Conversion",
  "apiVersion": 4,
  "mode": "offline",
  "dependencies": { "dev.example.library": "^1.2.0" },
  "optionalDependencies": { "dev.example.hud": ">=1.0.0 <2.0.0" },
  "conflicts": { "dev.example.rival-conversion": "*" },
  "loadAfter": ["dev.example.balance"],
  "loadBefore": ["dev.example.cleanup"],
  "priority": 0,
  "entry": "scripts/main.js"
}
```

The required fields are `schemaVersion`, `id`, `version`, `displayName`, `apiVersion`, `mode`,
`dependencies`, and `entry`. The other relation fields default to empty, and `priority` defaults to 0. Ranges
accept `*`, an exact version, `>=` / `>` / `<=` / `<` / `=`, `^`, `~`, space-separated conjunctions,
and `||` alternatives, so a library mod stays usable across its own patch releases.

`dependencies`, `optionalDependencies`, and `conflicts` map reverse-DNS IDs to supported semantic
version ranges; `loadAfter`/`loadBefore` add soft ordering edges; integer `priority` breaks
otherwise-unordered ties before the ID tie-breaker. See "Managing multiple mods" below. The
resolved package bytes and order identify the exact play profile shown by the gate, but do not by
themselves select a browser-local save namespace. The namespace covers effective
mechanics-bearing runtime data. This lets visualization and code-only updates keep using the same
saves; changing the exact profile still produces a prominent warning before an existing save
opens. Permissions are deliberately absent: selecting a v4 package grants the whole client runtime.

The ZIP reader still rejects path traversal, duplicate paths, malformed manifests, dependency
cycles, and archive bombs. Those are package-integrity and resource-exhaustion checks, not a
capability boundary. Current limits are 64 MiB compressed, 128 MiB expanded, 512 entries, and
32 MiB per entry.

## Entry environment

The entry is an async JavaScript function body with a `dibMod` parameter, so top-level `await` is
available:

```js
const { BattleNode } = await dibMod.modules.load("web/battle/battleNode.ts");

dibMod.intercept(BattleNode.prototype, "renderGameState", function (next, ...args) {
  return { ...next(...args), myConversion: { active: true } };
});
```

This is same-realm execution. Normal browser globals (`window`, `document`, `localStorage`,
`indexedDB`, `fetch`, `WebSocket`, and so on) are available directly. There is no worker message
bridge, JSON membrane, permissions broker, timeout, call quota, or hidden iframe.

Static `import` declarations are not valid inside the function-body entry. Use
`dibMod.modules.load()` for game modules, bundle third-party dependencies into the entry, or use
normal browser loading facilities. `dibMod.files.run(path)` evaluates another bundled UTF-8
JavaScript file with the same `dibMod` object.

## Generic API

The runtime is intentionally based on reflection and lifecycle, not named feature endpoints.

```ts
interface DibMod {
  manifest: ManifestV4;
  exports: Record<string, unknown>;

  files: {
    list(): readonly string[];
    has(path: string): boolean;
    bytes(path: string): Uint8Array;
    text(path: string): string;
    json<T = unknown>(path: string): T;
    url(path: string, mediaType?: string): string;
    run(path: string): Promise<unknown>;
  };

  modules: {
    list(): readonly string[];
    has(id: string): boolean;
    load(id: string): Promise<unknown>;
  };

  host: {
    list(): readonly string[];
    has(name: string): boolean;
    get<T = unknown>(name: string): T | undefined;
    require<T = unknown>(name: string): T;
    set(name: string, value: unknown): void;
    delete(name: string): boolean;
  };

  hooks: {
    on(name: string, handler: (event: {
      name: string;
      modId: string;
      value: unknown;
      host: DibMod["host"];
    }) => unknown | Promise<unknown>): () => void;
  };

  replace(target: object, key: PropertyKey, value: unknown): () => void;
  intercept(
    target: object,
    key: PropertyKey,
    wrapper: (next: (...args: unknown[]) => unknown, ...args: unknown[]) => unknown,
  ): () => void;
  onDispose(callback: () => void): () => void;

  /** Every selected package in resolved activation order, including this one. */
  loadOrder: readonly { id: string; version: string; displayName: string; priority: number }[];
  /** The value of a member as it stood before ANY mod patched it. */
  original<T = unknown>(target: object, key: PropertyKey): T;
  /** Wrap the underlying method inside the current outer interceptor chain. */
  interceptBase: DibMod["intercept"];
  /** Deep-merges a patch into a base, keeping sibling keys another mod may have added. */
  merge<T>(base: T, patch: unknown): T;
  /** What the whole active profile has done to the same places, so far. */
  interference(): ModInterferenceReport;
}
```

`replace` and `intercept` restore their preceding property descriptor when the profile is disposed.
They work on any reachable object or prototype. Direct assignments are also allowed, but the
runtime cannot automatically undo them. Interceptors receive `next` bound to the original receiver,
so class instance methods retain `this`.

Each package gets a mutable `exports` object published as `mods.<package-id>` in the shared host
registry. Dependencies can use it for arbitrary JavaScript APIs without the engine defining a
protocol.

`interceptBase(target, key, wrapper)` installs at the innermost dispatch point rather than around
the current outermost interceptor. Existing wrappers retain their setup/cleanup and their `next`
reaches the new base hook, even after an `await`. Its `next` calls the prior base with the same
receiver. Use it for late-loaded compatibility packages that replace a scheduler without erasing
character hooks. A later `replace` still discards the current chain; a subsequent base hook starts
inside that replacement's new chain. Disposal restores the base and then the original descriptors.
This is a generic v4 runtime addition, not a new battle-specific bridge or manifest capability.

`files.url()` creates a cached blob URL and revokes it at disposal. Bundle files are otherwise
untyped: CSS, images, audio, JSON, WASM, scripts, or a mod-defined format all use the same access.

## Runtime modules

`modules.list()` is generated from the complete production runtime `apps/web/src/**/*.ts` graph
(excluding test/spec files and development-only scenario tooling), rather than a maintained
feature allowlist. IDs use `web/` plus the source-relative path, for example:

```text
web/battle/battleNode.ts
web/world/worldNode.ts
web/sceneCoordinator.ts
web/player/playerRuntimeState.ts
```

The public roots `@dib/engine`, `@dib/gamedata/browser`, `@dib/player-domain`, `@dib/renderer`, and
`pixi.js` are also available. A loaded module is the real module namespace used by the app. Exported
classes can be intercepted through their prototypes; exported mutable objects can be changed
directly. Internal source modules are intentionally not a compatibility-stable API—full-conversion
mods should pin the engine revision they target.

## Lifecycle and live services

Hooks are open-ended strings. The host currently publishes these broad lifecycle points in resolved
mod order:

- `content:loaded` — receives the imported content package before fingerprinting and may return a
  replacement package;
- `boot:starting` — receives the DOM host, acquired content/save connection, scene coordinator, and
  startup diagnostics before the game viewport is mounted;
- `boot:ready` — receives the DOM/render hosts, content, scene coordinator, Pixi stage, keyboard,
  audio, diagnostics, and deterministic `advanceTime` function;
- `game:loaded` — receives `LoadedGame` and may return a replacement;
- `startup:loaded` — receives the startup result/save session plus game, stage, scenes, audio, and
  content.

`mods:ready` runs before all of these, once every package entry has executed, and receives the
interference report. It is where a compatibility patch belongs.

Every completed phase is also placed in `dibMod.host` under its phase name. `content` and `game`
are published directly. Mods can add their own services and lifecycle names. Because `boot:ready`
exposes the central scene coordinator before gameplay transitions, one generic interception of
`replace`, `clear`, or a constructed scene prototype can affect every current and future feature.

## Managing multiple mods

Mods in this API can reach everything, so two of them landing on the same method, service name, or
data path is normal rather than exceptional. The design goal is therefore **not** to prevent
overlap — that would be a capability boundary, which this API deliberately does not have — but to
make overlap *ordered*, *declarable*, and *visible*.

### Order is derived, never taken from the picker

Selection order is ignored. The loader derives one deterministic activation order from:

1. hard `dependencies` edges (a dependency always activates first);
2. `optionalDependencies` edges, applied only when that package is also selected;
3. `loadAfter` / `loadBefore` soft edges, likewise ignored when the named package is absent;
4. effective `priority` (manifest value, or the player's manual override) as the tie-break;
5. package ID, as the final tie-break so the result is stable.

**Later activation wins**, matching the usual reading of mod-manager priority. A higher `priority`
therefore loads later and overwrites more. The resolved order remains part of the exact profile
identity and the gate warns when it differs from the profile that last opened the namespace. It is
not automatically a new save namespace unless the resulting mechanics-bearing data differs.

The gate keeps only a mod count and a picker inline. The management surface is the **Profiles**
modal behind the star button on the Game content card: it lists the resolved order with per-package
up/down controls, the advisories, and the seam report below. Moving a package rewrites the whole
order as explicit priorities, persisted in `localStorage` under `dib.mods.loadOrder.v1`. Declared
edges still win, so a move the relations forbid visibly snaps back — the list always shows the
order that will actually run.

### Profiles

Launching Offline records the pairing that was used — the asset archive, the exact ordered mod
packages, and the save namespace they produce — and caches the mod bytes behind it. The same modal
lists every pairing that owns an Offline save on this device, so archives, mods, and save slots are
visible as one relationship rather than three separate pickers.

A pairing whose packages are all still cached can be restored in one click; that repopulates the
pickers and stops, because cached mod bytes are executable and re-running them stays an explicit
act. A pairing missing some bytes renders those rows as ghosts with an Upload control beside them.
Saves whose pairing predates this record, or whose record was forgotten, are listed as unidentified
content rather than hidden — the save is real either way. Forgetting a cached package or a pairing
record never touches a save slot.

**Clear mods** clears the active selection without deleting cached packages or their save-linked
profiles. If mod code already ran, the action reloads the document automatically and suppresses
profile restoration, so the new clean page can use Online immediately. A selection that never ran
clears in place. Choosing **Use** on a saved profile, or launching an Offline profile again, opts
back into restoring that profile on later reloads.

Profiles from a different data namespace expose **Try here** per slot once current Offline content
has loaded. This is deliberately an escape hatch, not an assertion of compatibility: it clones the
slot, preserves the original, and warns that absent optional registrations will be ignored while
larger content differences may crash or corrupt later revisions of the clone. Destination slots
are never overwritten. Exporting a backup first is strongly recommended.

Each save row also exposes **Delete**. It requires a native confirmation naming both the slot and
profile, then removes that slot's live and retained rollback revisions. It does not delete another
slot, cached archive/mod bytes, or the remembered profile metadata.

### Refusals versus reports

Only two classes of problem stop a profile, and both are integrity statements rather than judgement
calls: an unsatisfiable graph (missing dependency, version outside the declared range, cycle — the
error names the cycle members), and a `conflicts` entry that matches a selected package. A conflict
is one author's claim about another package, so the gate offers **Load anyway**, which passes
`allowDeclaredConflicts` and records an advisory instead.

Everything else is reported, never blocked. After activation, `dibMod.interference()` and
`content.modProfile.interference` describe every seam two or more mods claimed:

| Seam | Recorded when | Severity |
| --- | --- | --- |
| `property` — `BattleNode.prototype.sleep` | two mods `replace`/`intercept` the same member | `info` if every later claim is an `intercept` (they nest, so all of them still run); `warning` as soon as one mod `replace`s over another's work |
| `data` — `content:loaded → data.strings` | two mods write the same path of a phase value | `warning` (last write wins) |
| `service` — `host:my.tuning` | two mods claim the same host service name | `warning` (last write wins) |

Data seams come from diffing what each handler returned against what it received. Reference-equal
subtrees prune, so the ordinary spread-clone style is nearly free to audit, and only the leaves that
actually changed are attributed. A mod that mutates a live object **in place** returns the same
reference and is invisible to this diff by construction; return a replacement if you want your data
edits attributable.

### Writing a mod that shares the game well

- **Compose, don't clobber.** Prefer `intercept` over `replace`, and always call `next` unless
  suppressing the original is the actual feature. Use `dibMod.merge(base, patch)` for data so you
  keep sibling keys an earlier mod added instead of overwriting a stale snapshot of the subtree.
- **Namespace what you publish.** `dibMod.exports` is already published as `mods.<your-id>` and
  cannot collide. Invented `host.set` names can, so prefix them with your package ID.
- **Declare what you know about.** `conflicts` for a package you genuinely break, `loadAfter` for a
  package you want to sit on top of, `optionalDependencies` when you also need a version guarantee.
  All three are inert when the other package is not selected, so declaring them costs nothing.
- **Cooperate through published APIs.** A soft dependency plus the peer's `exports` beats patching
  the peer's internals. `examples/mods/fire-cub-inferno-barrage` paces its barrage through
  `BattleNode.sleep`, which `examples/mods/devtools` takes over. It declares
  `optionalDependencies` + `loadAfter` on devtools, reads that package's own `settings()` toggle,
  honours a player who asked for delay-free battles, and reports both the scheduled `elapsedMs` and
  a measured `realElapsedMs` so its debug projection cannot claim a four-second barrage that the
  clock never ran.
- **Patch mods are a first-class pattern.** Declare `loadAfter` on everything you reconcile and do
  the work in `mods:ready`, which runs once every entry has executed. At that point the whole
  profile is registered, `dibMod.interference()` is readable, `dibMod.original(target, key)` reaches
  past every other mod's patch, and any phase handler you register lands after everyone else's.

## Examples

`examples/mods/blue-dragon-overdrive` replaces imported mechanics at `content:loaded`.
`examples/mods/fire-cub-inferno-barrage` implements a complete new move without any battle-specific
mod API or site-side move identifier. Its one package owns the data overlay, scripted transaction,
twenty-strike timing loop, targeting policy, effects, and debug projection. The overlay gives one
copy to the first empty combat slot of every real monster whose resolved `usable1`...`usable4`
moveset is incomplete; inherited/native slots and complete movesets are unchanged. Its aim is a
ring drawn into `BattleNode`'s own point root that follows the pointer through Pixi's
`globalpointermove`; each strike takes the enemy whose sprite centre sits nearest the ring's centre,
and an empty ring defers to the engine's own scripted random pick so the draw stays on the ability's
RNG stream. A defeated target stays aimable for the rest of the sequence: later strikes route
presentation-only zero-damage events through the ordinary renderer, keeping the animation without
re-entering mechanics on a dead living. It is also the profile's worked example of cooperation: its pacing runs through the same
`BattleNode.sleep` that devtools takes over, so it declares `optionalDependencies` + `loadAfter` on
that package and reads its published toggle instead of fighting it.

`examples/mods/devtools` intercepts private-by-TypeScript battle, world, dungeon, and store methods,
plus the generic Pixi ticker and master-menu layout. It adds a separate persisted **Devtools** panel
whose modules all start disabled. Its toggles remove battle holds, apply a fixed 3x animation speed,
unlock overworld traversal and dungeon-room visibility, and zero ordinary shop-goods prices without
host-side integration. **Fixed / Quest Encounters** is session-only and starts off even if an old
storage record contains it. It intercepts the existing `WorldTrip.navigate` method and captures each
live world context through `WorldNode.refreshPoiStates`; no engine update or new private predicate
is required. A detached trip uses the original `createWorldTrip` adapter and encounter builder with
the selected fixed candidate's gates lifted, then restores its original completion/quest keys on
the result. All builder registries are copies, and its RNG is the world's quest-reward stream. The
live trip moves through normal navigation with a synchronous, finally-restored completion marker
to prevent a second encounter draw. Cleared POIs and inactive/completed quests can therefore be
replayed with their authored monsters, levels, dialogue and rewards. Battle settlement remains
durable. Ordinary-only destinations keep their original checks; turning the toggle off restores
normal eligibility. Version 1.1.1 removes 1.1.0's dependency on undeployed engine predicates.

Its dungeon reveal is also the profile's worked example of a presentation change that has to reach
input to be real. Revealing a room draws it, but the shipped scene arbitration
(`nearestMaterializedRoom`) considers only explored rooms and `DungeonSession.selectMaterializedRoom`
refuses an unexplored destination, so a revealed room was visible and unreachable. The package
re-runs the shipped arbitration over a throwaway floor projection with the reveal applied, redirects
`DungeonNode.handleRoomTouch` to the room that projection chose, adds its own scene listener for the
taps the shipped handler resolved nothing for (claim tracked with a `queueMicrotask`, since one Pixi
dispatch is synchronous), and lifts the session refusal. Durable exploration is still only ever
written by arrival: `enterCurrentRoom` marks the destination explored on every successful move
anyway, so a revealed room the player never walks into stays unexplored in the save.

`examples/mods/mercy-stone` introduces a whole new ITEM with no item-registration endpoint. It
overlays one `Items` soul-stone leaf plus its strings, teaches `GameData.soulStoneByElement` a new
element key so every shipped consumer (stat accumulator, equip slot, save snapshot, card badge,
picker, info popup) carries it, bakes its two atlas frames from shipped art through
`AssetLibrary.atlas`, stocks itself in the Shop's Items aisle for 100 silver by wrapping
`StoreFlow.show`'s own checkout callback, and clamps its holder's damage at the engine's single
`applyHpDelta` mutation point so the holder can never land a killing blow.

The clamp is also announced. `core.events` is the live event log and every consumer slices it, so
the `damageDealt` a clamped hit emits keeps its object identity all the way into
`AbilityRenderer.renderResult`; the package marks that one object in a `WeakSet` and spawns a blue
localized "Mercy!" floater for exactly the events it marked. Spawning before the wrapped call
reserves the lower paint order a reactive dispatch has natively — the slot the shipped `StunProcBuff`
call-out uses — so the message sits under the move art at the row the damage number never occupies.

Its one presentation seam is `PartyEditorFlow.buildStonePickerRowDisplay`, which composes a single
owned-stone row's `SmallItemDisplay` body. The shipped body describes a stone by its positive stat
strip and refuses one that has none, so the package returns its own body for its element and falls
through to `next` for every other stone. The paged Insert Soul Stone display still owns the row
wrapper, selection pulse, hit arbitration, page slicing, and the Drop/Insert/Info actions, so the
new item is an ordinary member of that list rather than a row appended outside its model.

`examples/mods/wand-pointer-trail` is a small presentation-only streamer aid. It attaches passive
Pointer Event listeners to the live game canvas at `boot:ready` and mounts one non-interactive Pixi
overlay above the stage. Sparkles are emitted only for a primary mouse, touch, or pen sequence that
began on the canvas; movement leaves an interpolated trail, a stationary hold keeps a wand tip
visible, and emitted particles fade briefly after release. It intercepts the shared `Popup.show`
class method to recognize completed `portOptionsContent` bodies and append a real draggable Trail
slider before the popup is measured. The persisted 0.50x-5.00x value scales both effect radius and
emission density immediately in startup, world, and dungeon Options. It also demonstrates cleaning
up DOM, ticker, and display-object ownership across renderer restarts and mod disposal.
