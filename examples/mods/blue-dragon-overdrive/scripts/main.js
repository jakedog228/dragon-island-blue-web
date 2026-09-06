// Full-trust mods can replace any lifecycle value. This example clones only what it changes so
// the selected archive remains reusable if activation fails later.
dibMod.hooks.on("content:loaded", ({ value: content }) => {
  const monsters = structuredClone(content.data.monsters);
  monsters.Dragon.BlueBabyDragon.rootStats.Attack = 7.5;
  monsters.Dragon.BlueBabyDragon.rootStats.Speed = 9.5;
  return {
    ...content,
    data: { ...content.data, monsters },
  };
});
