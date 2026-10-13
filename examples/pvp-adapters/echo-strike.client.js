const { registerPvpAdapter } = await dibMod.modules.load("web/pvp/pvpAdapters.ts");
const { Container, Graphics } = await dibMod.modules.load("pixi.js");
const { makeTtfLabel } = await dibMod.modules.load("@dib/renderer");
const factory = await dibMod.files.run("rules.js");
const { digest } = dibMod.files.json("rules-identity.json");
dibMod.onDispose(registerPvpAdapter({
  rules: factory(digest), label: "Aim Echo Strike",
  mount({ root, width, height, controlsTop, targets, battle, turn, submit }) {
    const layer = new Container(); root.addChild(layer);
    const caption = makeTtfLabel("Tap an opponent for Echo Strike", height * 0.034, { outline: false });
    caption.position.set(width * 0.025, controlsTop); layer.addChild(caption);
    for (const target of battle.session.targetableIdsOf(turn.team === 0 ? 1 : 0)) {
      const point = targets.get(target);
      if (!point) continue;
      const marker = new Graphics().circle(0, 0, height * 0.07).fill({ color: 0x99ddff, alpha: 0.25 }).stroke({ color: 0x99ddff, width: height * 0.006 });
      marker.position.set(point.x, point.y); marker.label = `pvp:echo-aim:${target}`; marker.eventMode = "static"; marker.cursor = "pointer";
      marker.on("pointertap", (event) => { event.stopPropagation(); submit("strike", { target }); });
      layer.addChild(marker);
    }
    return () => { layer.parent?.removeChild(layer); layer.destroy({ children: true }); };
  },
  controls({ battle, turn }) {
    const choice = turn.choices.find((choice) => choice.slot === "usable1");
    if (!choice || choice.blockReason || choice.targeting.kind !== "enemies" || choice.targeting.count !== 1) return [];
    return battle.session.targetableIdsOf(turn.team === 0 ? 1 : 0).map((target, index) => ({
      id: `strike-${index}`, label: `Echo strike: ${battle.session.shortTypeOf(target)}`,
      command: "strike", input: { target },
    }));
  },
}));
