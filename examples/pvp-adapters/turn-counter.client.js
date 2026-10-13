const { registerPvpAdapter } = await dibMod.modules.load("web/pvp/pvpAdapters.ts");
const factory = await dibMod.files.run("rules.js");
const { digest } = dibMod.files.json("rules-identity.json");
dibMod.onDispose(registerPvpAdapter({ rules: factory(digest) }));
