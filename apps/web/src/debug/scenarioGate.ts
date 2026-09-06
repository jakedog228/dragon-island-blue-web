import type { StatName } from "@dib/gamedata";
import type { ImportedContentPackage } from "../content/archivePackage.js";
import {
  DEFAULT_SCENARIO_CONFIGURATION,
  SCENARIO_COMBAT_EXAMPLES,
  SCENARIO_USABLE_SLOTS,
  parseScenarioSeed,
  type ScenarioCombatantConfiguration,
  type ScenarioConfiguration,
  type ScenarioFixedCombatConfiguration,
  type ScenarioGemConfiguration,
  type ScenarioJobAbilityConfiguration,
  type ScenarioKind,
  type ScenarioPassiveAbilityConfiguration,
  type ScenarioTransport,
} from "./scenarioMode.js";
import {
  MAX_SCENARIO_TEAM_SIZE,
  fixedCombatScenarioCatalog,
  fixedCombatScenarioExample,
  scenarioCombatantForMonster,
  type FixedCombatScenarioCatalog,
} from "./fixedCombatScenario.js";
import { ScenarioSaveStore } from "./scenarioSaveStore.js";
import {
  parseFixedCombatScenarioDocument,
  stringifyFixedCombatScenarioDocument,
} from "./fixedCombatScenarioDocument.js";

const STAT_NAMES: readonly StatName[] = [
  "Attack", "Defense", "Magic", "MaxHP", "Resist", "Speed",
];

type ScenarioIconName =
  | "add" | "apply" | "close" | "code" | "copy" | "download" | "edit"
  | "load" | "paste" | "reset" | "trash";

