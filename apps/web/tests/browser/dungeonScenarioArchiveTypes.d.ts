declare module "*.mjs" {
  export interface DungeonScenarioFixture {
    readonly label: string;
    readonly route: {
      readonly typeName: string;
      readonly sourceFile: string;
      readonly floor: number;
      readonly entryZoneName: string;
    };
    readonly instanceName: string;
    readonly expectedRuntimeDiagnostics: readonly string[];
  }

  export const DUNGEON_SCENARIO_FIXTURES: readonly DungeonScenarioFixture[];
  export function createDungeonScenarioArchive(): Uint8Array;
}
