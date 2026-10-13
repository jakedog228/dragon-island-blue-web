return function createTurnCounter(digest) {
  return {
    apiVersion: "pvp-adapter-v1", rulesId: "example.turn-counter-v1", digest,
    requires: ["example.echo-strike-v1"],
    create() {
      const turns = [0, 0];
      return {
        afterCommand(_command, turn) { turns[turn.team]++; },
        state: () => ({ turns: [...turns] }),
      };
    },
  };
};