function scenarioIcon(name: ScenarioIconName): string {
  const paths: Record<ScenarioIconName, string> = {
    add: '<path d="M12 5v14M5 12h14"/>',
    apply: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    code: '<path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/>',
    copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    download: '<path d="M12 3v12m0 0 5-5m-5 5-5-5M5 21h14"/>',
    edit: '<path d="m4 20 4.2-1 10.9-10.9a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z"/><path d="m14.5 6.5 3 3"/>',
    load: '<path d="M3 19V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2"/><path d="M3 19h16l2-8H7a2 2 0 0 0-1.9 1.4L3 19Z"/>',
    paste: '<path d="M9 5h6M9 3h6v4H9z"/><path d="M7 5H5v16h14V5h-2"/>',
    reset: '<path d="M4 11a8 8 0 1 1 2.3 6.7M4 11V5m0 6h6"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

function iconButton(
  name: ScenarioIconName,
  label: string,
  attributes: string,
  className = "",
): string {
  return `<button class="content-gate__scenario-icon-button ${className}" type="button" ${attributes}` +
    ` aria-label="${label}" title="${label}">${scenarioIcon(name)}</button>`;
}

export function scenarioGateMarkup(settingsIcon: string): string {
  return `
    <div class="content-gate__save-mode-row content-gate__save-mode-row--scenario">
      <label><input type="radio" name="save-mode" value="scenario"> Scenario</label>
      <button class="content-gate__settings-button" type="button"
              data-storage-settings="scenario" aria-label="Scenario settings"
              title="Scenario settings">${settingsIcon}</button>
    </div>
    <div class="content-gate__mode-detail content-gate__scenario-config"
         data-mode-detail="scenario" hidden>
      <div class="content-gate__mode-detail-heading">
        <strong>Scenario session</strong>
        <span>Transient testing only; never writes browser saves or Official state.</span>
      </div>
      <label>Scenario
        <select name="scenario-kind">
          <option value="combat">Fixed combat encounter</option>
          <option value="egg">Egg spinning</option>
          <option value="arena">Arena</option>
        </select>
      </label>
      <label>Runtime transport
        <select name="scenario-transport">
          <option value="offline">Offline (immediate)</option>
          <option value="online">Online simulation (async + latency)</option>
        </select>
      </label>
      <label class="content-gate__scenario-egg">Egg
        <select name="scenario-egg-kind">
          <option value="silver">Silver</option>
          <option value="gold">Gold</option>
        </select>
      </label>
      <label class="content-gate__scenario-combat" hidden>Encounter example
        <select name="scenario-combat-example">
          <option value="random">Seeded random roster</option>
          <option value="reserve">Reserve promotion 6v6</option>
          <option value="starter">Starter dragons 3v3</option>
          <option value="ice-storm">Ice Storm mirror 2v2</option>
        </select>
      </label>
      <div class="content-gate__scenario-custom-launcher" hidden>
        <span>
          <strong>Editable fixed encounter</strong>
          <small data-scenario-builder-summary>Choose an archive to build this encounter.</small>
        </span>
        <span class="content-gate__scenario-launcher-actions">
          ${iconButton("reset", "Reset example", "data-scenario-example-reset")}
          ${iconButton("edit", "Edit encounter", "data-scenario-builder-open", "content-gate__scenario-icon-button--primary")}
        </span>
      </div>
      <div class="content-gate__scenario-seed-controls">
        <label>Seed
          <input type="text" name="scenario-seed" value="0x5343454e" spellcheck="false">
        </label>
        <label class="content-gate__scenario-randomize">
          <input type="checkbox" name="scenario-randomize"> <span data-scenario-randomize-label>Randomize on each load</span>
        </label>
      </div>
      <p class="content-gate__scenario-note"></p>
      <dialog class="content-gate__scenario-dialog" aria-labelledby="scenario-builder-title">
        <div class="content-gate__scenario-dialog-card">
          <header class="content-gate__scenario-dialog-header">
            <span>
              <span class="content-gate__scenario-dialog-eyebrow">Scenario tools</span>
              <strong id="scenario-builder-title">Fixed encounter editor</strong>
              <small>Every example becomes ordinary editable encounter data.</small>
            </span>
            <span class="content-gate__scenario-dialog-actions">
              ${iconButton("code", "Import or export encounter JSON", "data-scenario-json-toggle")}
              ${iconButton("close", "Close encounter editor", "data-scenario-builder-close", "content-gate__scenario-dialog-close")}
            </span>
          </header>
          <section class="content-gate__scenario-builder">
            <div class="content-gate__scenario-builder-heading">
              <strong>Encounter setup</strong>
              <small>Combat kits, passives, starting state, resources, and both teams are fixed before boot.</small>
            </div>
            <section class="content-gate__scenario-json" hidden>
              <header>
                <span><strong>Encounter JSON</strong><small>Versioned, archive-validated, and safe to copy, paste, save, or load.</small></span>
                <span class="content-gate__scenario-json-actions">
                  ${iconButton("reset", "Refresh JSON from editor", "data-scenario-json-refresh")}
                  ${iconButton("copy", "Copy encounter JSON", "data-scenario-json-copy")}
                  ${iconButton("paste", "Paste encounter JSON", "data-scenario-json-paste")}
                  ${iconButton("apply", "Apply encounter JSON", "data-scenario-json-apply", "content-gate__scenario-icon-button--primary")}
                  ${iconButton("download", "Download encounter JSON", "data-scenario-json-download")}
                  ${iconButton("load", "Load encounter JSON file", "data-scenario-json-load")}
                </span>
              </header>
              <textarea data-scenario-json-text spellcheck="false" aria-label="Encounter JSON"></textarea>
              <input data-scenario-json-file type="file" accept="application/json,.json" hidden>
              <small data-scenario-json-status aria-live="polite"></small>
            </section>
            <section class="content-gate__scenario-options">
              <label>Background
                <select name="scenario-combat-background"></select>
              </label>
              <div class="content-gate__scenario-flags">
                <label><input type="checkbox" name="scenario-allow-retreat" checked> Allow retreat</label>
                <label><input type="checkbox" name="scenario-block-capture"> Block capture</label>
                <label><input type="checkbox" name="scenario-breeder-enabled"> Boss battle / breeder</label>
              </div>
              <label class="content-gate__scenario-breeder-multiplier" hidden>Breeder XP multiplier
                <input type="number" name="scenario-breeder-xp" min="0" step="0.1" value="1">
              </label>
            </section>
            <details class="content-gate__scenario-resources">
              <summary>Player battle resources</summary>
              <p>These values drive Spend Silver, capture cards, Hero skills, and the Spirit action. Save Me stays blocked because a transient encounter has no durable recovery owner.</p>
              <div class="content-gate__scenario-resource-grid">
                <label>Hero level<input type="number" name="scenario-hero-level" min="1" step="1"></label>
                <label>Silver<input type="number" name="scenario-silver" min="0" step="1"></label>
                <label>Gold<input type="number" name="scenario-gold" min="0" step="1"></label>
                <label>Spirit charge %<input type="number" name="scenario-spirit-percent" min="0" max="100" step="1"></label>
                <label>Card I<input type="number" name="scenario-card-1" min="0" step="1"></label>
                <label>Card II<input type="number" name="scenario-card-2" min="0" step="1"></label>
                <label>Card III<input type="number" name="scenario-card-3" min="0" step="1"></label>
              </div>
              <fieldset class="content-gate__scenario-stat-fieldset">
                <legend>Hero skill points</legend>
                <div class="content-gate__scenario-stat-grid" data-scenario-hero-skills>
                  ${STAT_NAMES.map((stat) => `<label>${stat}<input type="number" data-scenario-stat="${stat}" min="0" step="1" value="0"></label>`).join("")}
                </div>
              </fieldset>
              <fieldset class="content-gate__scenario-stat-fieldset content-gate__scenario-gems">
                <legend>Equipped Gems</legend>
                <p>Each equipped Gem adds its level to enabled stats (1.5x for Defense and Resist) on every friendly.</p>
                ${[0, 1, 2, 3].map((slot) => `
                  <section data-scenario-gem-slot="${slot}">
                    <header><label><input type="checkbox" data-scenario-gem-enabled> Slot ${slot + 1}</label></header>
                    <div data-scenario-gem-fields hidden>
                      <label>Level<input type="number" data-scenario-gem-level min="1" step="1" value="1"></label>
                      <label>Quality<input type="number" data-scenario-gem-quality min="0" step="1" value="0"></label>
                      <span>${STAT_NAMES.map((stat) => `<label><input type="checkbox" data-scenario-gem-stat="${stat}"> ${stat}</label>`).join("")}</span>
                    </div>
                  </section>`).join("")}
              </fieldset>
              <fieldset class="content-gate__scenario-stat-fieldset content-gate__scenario-spirits">
                <legend>Unlocked Spirits</legend>
                <p>Enable the Spirit species available to this package and set its grade index (0=F-, 18=S).</p>
                <div data-scenario-spirit-rows></div>
              </fieldset>
            </details>
            <div class="content-gate__scenario-teams">
              <section class="content-gate__scenario-team" data-scenario-team="player">
                <header><strong>Player side</strong>${iconButton("add", "Add player combatant", 'data-scenario-add="player"')}</header>
                <div data-scenario-rows="player"></div>
              </section>
              <section class="content-gate__scenario-team" data-scenario-team="enemy">
                <header><strong>Enemy side</strong>${iconButton("add", "Add enemy combatant", 'data-scenario-add="enemy"')}</header>
                <div data-scenario-rows="enemy"></div>
              </section>
            </div>
            <datalist id="scenario-monster-options"></datalist>
            <datalist id="scenario-combat-ability-options"></datalist>
            <datalist id="scenario-all-ability-options"></datalist>
          </section>
          <footer class="content-gate__scenario-dialog-footer">
            <span data-scenario-builder-summary>Choose an archive to build this encounter.</span>
            ${iconButton("apply", "Done editing encounter", "data-scenario-builder-done", "content-gate__scenario-icon-button--primary")}
          </footer>
        </div>
      </dialog>
      <dialog class="content-gate__scenario-confirm" aria-labelledby="scenario-confirm-title">
        <form method="dialog">
          <strong id="scenario-confirm-title">Confirm encounter change</strong>
          <p data-scenario-confirm-message></p>
          <footer>
            ${iconButton("close", "Cancel", 'value="cancel" data-scenario-confirm-cancel')}
            ${iconButton("apply", "Confirm", 'value="confirm" data-scenario-confirm-accept', "content-gate__scenario-icon-button--danger")}
          </footer>
        </form>
      </dialog>
    </div>`;
}

export function installScenarioGate(panel: HTMLElement): {
  readonly config: HTMLElement;
  setContent(content: ImportedContentPackage | undefined): void;
  update(selected: boolean): void;
  selectAndFocus(): void;
  acquire(content: ImportedContentPackage): {
    readonly content: ImportedContentPackage;
    readonly saveStore: ScenarioSaveStore;
    readonly scenario: {
      readonly configuration: ScenarioConfiguration;
      readonly store: ScenarioSaveStore;
    };
  };
} {
  installStyles();
  const config = requiredElement<HTMLElement>(panel, ".content-gate__scenario-config");
  const dialog = requiredElement<HTMLDialogElement>(config, ".content-gate__scenario-dialog");
  const confirmDialog = requiredElement<HTMLDialogElement>(config, ".content-gate__scenario-confirm");
  const builderLauncher = requiredElement<HTMLElement>(config, ".content-gate__scenario-custom-launcher");
  const exampleInput = requiredElement<HTMLSelectElement>(config, 'select[name="scenario-combat-example"]');
  const backgroundInput = requiredElement<HTMLSelectElement>(config, 'select[name="scenario-combat-background"]');
  const seedInput = requiredElement<HTMLInputElement>(config, 'input[name="scenario-seed"]');
  let catalog: FixedCombatScenarioCatalog | undefined;
  let selectedContent: ImportedContentPackage | undefined;
  let confirmationResolver: ((confirmed: boolean) => void) | undefined;
  let editorSourceLabel = "Seeded random roster";
  let editorUsesGeneratorSeed = true;

  const settleConfirmation = (confirmed: boolean): void => {
    const resolve = confirmationResolver;
    confirmationResolver = undefined;
    if (confirmDialog.open) confirmDialog.close();
    resolve?.(confirmed);
  };
  const requestConfirmation = (message: string): Promise<boolean> => {
    if (confirmationResolver !== undefined) {
      throw new Error("A Scenario confirmation is already open.");
    }
    requiredElement<HTMLElement>(confirmDialog, "[data-scenario-confirm-message]").textContent = message;
    confirmDialog.showModal();
    return new Promise((resolve) => { confirmationResolver = resolve; });
  };
  requiredElement<HTMLButtonElement>(confirmDialog, "[data-scenario-confirm-cancel]")
    .addEventListener("click", () => settleConfirmation(false));
  requiredElement<HTMLButtonElement>(confirmDialog, "[data-scenario-confirm-accept]")
    .addEventListener("click", () => settleConfirmation(true));
  confirmDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    settleConfirmation(false);
  });

  const rebuildSpiritRows = (): void => {
    const host = requiredElement<HTMLElement>(config, "[data-scenario-spirit-rows]");
    host.replaceChildren(...(catalog?.spirits ?? []).map((entry) => {
      const row = document.createElement("section");
      row.dataset["scenarioSpirit"] = entry.value;
      row.innerHTML = `
        <label><input type="checkbox" data-scenario-spirit-enabled> <span></span></label>
        <label data-scenario-spirit-tier-host hidden>Grade index
          <input type="number" data-scenario-spirit-tier min="0" max="18" step="1" value="0">
        </label>`;
      requiredElement<HTMLElement>(row, "span").textContent = `${entry.label} - ${entry.value}`;
      requiredElement<HTMLInputElement>(row, "[data-scenario-spirit-enabled]")
        .addEventListener("change", (event) => {
          requiredElement<HTMLElement>(row, "[data-scenario-spirit-tier-host]").hidden =
            !(event.currentTarget as HTMLInputElement).checked;
        });
      return row;
    }));
  };

  const teamRows = (team: "player" | "enemy"): HTMLElement =>
    requiredElement<HTMLElement>(config, `[data-scenario-rows="${team}"]`);
  const refreshBuilderSummary = (): void => {
    const playerCount = teamRows("player").children.length;
    const enemyCount = teamRows("enemy").children.length;
    const background = backgroundInput.value || "No background selected";
    const summary = `${editorSourceLabel} - ${playerCount} player vs ${enemyCount} enemy - ${background}`;
    for (const node of config.querySelectorAll<HTMLElement>("[data-scenario-builder-summary]")) {
      node.textContent = summary;
    }
  };
  const closeBuilder = (): void => {
    if (dialog.open) dialog.close();
  };
  const openBuilder = (): void => {
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLInputElement>('[data-scenario-field="monster"]')?.focus();
  };
  const refreshTeamButtons = (): void => {
    for (const team of ["player", "enemy"] as const) {
      const rows = teamRows(team).children;
      requiredElement<HTMLButtonElement>(config, `[data-scenario-add="${team}"]`).disabled =
        catalog === undefined || rows.length >= MAX_SCENARIO_TEAM_SIZE;
      for (const button of teamRows(team).querySelectorAll<HTMLButtonElement>("[data-scenario-remove]")) {
        button.disabled = rows.length <= 1;
      }
      [...teamRows(team).querySelectorAll<HTMLElement>(".content-gate__scenario-combatant")]
        .forEach((row, index) => {
          requiredElement<HTMLElement>(row, ":scope > header > strong").textContent =
            `Combatant ${index + 1}`;
        });
    }
    refreshBuilderSummary();
  };

  const addPassiveRow = (
    host: HTMLElement,
    passive?: ScenarioPassiveAbilityConfiguration,
  ): void => {
    const row = document.createElement("div");
    row.className = "content-gate__scenario-passive";
    row.innerHTML = `
      <label>Slot name<input type="text" data-scenario-passive-field="slot" spellcheck="false"></label>
      <label>Ability<input type="text" data-scenario-passive-field="ability"
        list="scenario-all-ability-options" autocomplete="off" spellcheck="false"></label>
      <details><summary>Arguments JSON</summary><textarea data-scenario-passive-field="arguments" spellcheck="false"></textarea></details>
      ${iconButton("trash", "Remove passive ability", "data-scenario-passive-remove", "content-gate__scenario-icon-button--danger")}`;
    requiredElement<HTMLInputElement>(row, '[data-scenario-passive-field="slot"]').value =
      passive?.slot ?? `ScenarioPassive${host.children.length + 1}`;
    requiredElement<HTMLInputElement>(row, '[data-scenario-passive-field="ability"]').value =
      passive?.abilityPath ?? catalog?.allAbilities[0]?.value ?? "";
    requiredElement<HTMLTextAreaElement>(row, '[data-scenario-passive-field="arguments"]').value =
      JSON.stringify(passive?.arguments ?? {}, null, 2);
    requiredElement<HTMLButtonElement>(row, "[data-scenario-passive-remove]")
      .addEventListener("click", () => row.remove());
    host.appendChild(row);
  };

  const writeCombatantRow = (
    row: HTMLElement,
    member: ScenarioCombatantConfiguration,
  ): void => {
    requiredElement<HTMLInputElement>(row, '[data-scenario-field="monster"]').value = member.shortType;
    requiredElement<HTMLInputElement>(row, '[data-scenario-field="level"]').value = String(member.level);
    requiredElement<HTMLInputElement>(row, '[data-scenario-field="current-hp"]').value =
      member.currentHp === undefined ? "" : String(member.currentHp);
    requiredElement<HTMLInputElement>(row, '[data-scenario-field="boss"]').checked = member.boss;
    requiredElement<HTMLInputElement>(row, '[data-scenario-field="capturable"]').checked = member.capturable;
    SCENARIO_USABLE_SLOTS.forEach((slotName, index) => {
      const slot = member.kitSlots[index] ?? null;
      const ability = requiredElement<HTMLInputElement>(row, `[data-scenario-kit-slot="${slotName}"]`);
      const args = requiredElement<HTMLTextAreaElement>(row, `[data-scenario-kit-arguments="${slotName}"]`);
      ability.value = slot?.abilityPath ?? "";
      ability.dataset["previousAbility"] = ability.value;
      args.value = JSON.stringify(slot?.arguments ?? {}, null, 2);
    });
    const soulEnabled = requiredElement<HTMLInputElement>(row, '[data-scenario-field="soul-enabled"]');
    soulEnabled.checked = member.soulStone !== undefined;
    soulEnabled.disabled = catalog?.soulStonesAvailable !== true;
    requiredElement<HTMLInputElement>(row, '[data-scenario-field="soul-source"]').value =
      member.soulStone?.sourceType ?? member.shortType;
    requiredElement<HTMLInputElement>(row, '[data-scenario-field="soul-level"]').value =
      String(member.soulStone?.level ?? member.level);
    requiredElement<HTMLElement>(row, "[data-scenario-soul-fields]").hidden = !soulEnabled.checked;
    for (const stat of STAT_NAMES) {
      const input = requiredElement<HTMLInputElement>(row, `[data-scenario-flat-stat="${stat}"]`);
      const value = member.flatStatBonuses?.[stat];
      input.value = value === undefined ? "" : String(value);
    }
    const passives = requiredElement<HTMLElement>(row, "[data-scenario-passives]");
    passives.replaceChildren();
    for (const passive of member.passiveAbilities) addPassiveRow(passives, passive);
  };

  const addCombatantRow = (
    team: "player" | "enemy",
    member?: ScenarioCombatantConfiguration,
  ): void => {
    const host = teamRows(team);
    if (host.children.length >= MAX_SCENARIO_TEAM_SIZE) {
      throw new Error(`Scenario ${team} team already has ${MAX_SCENARIO_TEAM_SIZE} combatants.`);
    }
    const row = document.createElement("article");
    row.className = "content-gate__scenario-combatant";
    row.innerHTML = `
      <header><strong>Combatant ${host.children.length + 1}</strong><span class="content-gate__scenario-combatant-actions">
        ${iconButton("reset", "Reset combatant to native setup", "data-scenario-combatant-reset")}
        ${iconButton("trash", "Remove combatant", "data-scenario-remove", "content-gate__scenario-icon-button--danger")}
      </span></header>
      <div class="content-gate__scenario-member-primary">
        <label>Monster<input type="text" data-scenario-field="monster"
          list="scenario-monster-options" autocomplete="off" spellcheck="false"></label>
        <label>Level<input type="number" data-scenario-field="level" min="1" max="150" step="1"></label>
        <label>Starting HP<input type="number" data-scenario-field="current-hp" min="1" step="1" placeholder="Full"></label>
      </div>
      <div class="content-gate__scenario-member-flags">
        <label><input type="checkbox" data-scenario-field="boss"> Boss / status immune</label>
        <label><input type="checkbox" data-scenario-field="capturable" checked> Capturable</label>
      </div>
      <fieldset class="content-gate__scenario-kit">
        <legend>Combat kit</legend>
        <div class="content-gate__scenario-kit-grid">
          ${SCENARIO_USABLE_SLOTS.map((slot, index) => `
            <section class="content-gate__scenario-kit-slot">
              <label>Slot ${index + 1}<input type="text" data-scenario-kit-slot="${slot}"
                list="scenario-combat-ability-options" autocomplete="off" spellcheck="false"
                placeholder="Locked / empty"></label>
              <details><summary>Arguments JSON</summary><textarea data-scenario-kit-arguments="${slot}" spellcheck="false"></textarea></details>
            </section>`).join("")}
        </div>
      </fieldset>
      <details class="content-gate__scenario-member-advanced">
        <summary>Advanced: passives, Soul Stone, starting stat bonuses</summary>
        <section class="content-gate__scenario-soul">
          <label><input type="checkbox" data-scenario-field="soul-enabled"> Equipped Soul Stone</label>
          <div data-scenario-soul-fields hidden>
            <label>Sacrificed monster<input type="text" data-scenario-field="soul-source"
              list="scenario-monster-options" autocomplete="off" spellcheck="false"></label>
            <label>Stone level<input type="number" data-scenario-field="soul-level" min="1" step="1"></label>
          </div>
        </section>
        <fieldset class="content-gate__scenario-stat-fieldset">
          <legend>Flat creation-time stat bonuses</legend>
          <div class="content-gate__scenario-stat-grid">
            ${STAT_NAMES.map((stat) => `<label>${stat}<input type="number" data-scenario-flat-stat="${stat}" step="any" placeholder="0"></label>`).join("")}
          </div>
        </fieldset>
        <section class="content-gate__scenario-passives-section">
          <header><span><strong>Passive job abilities</strong><small>Native passives are preserved when usable slots change.</small></span>${iconButton("add", "Add passive ability", "data-scenario-passive-add")}</header>
          <div data-scenario-passives></div>
        </section>
      </details>`;
    const fallback = catalog?.monsters[0]?.value;
    if (member === undefined) {
      if (catalog === undefined || fallback === undefined) {
        throw new Error("Choose and validate an archive before adding a combatant.");
      }
      member = scenarioCombatantForMonster(catalog, fallback);
    }
    requiredElement<HTMLButtonElement>(row, "[data-scenario-remove]").addEventListener("click", async () => {
      const shortType = requiredElement<HTMLInputElement>(row, '[data-scenario-field="monster"]').value.trim();
      if (!await requestConfirmation(`Remove ${shortType || "this combatant"} from the ${team} side?`)) return;
      row.remove();
      refreshTeamButtons();
    });
    requiredElement<HTMLButtonElement>(row, "[data-scenario-combatant-reset]")
      .addEventListener("click", async () => {
        if (catalog === undefined) return;
        const shortType = requiredElement<HTMLInputElement>(row, '[data-scenario-field="monster"]').value.trim();
        if (catalog.nativeKits[shortType] === undefined) {
          throw new Error(`Cannot reset unknown monster ${shortType}.`);
        }
        if (!await requestConfirmation(
          `Reset ${shortType} to level 12, full HP, no equipment/stat overrides, and its complete native kit?`,
        )) return;
        writeCombatantRow(row, scenarioCombatantForMonster(catalog, shortType));
      });
    requiredElement<HTMLInputElement>(row, '[data-scenario-field="monster"]')
      .addEventListener("change", (event) => {
        if (catalog === undefined) return;
        const shortType = (event.currentTarget as HTMLInputElement).value.trim();
        if (catalog.nativeKits[shortType] === undefined) return;
        const replacement = scenarioCombatantForMonster(catalog, shortType, {
          level: requiredElement<HTMLInputElement>(row, '[data-scenario-field="level"]').valueAsNumber,
          boss: requiredElement<HTMLInputElement>(row, '[data-scenario-field="boss"]').checked,
          capturable: requiredElement<HTMLInputElement>(row, '[data-scenario-field="capturable"]').checked,
        });
        writeCombatantRow(row, replacement);
      });
    for (const ability of row.querySelectorAll<HTMLInputElement>("[data-scenario-kit-slot]")) {
      ability.addEventListener("change", () => {
        if (ability.value !== ability.dataset["previousAbility"]) {
          const slot = ability.dataset["scenarioKitSlot"]!;
          requiredElement<HTMLTextAreaElement>(row, `[data-scenario-kit-arguments="${slot}"]`).value = "{}";
          ability.dataset["previousAbility"] = ability.value;
        }
      });
    }
    requiredElement<HTMLInputElement>(row, '[data-scenario-field="soul-enabled"]')
      .addEventListener("change", (event) => {
        requiredElement<HTMLElement>(row, "[data-scenario-soul-fields]").hidden =
          !(event.currentTarget as HTMLInputElement).checked;
      });
    requiredElement<HTMLButtonElement>(row, "[data-scenario-passive-add]")
      .addEventListener("click", () => addPassiveRow(
        requiredElement<HTMLElement>(row, "[data-scenario-passives]"),
      ));
    writeCombatantRow(row, member);
    host.appendChild(row);
    refreshTeamButtons();
  };

  const replaceTeam = (
    team: "player" | "enemy",
    members: readonly ScenarioCombatantConfiguration[],
  ): void => {
    teamRows(team).replaceChildren();
    for (const member of members) addCombatantRow(team, member);
    refreshTeamButtons();
  };

  const writeResources = (fixed: ScenarioFixedCombatConfiguration): void => {
    const resources = fixed.resources;
    requiredElement<HTMLInputElement>(config, '[name="scenario-hero-level"]').value = String(resources.heroLevel);
    requiredElement<HTMLInputElement>(config, '[name="scenario-silver"]').value = String(resources.silver);
    requiredElement<HTMLInputElement>(config, '[name="scenario-gold"]').value = String(resources.gold);
    requiredElement<HTMLInputElement>(config, '[name="scenario-spirit-percent"]').value =
      String(Math.round(resources.spiritReadiness * 100));
    for (const level of [1, 2, 3] as const) {
      requiredElement<HTMLInputElement>(config, `[name="scenario-card-${level}"]`).value =
        String(resources.captureCards[level]);
    }
    for (const stat of STAT_NAMES) {
      requiredElement<HTMLInputElement>(config, `[data-scenario-hero-skills] [data-scenario-stat="${stat}"]`).value =
        String(resources.skillPoints[stat] ?? 0);
    }
    resources.equippedGems.forEach((gem, slot) => {
      const row = requiredElement<HTMLElement>(config, `[data-scenario-gem-slot="${slot}"]`);
      const enabled = requiredElement<HTMLInputElement>(row, "[data-scenario-gem-enabled]");
      enabled.checked = gem !== null;
      requiredElement<HTMLElement>(row, "[data-scenario-gem-fields]").hidden = gem === null;
      requiredElement<HTMLInputElement>(row, "[data-scenario-gem-level]").value = String(gem?.level ?? 1);
      requiredElement<HTMLInputElement>(row, "[data-scenario-gem-quality]").value = String(gem?.quality ?? 0);
      for (const stat of STAT_NAMES) {
        requiredElement<HTMLInputElement>(row, `[data-scenario-gem-stat="${stat}"]`).checked =
          gem?.enabledStats.includes(stat) ?? false;
      }
    });
    for (const row of config.querySelectorAll<HTMLElement>("[data-scenario-spirit]")) {
      const shortType = row.dataset["scenarioSpirit"]!;
      const tier = resources.spiritTierLevels[shortType];
      const enabled = requiredElement<HTMLInputElement>(row, "[data-scenario-spirit-enabled]");
      enabled.checked = tier !== undefined;
      requiredElement<HTMLElement>(row, "[data-scenario-spirit-tier-host]").hidden = tier === undefined;
      requiredElement<HTMLInputElement>(row, "[data-scenario-spirit-tier]").value = String(tier ?? 0);
    }
  };

  const writeFixedConfiguration = (fixed: ScenarioFixedCombatConfiguration): void => {
    backgroundInput.value = fixed.backgroundKey;
    requiredElement<HTMLInputElement>(config, '[name="scenario-allow-retreat"]').checked = fixed.allowRetreat;
    requiredElement<HTMLInputElement>(config, '[name="scenario-block-capture"]').checked = fixed.blockCapture;
    const breederEnabled = requiredElement<HTMLInputElement>(config, '[name="scenario-breeder-enabled"]');
    breederEnabled.checked = fixed.breederXpBonus !== undefined;
    const breederHost = requiredElement<HTMLElement>(config, ".content-gate__scenario-breeder-multiplier");
    breederHost.hidden = !breederEnabled.checked;
    requiredElement<HTMLInputElement>(config, '[name="scenario-breeder-xp"]').value =
      String(fixed.breederXpBonus ?? 1);
    writeResources(fixed);
    replaceTeam("player", fixed.playerTeam);
    replaceTeam("enemy", fixed.enemyTeam);
    refreshBuilderSummary();
  };

  const jsonPanel = requiredElement<HTMLElement>(config, ".content-gate__scenario-json");
  const jsonText = requiredElement<HTMLTextAreaElement>(jsonPanel, "[data-scenario-json-text]");
  const jsonStatus = requiredElement<HTMLElement>(jsonPanel, "[data-scenario-json-status]");
  const setJsonStatus = (message: string, error = false): void => {
    jsonStatus.textContent = message;
    jsonStatus.dataset["error"] = String(error);
  };
  const currentEncounterJson = (): string => stringifyFixedCombatScenarioDocument(
    readFixedCombatConfiguration(config, catalog),
  );
  const refreshEncounterJson = (): string => {
    const text = currentEncounterJson();
    jsonText.value = text;
    setJsonStatus("JSON refreshed from the current editor state.");
    return text;
  };
  const applyEncounterJson = (text: string): void => {
    if (selectedContent === undefined) throw new Error("Choose an archive before importing JSON.");
    const fixed = parseFixedCombatScenarioDocument(text, selectedContent);
    editorSourceLabel = "Imported encounter";
    editorUsesGeneratorSeed = false;
    seedInput.value = String(DEFAULT_SCENARIO_CONFIGURATION.seed);
    writeFixedConfiguration(fixed);
    refreshSeedControls();
    setJsonStatus("Encounter JSON loaded and validated against this archive.");
  };
  const runJsonAction = (action: () => void | Promise<void>): void => {
    void Promise.resolve().then(action).catch((error: unknown) => {
      setJsonStatus(error instanceof Error ? error.message : String(error), true);
    });
  };

  requiredElement<HTMLButtonElement>(config, "[data-scenario-json-toggle]")
    .addEventListener("click", () => runJsonAction(() => {
      jsonPanel.hidden = !jsonPanel.hidden;
      if (!jsonPanel.hidden) {
        refreshEncounterJson();
        jsonText.focus();
      }
    }));
  requiredElement<HTMLButtonElement>(jsonPanel, "[data-scenario-json-refresh]")
    .addEventListener("click", () => runJsonAction(() => { refreshEncounterJson(); }));
  requiredElement<HTMLButtonElement>(jsonPanel, "[data-scenario-json-copy]")
    .addEventListener("click", () => runJsonAction(async () => {
      if (navigator.clipboard?.writeText === undefined) {
        throw new Error("Clipboard writing is unavailable in this browser; copy from the JSON text box.");
      }
      await navigator.clipboard.writeText(refreshEncounterJson());
      setJsonStatus("Encounter JSON copied to the clipboard.");
    }));
  requiredElement<HTMLButtonElement>(jsonPanel, "[data-scenario-json-paste]")
    .addEventListener("click", () => runJsonAction(async () => {
      if (navigator.clipboard?.readText === undefined) {
        throw new Error("Clipboard reading is unavailable; paste into the JSON text box manually.");
      }
      jsonText.value = await navigator.clipboard.readText();
      setJsonStatus("Clipboard text pasted. Apply it when ready.");
      jsonText.focus();
    }));
  requiredElement<HTMLButtonElement>(jsonPanel, "[data-scenario-json-apply]")
    .addEventListener("click", () => runJsonAction(() => applyEncounterJson(jsonText.value)));
  requiredElement<HTMLButtonElement>(jsonPanel, "[data-scenario-json-download]")
    .addEventListener("click", () => runJsonAction(() => {
      const url = URL.createObjectURL(new Blob([refreshEncounterJson()], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "dragon-island-blue-fixed-combat.json";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setJsonStatus("Encounter JSON download started.");
    }));
  const jsonFile = requiredElement<HTMLInputElement>(jsonPanel, "[data-scenario-json-file]");
  requiredElement<HTMLButtonElement>(jsonPanel, "[data-scenario-json-load]")
    .addEventListener("click", () => jsonFile.click());
  jsonFile.addEventListener("change", () => runJsonAction(async () => {
    const file = jsonFile.files?.[0];
    if (file === undefined) return;
    try {
      const text = await file.text();
      jsonText.value = text;
      applyEncounterJson(text);
    } finally {
      jsonFile.value = "";
    }
  }));

  const loadSelectedExample = (): void => {
    if (selectedContent === undefined || catalog === undefined) return;
    const option = catalog.examples.find(({ value }) => value === exampleInput.value);
    if (option?.available !== true) throw new Error(option?.unavailableReason ?? "Encounter example unavailable.");
    if (exampleInput.value === "random" &&
        requiredElement<HTMLInputElement>(config, 'input[name="scenario-randomize"]').checked) {
      seedInput.value = String(crypto.getRandomValues(new Uint32Array(1))[0]!);
    }
    editorSourceLabel = exampleInput.selectedOptions[0]?.textContent ?? "Fixed encounter";
    editorUsesGeneratorSeed = exampleInput.value === "random";
    const example = exampleInput.value as ScenarioConfiguration["combatExample"];
    writeFixedConfiguration(fixedCombatScenarioExample(
      selectedContent,
      example,
      example === "random"
        ? parseScenarioSeed(seedInput.value)
        : DEFAULT_SCENARIO_CONFIGURATION.seed,
    ));
    refreshSeedControls();
  };

  function refreshSeedControls(): void {
    const kind = requiredElement<HTMLSelectElement>(config, 'select[name="scenario-kind"]').value as ScenarioKind;
    const randomCombat = kind === "combat" && editorUsesGeneratorSeed;
    requiredElement<HTMLElement>(config, ".content-gate__scenario-seed-controls").hidden =
      kind === "combat" && !randomCombat;
    requiredElement<HTMLElement>(config, "[data-scenario-randomize-label]").textContent =
      randomCombat ? "Generate a new roster when example resets" : "Randomize on each load";
  }

  const updateDetail = (): void => {
    const kind = requiredElement<HTMLSelectElement>(config, 'select[name="scenario-kind"]').value as ScenarioKind;
    requiredElement<HTMLElement>(config, ".content-gate__scenario-egg").hidden = kind !== "egg";
    requiredElement<HTMLElement>(config, ".content-gate__scenario-combat").hidden = kind !== "combat";
    builderLauncher.hidden = kind !== "combat";
    refreshSeedControls();
    if (kind !== "combat") closeBuilder();
    requiredElement<HTMLElement>(config, ".content-gate__scenario-note").textContent = kind === "egg"
      ? "Starts in town with a full party, abundant currency, and the selected egg reel open."
      : kind === "arena"
        ? "Starts in town with a qualified party and opens the Arena license menu."
        : "The selected example is fully materialized and can be edited before the battle starts.";
    refreshBuilderSummary();
  };

  for (const input of config.querySelectorAll("input, select")) input.addEventListener("change", updateDetail);
  exampleInput.addEventListener("change", loadSelectedExample);
  backgroundInput.addEventListener("change", refreshBuilderSummary);
  for (const team of ["player", "enemy"] as const) {
    requiredElement<HTMLButtonElement>(config, `[data-scenario-add="${team}"]`)
      .addEventListener("click", () => addCombatantRow(team));
  }
  for (const enabled of config.querySelectorAll<HTMLInputElement>("[data-scenario-gem-enabled]")) {
    enabled.addEventListener("change", (event) => {
      const row = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-scenario-gem-slot]");
      if (row === null) throw new Error("Scenario Gem control lost its slot owner.");
      requiredElement<HTMLElement>(row, "[data-scenario-gem-fields]").hidden = !enabled.checked;
    });
  }
  requiredElement<HTMLInputElement>(config, '[name="scenario-breeder-enabled"]')
    .addEventListener("change", (event) => {
      requiredElement<HTMLElement>(config, ".content-gate__scenario-breeder-multiplier").hidden =
        !(event.currentTarget as HTMLInputElement).checked;
    });
  requiredElement<HTMLButtonElement>(config, "[data-scenario-example-reset]")
    .addEventListener("click", loadSelectedExample);
  requiredElement<HTMLButtonElement>(config, "[data-scenario-builder-open]").addEventListener("click", openBuilder);
  requiredElement<HTMLButtonElement>(dialog, "[data-scenario-builder-close]").addEventListener("click", closeBuilder);
  requiredElement<HTMLButtonElement>(dialog, "[data-scenario-builder-done]").addEventListener("click", closeBuilder);
  dialog.addEventListener("click", (event) => { if (event.target === dialog) closeBuilder(); });
  dialog.addEventListener("close", () => {
    refreshBuilderSummary();
    requiredElement<HTMLButtonElement>(config, "[data-scenario-builder-open]").focus();
  });
  updateDetail();

  const setContent = (content: ImportedContentPackage | undefined): void => {
    selectedContent = content;
    catalog = content === undefined ? undefined : fixedCombatScenarioCatalog(content);
    const fillList = (selector: string, values: readonly { value: string; label: string }[]): void => {
      requiredElement<HTMLDataListElement>(config, selector).replaceChildren(...values.map(optionNode));
    };
    fillList("#scenario-monster-options", catalog?.monsters ?? []);
    fillList("#scenario-combat-ability-options", catalog?.combatAbilities ?? []);
    fillList("#scenario-all-ability-options", catalog?.allAbilities ?? []);
    rebuildSpiritRows();
    backgroundInput.replaceChildren(...(catalog?.backgrounds ?? []).map((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      return option;
    }));
    for (const option of exampleInput.options) {
      const entry = catalog?.examples.find(({ value }) => value === option.value);
      option.disabled = entry?.available !== true;
      option.title = entry?.unavailableReason ?? "";
    }
    const selectedAvailable = catalog?.examples.find(({ value }) => value === exampleInput.value)?.available;
    if (selectedAvailable !== true) {
      const first = catalog?.examples.find(({ available }) => available);
      if (first !== undefined) exampleInput.value = first.value;
    }
    if (catalog === undefined) {
      teamRows("player").replaceChildren();
      teamRows("enemy").replaceChildren();
    } else {
      loadSelectedExample();
    }
    refreshTeamButtons();
  };

  return {
    config,
    setContent,
    update: (selected) => {
      config.hidden = !selected;
      config.classList.toggle("content-gate__mode-detail--complete", selected);
      if (selected) updateDetail();
      else closeBuilder();
    },
    selectAndFocus: () => {
      const radio = requiredElement<HTMLInputElement>(panel, 'input[name="save-mode"][value="scenario"]');
      radio.checked = true;
      config.hidden = false;
      updateDetail();
      config.querySelector<HTMLElement>("select, input")?.focus();
    },
    acquire: (content) => {
      if (catalog === undefined) setContent(content);
      const configuration = readScenarioConfiguration(config, catalog);
      const store = new ScenarioSaveStore(configuration.transport);
      return { content, saveStore: store, scenario: { configuration, store } };
    },
  };
}

function readScenarioConfiguration(
  config: ParentNode,
  catalog: FixedCombatScenarioCatalog | undefined,
): ScenarioConfiguration {
  const kind = requiredElement<HTMLSelectElement>(config, 'select[name="scenario-kind"]').value as ScenarioKind;
  const transport = requiredElement<HTMLSelectElement>(config, 'select[name="scenario-transport"]').value as ScenarioTransport;
  const combatExample = requiredElement<HTMLSelectElement>(config, 'select[name="scenario-combat-example"]').value as ScenarioConfiguration["combatExample"];
  const fixedCombat = kind === "combat" ? readFixedCombatConfiguration(config, catalog) : undefined;
  return {
    ...DEFAULT_SCENARIO_CONFIGURATION,
    kind,
    transport,
    eggKind: requiredElement<HTMLSelectElement>(config, 'select[name="scenario-egg-kind"]').value as "silver" | "gold",
    combatExample,
    seed: kind === "combat" && combatExample !== "random"
      ? DEFAULT_SCENARIO_CONFIGURATION.seed
      : parseScenarioSeed(requiredElement<HTMLInputElement>(config, 'input[name="scenario-seed"]').value),
    randomize: kind !== "combat" &&
      requiredElement<HTMLInputElement>(config, 'input[name="scenario-randomize"]').checked,
    ...(fixedCombat === undefined ? {} : { fixedCombat }),
  };
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function numberInput(root: ParentNode, selector: string, label: string, minimum = 0): number {
  const value = requiredElement<HTMLInputElement>(root, selector).valueAsNumber;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer of at least ${minimum}.`);
  }
  return value;
}

function readFixedCombatConfiguration(
  config: ParentNode,
  catalog: FixedCombatScenarioCatalog | undefined,
): ScenarioFixedCombatConfiguration {
  if (catalog === undefined) throw new Error("Choose and validate an archive before building combat.");
  const monsterTypes = new Set(catalog.monsters.map(({ value }) => value));
  const combatAbilityPaths = new Set(catalog.combatAbilities.map(({ value }) => value));
  const allAbilityPaths = new Set(catalog.allAbilities.map(({ value }) => value));
  const readTeam = (team: "player" | "enemy"): ScenarioCombatantConfiguration[] => {
    const rows = [...config.querySelectorAll<HTMLElement>(`[data-scenario-rows="${team}"] > *`)];
    if (rows.length < 1 || rows.length > MAX_SCENARIO_TEAM_SIZE) {
      throw new Error(`${team} team must contain 1 to ${MAX_SCENARIO_TEAM_SIZE} combatants.`);
    }
    return rows.map((row, index) => {
      const shortType = requiredElement<HTMLInputElement>(row, '[data-scenario-field="monster"]').value.trim();
      if (!monsterTypes.has(shortType)) throw new Error(`${team} combatant ${index + 1} names an unknown monster: ${shortType}`);
      const level = numberInput(row, '[data-scenario-field="level"]', `${team} combatant ${index + 1} level`, 1);
      const hpInput = requiredElement<HTMLInputElement>(row, '[data-scenario-field="current-hp"]');
      const currentHp = hpInput.value.trim() === "" ? undefined : numberInput(row, '[data-scenario-field="current-hp"]', `${team} combatant ${index + 1} HP`, 1);
      const kitSlots: Array<ScenarioJobAbilityConfiguration | null> = SCENARIO_USABLE_SLOTS.map((slotName, slotIndex) => {
        const abilityPath = requiredElement<HTMLInputElement>(row, `[data-scenario-kit-slot="${slotName}"]`).value.trim();
        if (abilityPath === "") return null;
        if (!combatAbilityPaths.has(abilityPath)) throw new Error(`${team} combatant ${index + 1} slot ${slotIndex + 1} names an unknown combat ability: ${abilityPath}`);
        return {
          abilityPath,
          arguments: parseJsonObject(
            requiredElement<HTMLTextAreaElement>(row, `[data-scenario-kit-arguments="${slotName}"]`).value,
            `${team} combatant ${index + 1} slot ${slotIndex + 1} arguments`,
          ),
        };
      });
      if (kitSlots.every((slot) => slot === null)) throw new Error(`${team} combatant ${index + 1} needs at least one usable ability.`);
      const passiveAbilities = [...row.querySelectorAll<HTMLElement>("[data-scenario-passives] > *")]
        .map((passive, passiveIndex): ScenarioPassiveAbilityConfiguration => {
          const slot = requiredElement<HTMLInputElement>(passive, '[data-scenario-passive-field="slot"]').value.trim();
          const abilityPath = requiredElement<HTMLInputElement>(passive, '[data-scenario-passive-field="ability"]').value.trim();
          if (!allAbilityPaths.has(abilityPath)) throw new Error(`${team} combatant ${index + 1} passive ${passiveIndex + 1} names an unknown ability: ${abilityPath}`);
          return {
            slot,
            abilityPath,
            arguments: parseJsonObject(
              requiredElement<HTMLTextAreaElement>(passive, '[data-scenario-passive-field="arguments"]').value,
              `${team} combatant ${index + 1} passive ${passiveIndex + 1} arguments`,
            ),
          };
        });
      const soulEnabled = requiredElement<HTMLInputElement>(row, '[data-scenario-field="soul-enabled"]').checked;
      const soulSource = requiredElement<HTMLInputElement>(row, '[data-scenario-field="soul-source"]').value.trim();
      if (soulEnabled && !monsterTypes.has(soulSource)) throw new Error(`${team} combatant ${index + 1} Soul Stone names an unknown sacrificed monster: ${soulSource}`);
      const flatStatBonuses: Partial<Record<StatName, number>> = {};
      for (const stat of STAT_NAMES) {
        const input = requiredElement<HTMLInputElement>(row, `[data-scenario-flat-stat="${stat}"]`);
        if (input.value.trim() === "") continue;
        if (!Number.isFinite(input.valueAsNumber)) throw new Error(`${team} combatant ${index + 1} ${stat} bonus must be finite.`);
        flatStatBonuses[stat] = input.valueAsNumber;
      }
      return {
        shortType,
        level,
        boss: requiredElement<HTMLInputElement>(row, '[data-scenario-field="boss"]').checked,
        capturable: requiredElement<HTMLInputElement>(row, '[data-scenario-field="capturable"]').checked,
        ...(currentHp === undefined ? {} : { currentHp }),
        kitSlots,
        passiveAbilities,
        ...(soulEnabled
          ? { soulStone: { sourceType: soulSource, level: numberInput(row, '[data-scenario-field="soul-level"]', `${team} combatant ${index + 1} Soul Stone level`, 1) } }
          : {}),
        ...(Object.keys(flatStatBonuses).length === 0 ? {} : { flatStatBonuses }),
      };
    });
  };
  const backgroundKey = requiredElement<HTMLSelectElement>(config, 'select[name="scenario-combat-background"]').value;
  if (!catalog.backgrounds.includes(backgroundKey)) throw new Error(`Fixed combat names an unknown background: ${backgroundKey}`);
  const breederEnabled = requiredElement<HTMLInputElement>(config, '[name="scenario-breeder-enabled"]').checked;
  const skillPoints: Partial<Record<StatName, number>> = {};
  for (const stat of STAT_NAMES) {
    const points = numberInput(config, `[data-scenario-hero-skills] [data-scenario-stat="${stat}"]`, `${stat} hero skill points`);
    if (points > 0) skillPoints[stat] = points;
  }
  const equippedGems: Array<ScenarioGemConfiguration | null> = [0, 1, 2, 3].map((slot) => {
    const row = requiredElement<HTMLElement>(config, `[data-scenario-gem-slot="${slot}"]`);
    if (!requiredElement<HTMLInputElement>(row, "[data-scenario-gem-enabled]").checked) return null;
    return {
      level: numberInput(row, "[data-scenario-gem-level]", `Gem slot ${slot + 1} level`, 1),
      quality: numberInput(row, "[data-scenario-gem-quality]", `Gem slot ${slot + 1} quality`),
      enabledStats: STAT_NAMES.filter((stat) =>
        requiredElement<HTMLInputElement>(row, `[data-scenario-gem-stat="${stat}"]`).checked),
    };
  });
  const spiritTierLevels = Object.fromEntries(
    [...config.querySelectorAll<HTMLElement>("[data-scenario-spirit]")].flatMap((row) => {
      if (!requiredElement<HTMLInputElement>(row, "[data-scenario-spirit-enabled]").checked) return [];
      const shortType = row.dataset["scenarioSpirit"]!;
      return [[shortType, numberInput(row, "[data-scenario-spirit-tier]", `${shortType} Spirit grade`)]];
    }),
  );
  const spiritPercent = numberInput(config, '[name="scenario-spirit-percent"]', "Spirit charge percent");
  if (spiritPercent > 100) throw new Error("Spirit charge percent must not exceed 100.");
  return {
    backgroundKey,
    allowRetreat: requiredElement<HTMLInputElement>(config, '[name="scenario-allow-retreat"]').checked,
    blockCapture: requiredElement<HTMLInputElement>(config, '[name="scenario-block-capture"]').checked,
    ...(breederEnabled
      ? { breederXpBonus: requiredElement<HTMLInputElement>(config, '[name="scenario-breeder-xp"]').valueAsNumber }
      : {}),
    resources: {
      heroLevel: numberInput(config, '[name="scenario-hero-level"]', "Hero level", 1),
      silver: numberInput(config, '[name="scenario-silver"]', "Silver"),
      gold: numberInput(config, '[name="scenario-gold"]', "Gold"),
      captureCards: {
        1: numberInput(config, '[name="scenario-card-1"]', "Card I count"),
        2: numberInput(config, '[name="scenario-card-2"]', "Card II count"),
        3: numberInput(config, '[name="scenario-card-3"]', "Card III count"),
      },
      spiritReadiness: spiritPercent / 100,
      equippedGems,
      spiritTierLevels,
      skillPoints,
    },
    playerTeam: readTeam("player"),
    enemyTeam: readTeam("enemy"),
  };
}

function optionNode(entry: { readonly value: string; readonly label: string }): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = entry.value;
  option.label = `${entry.label} - ${entry.value}`;
  return option;
}

function installStyles(): void {
  const style = document.createElement("style");
  style.textContent = `
    .content-gate__scenario-config { grid-template-columns:repeat(2,minmax(0,1fr));gap:12px }
    .content-gate__scenario-config[hidden],.content-gate__scenario-config [hidden] { display:none }
    .content-gate__scenario-config>.content-gate__mode-detail-heading,.content-gate__scenario-config>p,.content-gate__scenario-custom-launcher { grid-column:1/-1 }
    .content-gate__scenario-config>p { margin:0;color:var(--gate-muted);font-size:12.5px }
    .content-gate__scenario-config>label,.content-gate__scenario-builder label { display:grid;gap:5px;color:var(--gate-muted);font-size:12px;font-weight:700 }
    .content-gate__scenario-config select,.content-gate__scenario-config input[type=text],.content-gate__scenario-config input[type=number],.content-gate__scenario-config textarea { width:100%;min-width:0;min-height:38px;box-sizing:border-box;padding:7px 9px;border:1px solid var(--gate-border);border-radius:8px;background:var(--gate-surface-deep);color:var(--gate-text);font:inherit }
    .content-gate__scenario-config textarea { min-height:92px;resize:vertical;font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace }
    .content-gate__card .content-gate__scenario-icon-button { flex:0 0 38px;width:38px;height:38px;min-width:38px;min-height:38px;box-sizing:border-box;padding:0;display:inline-flex;align-items:center;justify-content:center;line-height:0;border:1px solid var(--gate-border);border-radius:9px;background:var(--gate-surface-deep);color:var(--gate-text) }.content-gate__card .content-gate__scenario-icon-button:hover { border-color:var(--gate-orchid);color:var(--gate-accent-text) }.content-gate__card .content-gate__scenario-icon-button:disabled { opacity:.35 }.content-gate__card .content-gate__scenario-icon-button svg { display:block;flex:none;width:20px;height:20px;margin:0;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round }.content-gate__card .content-gate__scenario-icon-button--primary { background:var(--gate-orchid);color:#fff }.content-gate__card .content-gate__scenario-icon-button--danger { color:var(--gate-danger-text,#ff9b9b) }
    .content-gate__scenario-seed-controls { display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;grid-column:1/-1 }.content-gate__scenario-seed-controls>.content-gate__scenario-randomize { display:flex }
    .content-gate__scenario-config .content-gate__scenario-randomize { display:flex;align-items:center;gap:8px;align-self:end;min-height:38px }
    .content-gate__scenario-custom-launcher { display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 14px;border:1px solid var(--gate-border);border-radius:10px;background:var(--gate-surface-deep) }
    .content-gate__scenario-custom-launcher>span { min-width:0 }.content-gate__scenario-custom-launcher strong,.content-gate__scenario-custom-launcher small { display:block }.content-gate__scenario-custom-launcher small { margin-top:2px;color:var(--gate-muted);font-size:12px;overflow-wrap:anywhere }
    .content-gate__scenario-launcher-actions,.content-gate__scenario-dialog-actions,.content-gate__scenario-combatant-actions { display:flex;gap:8px }
    .content-gate__scenario-dialog { width:min(1280px,calc(100vw - 24px));max-width:none;height:min(860px,calc(100vh - 24px));max-height:none;box-sizing:border-box;padding:0;overflow:hidden;border:2px solid var(--gate-orchid);border-radius:20px;background:var(--gate-surface-raised);color:var(--gate-text);box-shadow:0 18px 0 var(--gate-shadow);font:15px/1.4 system-ui,sans-serif }
    .content-gate__scenario-dialog::backdrop { background:var(--gate-backdrop) }.content-gate__scenario-dialog-card { height:100%;min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto }
    .content-gate__scenario-dialog-header { display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center;padding:18px 22px;border-bottom:1px solid var(--gate-border-soft);background:var(--gate-surface-raised) }
    .content-gate__scenario-dialog-header strong,.content-gate__scenario-dialog-header small { display:block }.content-gate__scenario-dialog-header strong { font-size:24px;line-height:1.15 }.content-gate__scenario-dialog-header small { margin-top:3px;color:var(--gate-muted);font-size:12.5px }.content-gate__scenario-dialog-eyebrow { display:block;margin-bottom:2px;color:var(--gate-accent-text);font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase }
    .content-gate__card .content-gate__scenario-dialog-close { width:38px;min-height:38px;padding:0;border:1px solid var(--gate-border);border-radius:999px;background:var(--gate-surface-deep);color:var(--gate-text);font-size:24px;line-height:1 }
    .content-gate__scenario-builder { min-height:0;display:grid;align-content:start;gap:16px;padding:18px 22px;overflow:auto;background:var(--gate-surface) }.content-gate__scenario-builder-heading strong,.content-gate__scenario-builder-heading small { display:block }.content-gate__scenario-builder-heading small { color:var(--gate-muted);font-size:12.5px }
    .content-gate__scenario-json { display:grid;gap:10px;padding:12px;border:1px solid var(--gate-orchid);border-radius:12px;background:var(--gate-surface-raised) }.content-gate__scenario-json>header { display:flex;justify-content:space-between;align-items:center;gap:12px }.content-gate__scenario-json>header strong,.content-gate__scenario-json>header small { display:block }.content-gate__scenario-json>header small,.content-gate__scenario-json>[data-scenario-json-status] { color:var(--gate-muted);font-size:11.5px }.content-gate__scenario-json>[data-scenario-json-status][data-error="true"] { color:var(--gate-danger-text,#ff9b9b) }.content-gate__scenario-json-actions { display:flex;flex-wrap:wrap;justify-content:flex-end;gap:7px }.content-gate__scenario-json>textarea { min-height:260px }
    .content-gate__scenario-options { display:grid;grid-template-columns:minmax(240px,1fr) minmax(0,1.5fr) minmax(170px,.7fr);gap:16px;align-items:end;padding:14px;border:1px solid var(--gate-border-soft);border-radius:12px;background:var(--gate-surface-raised) }
    .content-gate__scenario-flags { display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;min-height:38px;color:var(--gate-muted);font-size:12.5px }.content-gate__scenario-flags label,.content-gate__scenario-member-flags label,.content-gate__scenario-soul>label { display:flex;gap:7px;align-items:center }
    .content-gate__scenario-resources,.content-gate__scenario-member-advanced { border:1px solid var(--gate-border);border-radius:10px;background:var(--gate-surface-raised) }.content-gate__scenario-resources>summary,.content-gate__scenario-member-advanced>summary { padding:11px 13px;color:var(--gate-text);font-weight:800;cursor:pointer }.content-gate__scenario-resources>p { margin:0;padding:0 13px 12px;color:var(--gate-muted);font-size:12px }.content-gate__scenario-resource-grid { display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:0 13px 13px }
    .content-gate__scenario-stat-fieldset { min-width:0;margin:0 13px 13px;padding:10px;border:1px solid var(--gate-border-soft);border-radius:9px }.content-gate__scenario-stat-grid { display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px }
    .content-gate__scenario-gems>p,.content-gate__scenario-spirits>p { margin:0 0 10px;color:var(--gate-muted);font-size:11.5px }.content-gate__scenario-gems>section { display:grid;gap:7px;padding:9px;border-top:1px solid var(--gate-border-soft) }.content-gate__scenario-gems>section:first-of-type { border-top:0 }.content-gate__scenario-gems>section>header label,.content-gate__scenario-gems [data-scenario-gem-fields]>span label { display:flex;align-items:center;gap:6px }.content-gate__scenario-gems [data-scenario-gem-fields] { display:grid;grid-template-columns:90px 90px minmax(0,1fr);gap:8px;align-items:end }.content-gate__scenario-gems [data-scenario-gem-fields]>span { display:flex;flex-wrap:wrap;gap:6px 10px;padding-bottom:8px;color:var(--gate-muted);font-size:11px }
    .content-gate__scenario-spirits [data-scenario-spirit-rows] { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px }.content-gate__scenario-spirits [data-scenario-spirit] { display:grid;grid-template-columns:minmax(0,1fr) 90px;gap:8px;align-items:end;padding:8px;border:1px solid var(--gate-border-soft);border-radius:8px }.content-gate__scenario-spirits [data-scenario-spirit]>label:first-child { display:flex;align-items:center;gap:6px;min-width:0;overflow-wrap:anywhere }
    .content-gate__scenario-teams { min-width:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start }.content-gate__scenario-team { min-width:0;display:grid;gap:10px;padding:12px;border:1px solid var(--gate-border);border-radius:12px;background:var(--gate-surface-raised) }.content-gate__scenario-team>header,.content-gate__scenario-combatant>header,.content-gate__scenario-passives-section>header { display:flex;justify-content:space-between;align-items:center;gap:10px }.content-gate__scenario-team [data-scenario-rows] { display:grid;gap:10px }
    .content-gate__scenario-combatant { min-width:0;display:grid;gap:10px;padding:11px;border:1px solid var(--gate-border-soft);border-radius:10px;background:var(--gate-surface-deep) }.content-gate__scenario-combatant>header>button { min-height:34px;padding:0 10px;background:transparent;color:var(--gate-accent-text);border:1px solid var(--gate-border) }.content-gate__scenario-member-primary { display:grid;grid-template-columns:minmax(0,1fr) 72px 92px;gap:8px }.content-gate__scenario-member-flags { display:flex;flex-wrap:wrap;gap:14px;color:var(--gate-muted);font-size:12px }
    .content-gate__scenario-kit { min-width:0;margin:0;padding:10px;border:1px solid var(--gate-border);border-radius:9px }.content-gate__scenario-kit-grid { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px }.content-gate__scenario-kit-slot { min-width:0;padding:8px;border:1px solid var(--gate-border-soft);border-radius:8px;background:var(--gate-surface-raised) }.content-gate__scenario-kit-slot details { margin-top:6px }.content-gate__scenario-kit-slot summary,.content-gate__scenario-passive summary { color:var(--gate-muted);font-size:11px;cursor:pointer }
    .content-gate__scenario-member-advanced[open] { padding-bottom:12px }.content-gate__scenario-soul,.content-gate__scenario-passives-section { margin:0 12px 12px;padding:10px;border:1px solid var(--gate-border-soft);border-radius:9px }.content-gate__scenario-soul>div { display:grid;grid-template-columns:minmax(0,1fr) 100px;gap:8px;margin-top:9px }.content-gate__scenario-passives-section small { display:block;color:var(--gate-muted);font-size:11px }.content-gate__scenario-passives-section [data-scenario-passives] { display:grid;gap:8px;margin-top:9px }.content-gate__scenario-passive { display:grid;grid-template-columns:minmax(100px,.6fr) minmax(0,1.4fr) auto;gap:8px;align-items:end;padding:8px;border-radius:8px;background:var(--gate-surface) }.content-gate__scenario-passive details { grid-column:1/3 }.content-gate__scenario-passive>button { grid-column:3;grid-row:1/3;align-self:end;min-height:36px;padding:0 10px }
    .content-gate__scenario-dialog-footer { display:flex;gap:16px;align-items:center;justify-content:flex-end;padding:14px 22px;border-top:1px solid var(--gate-border-soft);background:var(--gate-surface-raised) }.content-gate__scenario-dialog-footer>span { margin-right:auto;color:var(--gate-muted);font-size:12.5px;overflow-wrap:anywhere }.content-gate__scenario-note { color:var(--gate-success-text)!important }
    .content-gate__scenario-confirm { width:min(420px,calc(100vw - 28px));padding:0;border:2px solid var(--gate-orchid);border-radius:14px;background:var(--gate-surface-raised);color:var(--gate-text);box-shadow:0 14px 0 var(--gate-shadow) }.content-gate__scenario-confirm::backdrop { background:var(--gate-backdrop) }.content-gate__scenario-confirm>form { display:grid;gap:10px;padding:18px }.content-gate__scenario-confirm p { margin:0;color:var(--gate-muted) }.content-gate__scenario-confirm footer { display:flex;justify-content:flex-end;gap:8px }
    @media(max-width:980px) { .content-gate__scenario-teams { grid-template-columns:1fr }.content-gate__scenario-options { grid-template-columns:1fr 1fr }.content-gate__scenario-breeder-multiplier { grid-column:1/-1 }.content-gate__scenario-resource-grid,.content-gate__scenario-spirits [data-scenario-spirit-rows] { grid-template-columns:repeat(2,minmax(0,1fr)) }.content-gate__scenario-gems [data-scenario-gem-fields] { grid-template-columns:repeat(2,minmax(0,1fr)) }.content-gate__scenario-gems [data-scenario-gem-fields]>span { grid-column:1/-1 }.content-gate__scenario-dialog { width:min(760px,calc(100vw - 20px));height:calc(100vh - 20px) } }
    @media(max-width:620px) { .content-gate__scenario-config { grid-template-columns:1fr }.content-gate__scenario-custom-launcher,.content-gate__scenario-options,.content-gate__scenario-seed-controls { grid-template-columns:1fr }.content-gate__scenario-json>header { align-items:flex-start;flex-direction:column }.content-gate__scenario-json-actions { justify-content:flex-start }.content-gate__scenario-dialog { width:calc(100vw - 10px);height:calc(100vh - 10px);border-radius:14px }.content-gate__scenario-dialog-header,.content-gate__scenario-builder,.content-gate__scenario-dialog-footer { padding-left:12px;padding-right:12px }.content-gate__scenario-dialog-header strong { font-size:20px }.content-gate__scenario-dialog-footer { align-items:center }.content-gate__scenario-member-primary { grid-template-columns:minmax(0,1fr) 72px }.content-gate__scenario-member-primary>label:last-child { grid-column:1/-1 }.content-gate__scenario-kit-grid,.content-gate__scenario-resource-grid,.content-gate__scenario-spirits [data-scenario-spirit-rows] { grid-template-columns:1fr }.content-gate__scenario-stat-grid { grid-template-columns:repeat(2,minmax(0,1fr)) }.content-gate__scenario-passive { grid-template-columns:1fr }.content-gate__scenario-passive details,.content-gate__scenario-passive>button { grid-column:1;grid-row:auto } }`;
  document.head.appendChild(style);
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Scenario gate is missing ${selector}`);
  return element;
}
