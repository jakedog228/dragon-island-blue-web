# PvP adapter API

As of 2026-10-06, gameplay mods are **disabled in PvP**, including matching selections and
operator-installed adapters. Invite/join/reconnect admission rejects them, and the server rejects
custom adapter commands. The battle has no Match menu or custom mod-action UI. Future gameplay
support must use actual project mods through the ordinary battle controls.

The API below documents retained development infrastructure, not currently supported PvP play.
Echo Strike and Turn Counter remain test fixtures only. Historical installation and browser recipes
below cannot enable gameplay mods under the current policy; see [current PvP rules](pvp.md).

## Shared rules

Import `PvpBattleAdapter`, `PvpBattleAdapterInstance`, `PvpIntent` and `PvpTurn` from `@dib/engine`.
An adapter exports:

```ts
const adapter: PvpBattleAdapter = {
  apiVersion: "pvp-adapter-v1",
  rulesId: "author.mechanic-v1",
  digest: "<SHA-256 of the immutable shared rules artifact>",
  requires: [],   // Required adapters must precede this adapter.
  conflicts: [],  // Refuse profiles containing these rules IDs.
  create({ data, session, random }) {
    // Fresh private state for each replay; never shared between matches.
    return {
      commands: {
        actionName: {
          parse(input) { /* Strictly validate every field; reject extras. */ },
          execute(parsed, turn) { /* Resolve one complete session turn. */ },
        },
      },
      beforeCommand(command, turn) { /* Ordered guard/observer. */ },
      afterCommand(command, turn) { /* Update deterministic private state. */ },
      state() { return {}; }, // Small read-only presentation snapshot.
    };
  },
};
```

`create` runs before the session starts, once per replay. Use instance-local state and session
methods; do not patch global prototypes or mutate shared `GameData`. Hooks run in profile order
around accepted ability, delay and custom commands. They do not run for forfeit or automatic
Berserk/status turns. Those events remain available in `session.events` for derived state.

Custom actions use `{ type: "adapter", actorId, rulesId, command, input }`. Ownership, current
actor, revision and decision ID are checked by the host. `parse` runs before any command hook
or handler. It must reject invented outcomes, damage, RNG draws/seeds, prices, rewards, clocks,
campaign state and unknown fields. Validate targets and eligibility again in `execute` against
the live session and `turn.team`; never assume the local player is canonical team 0.

`input` permits at most 16 named fields containing strings (160 characters), finite numbers
within +/-1,000,000, booleans or arrays of up to 128 such scalars. Nested objects/snapshots are
not allowed. HTTP body limits still apply. Each adapter owns a stricter semantic schema inside
that envelope. Input samples are untrusted intent, never proof of timing or a successful hit.

Use `session.submitPlayerAction`, `submitDelayAction`, or the existing
`beginScriptedPlayerAction` / `performScriptedPlayerAbility` / `finishScriptedPlayerAction`
sequence. A handler must synchronously resolve one complete turn. Leaving an action pending
fails replay; partial command state is discarded. Do not use async handlers, wall clocks,
network/filesystem I/O, browser frame time or unrecorded randomness. Use the supplied `random`
or session scripted RNG methods so every draw enters the committed tape.

State is reconstructed from commands and committed draws. There is no client-authored adapter
state or replacement snapshot endpoint. Returning a new object from `state()` prevents UI code
from mutating the private state. The ordered `{rulesId,digest}` list is pinned in the transcript;
missing, reordered or changed rules fail replay. Preserve old implementations for retained
matches. Change both versioned rules IDs and artifact digests when semantics change. The digest
must cover all mechanical dependencies and content transformations, not merely a wrapper file.
This is an operator review obligation, not a sandbox or proof that arbitrary JavaScript is pure.

## Browser registration and controls

A `.dibmod` activates its shared rules and registers its presentation through the public module:

```js
const { registerPvpAdapter } = await dibMod.modules.load("web/pvp/pvpAdapters.ts");
dibMod.onDispose(registerPvpAdapter({
  rules: adapter,
  label: "Custom action",
  controls({ game, battle, turn, you }) {
    return [{ id: "action", label: "Use action", command: "actionName", input: {} }];
  },
}));
```

Only adapters named by the committed match are selected. Missing client implementations or
digest mismatches produce a visible error instead of replaying with baseline rules. Dispose
registration with the mod runtime. Duplicate registration is an error.

