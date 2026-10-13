# Less Rare Monsters — native web-port edition

Converted from Wolfgang Kern's **Less Rare Monsters v2.0.0**:
https://github.com/Wolfgang-James-Kern/Dragon-Island-Blue-Mods/releases/tag/less-rare-monsters-v2.0.0

The original manifest, documentation and MIT license are preserved in `upstream/`.
The downloaded release ZIP SHA-256 is
`e40132be1de17e0e7574c68094a7c19cbc49743731e61bd3294bb56c373b4a7a`.
License source: repository commit `b3d38f5a150534a143ea9646ae860fcb299dd41a`.

Build with `pnpm mods:examples`. Select your original-compatible game resource archive,
then `examples/mods/dist/less-rare-monsters.dibmod` in the mod picker and launch Offline.
This is an API v4 mod; it needs no launcher, modified IPA, other mod, or game assets in its bundle.
Official play does not accept mods.

The package applies all 15 upstream weight assignments exactly to the seven named monsters
across seven world files. It changes weighted encounter selection, not the travel encounter
rate, and does not guarantee a rare monster on any particular battle. See the upstream README
for the POIs. Missing or ambiguous targets stop activation with an error.

Version 2.0.1 declares this mod **Save-neutral**: all encounters and captured monsters use
existing species, and removing the mod only restores the original encounter weights. It adds no
saved content that needs the mod to remain installed. The overlay still changes the effective
mechanics fingerprint, but Offline compatibility separately records the archive before mods run:
toggling this neutral mod does not warn when the archive and save-dependent mods match. Older
2.0.0 history remains conservatively unclassified. All saves stay in the same paged Offline library.
Other world mods compose in activation order; a later write to the same weight wins. Because
this overlays a resource-reader function, the generic interference report cannot enumerate
individual plist weight collisions.

Manual check: launch with the mod selected, start a game, and travel to a listed POI such as
Charles' Hut. Ordinary battles should still work with the same monster roster; the listed
rare monster's weight is increased. A short play session cannot establish spawn probabilities.
Automated tests check every changed leaf, source immutability, effective identity versus save compatibility, loader acceptance,
and failure on incompatible archives. Browser verification is opt-in and has not been run.
