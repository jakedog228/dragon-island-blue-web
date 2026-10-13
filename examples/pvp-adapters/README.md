# Dormant PvP adapter development fixtures

**Gameplay mods are disabled in live PvP.** These fixtures remain for engine/API development;
they are not PvP demonstration material. Matching adapters do not bypass cosmetic-only admission.
The historical recipe below is no longer an enabled play path.

Build with `node examples/pvp-adapters/build.mjs` from the repository root. This creates
`dist/echo-strike.dibmod`, `dist/turn-counter.dibmod` and the matching operator `dist/server.mjs`.
Echo Strike adds a two-hit action and custom canvas targeting to PvP. Turn Counter requires
Echo Strike and observes resolved commands with independent replayed state. They do not modify
campaign combat and are examples, not reviewed releases of the existing official gameplay mods.

Configure the local API's `DIB_PVP_ADAPTERS_MODULE` with the absolute `server.mjs` path. Select
both packages and Multiplayer PvP on two Offline clients, invite/join through Tournament, then
choose Mod actions. Use the named strike button or Aim Echo Strike and tap an opponent.

The build is deterministic and copies the same hashed rules into client and server artifacts.
Generated files are gitignored. Full contracts, limits and browser reproduction steps:
[authoring guide](../../docs/pvp-adapter-api.md).