`controls` supplies paged **Mod actions** buttons. For aiming, gestures or a different local
interaction, implement optional `mount(context)`, returning a cleanup function. Its context
includes `root` (the current Pixi board), `width`, `height`, `controlsTop`, `targets` (canonical
monster IDs mapped to board-local centers), the normal `game/battle/turn/you`, and
`submit(command,input)` / `back()` callbacks. The default Match menu and Back controls remain
available; keep them unobstructed. Use window-relative geometry for this new presentation.

Mounts exist only on the owning player's turn and are disposed on redraw, pending submission,
revision change or scene disposal. Remove listeners, timers and external nodes in cleanup.
Submission uses the regular command controller, including duplicate suppression, exact-envelope
retry and revision checks. Presentation can prepare reversible local feedback, but damage and
outcomes wait for the server result. Neither callback may modify the replayed session.

## Operator installation and combinations

Server types are exported from `@dib/game-server/pvp-adapters`. Bundle a self-contained local
ESM module exporting `apiVersion = "pvp-server-adapters-v1"` and
`install({ data, logicPackId })`. It returns:

```ts
{
  mods: [{ id, version, digest: exactDibmodArchiveSha256,
    support: { kind: "rules", rulesId: adapter.rulesId } }],
  profiles: [{ id: "author-profile-v1", logicPackId, data,
    rules: [adapter.rulesId], adapters: [adapter] }],
}
```

Configure `DIB_PVP_ADAPTERS_MODULE` with its local filesystem path. An absent setting retains
baseline/Wand support. Startup imports only that operator-selected module; no HTTP request,
archive upload or manifest can choose server code. Invalid APIs, duplicate profiles/combinations,
missing implementations, dependency order and conflicts fail startup. Do not put executable
modules in player-writable storage. Production deployment must explicitly include the reviewed
artifact and configuration; setting this up locally does not deploy it.

Each approved combination gets an explicit profile with the same ordered `rules` and
`adapters`. Installing A and B separately does not approve A+B. A mechanical mod maps to one
rules ID; a package with several mechanics can aggregate them behind that adapter. Both clients
must select mechanically equivalent releases in the same order. Cosmetic selections may differ.
Different releases may map to one rules ID only after review confirms identical mechanics.

For data additions, construct a separate profile-owned `GameData` with the same transformations
as the selected browser packages; never mutate the baseline instance. `logicPackId` identifies
the resource catalog's rules while exact reviewed mod identities and the adapter artifacts bind
the modifications. Both clients need the relevant local content/assets. The server does not send
resource bytes, merge arbitrary modsets or distribute an opponent's archive.

Campaign Offline/Official isolation is unchanged. Executable mods still cannot launch Official
campaigns. An Official entrant contributes only a validated, committed slot projection; adapter
commands cannot change that campaign. This API is for the isolated PvP exhibition.

## Runnable example and proof

`examples/pvp-adapters/` contains two separate mods: **Echo Strike**, a two-hit scripted action,
and **Turn Counter**, an ordered dependent observer. They use no prototype patches. The builder
hashes the shared rule sources and exact archives, then emits matching client packages and a
self-contained server module:

```powershell
node examples/pvp-adapters/build.mjs
$env:DIB_PVP_ADAPTERS_MODULE = (Resolve-Path examples/pvp-adapters/dist/server.mjs).Path
# Start the local API with its normal isolated data/secret/content settings.
# Select both generated .dibmod files plus built-in Multiplayer PvP on each Offline client.
```

For authorized browser checks, start the isolated API and fresh Vite preview described in
`pvp.md`. Set `DIB_PVP_HOST_MOD` and `DIB_PVP_GUEST_MOD` to the two absolute `.dibmod` paths,
separated by `;`, and set `DIB_PVP_ADAPTER_EXAMPLE=1`. Run `pnpm scenario:pvp`; repeat with
`DIB_DISPLAY_MODE=ipad`. `DIB_PVP_LOST_RESPONSE=1` exercises retry of a committed custom action.
The scenario clicks a declared action and custom canvas target, compares both adapters' state
on both clients, reopens the match and forfeits. Inspect the aim/battle screenshots and JSON.

On 2026-10-05 both muted phone/tablet runs passed and their screenshots were inspected.
Engine/server tests additionally cover both teams, multi-hit damage, private-state isolation,
recorded RNG, strict input/target/ownership rejection, dependency/conflict/digest errors, file
restart, rollback, exact retry after later moves, and absent executable implementations.
These prove the adapter API and examples, not native compatibility of other existing mods.
