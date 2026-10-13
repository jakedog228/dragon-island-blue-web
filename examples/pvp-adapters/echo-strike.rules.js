// Shared rules artifact. files.run() returns this factory in the browser; the builder embeds
// these exact bytes in the operator's ESM module. No browser globals or prototype changes.
return function createEchoStrike(digest) {
  return {
    apiVersion: "pvp-adapter-v1", rulesId: "example.echo-strike-v1", digest,
    create({ session }) {
      const strikes = [0, 0];
      return {
        commands: {
          strike: {
            parse(input) {
              if (Object.keys(input).length !== 1 || typeof input.target !== "string") {
                throw new Error("Echo strike expects only a target monster ID");
              }
              return input.target;
            },
            execute(target, turn) {
              const choice = turn.choices.find((choice) => choice.slot === "usable1");
              if (!choice || choice.blockReason || choice.targeting.kind !== "enemies" || choice.targeting.count !== 1) {
                throw new Error("Echo strike requires an available single-enemy first ability");
              }
              if (!session.targetableIdsOf(turn.team === 0 ? 1 : 0).includes(target)) {
                throw new Error("Echo strike target must be a living opponent");
              }
              session.beginScriptedPlayerAction("usable1");
              for (let hit = 0; hit < 2; hit++) {
                if (!session.targetableIdsOf(turn.team === 0 ? 1 : 0).includes(target)) break;
                session.performScriptedPlayerAbility({ enemyTargets: [target], friendlyTargets: [] });
                strikes[turn.team]++;
              }
              session.finishScriptedPlayerAction();
            },
          },
        },
        state: () => ({ strikes: [...strikes] }),
      };
    },
  };
};
