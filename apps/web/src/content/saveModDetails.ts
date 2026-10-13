import type { PlayProfileModRef } from "./playProfiles.js";
import { compareSaveMods } from "./saveModComparison.js";

/** Native disclosure supplies Enter/Space behavior and exposes its expanded state to AT. */
export function saveModDetails(
  previous: readonly PlayProfileModRef[] | null,
  selected: readonly PlayProfileModRef[],
  contentChanged: boolean,
): HTMLDetailsElement {
  const comparison = compareSaveMods(previous, selected, contentChanged);
  const root = document.createElement("details");
  root.className = "save-mods";
  root.dataset["kind"] = comparison.kind;
  const summary = document.createElement("summary");
  const icon = document.createElement("span");
  icon.className = "save-mods__icon";
  icon.setAttribute("aria-hidden", "true");
  const changed = comparison.kind === "mods" || comparison.kind === "content";
  icon.innerHTML = changed
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3v1"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></svg>';
  const label = document.createElement("span");
  label.className = "save-mods__label";
  label.textContent = comparison.label;
  const hint = document.createElement("span");
  hint.className = "save-mods__hint";
  hint.textContent = "View setup";
  summary.append(icon, label, hint);
  root.addEventListener("toggle", () => { hint.textContent = root.open ? "Hide setup" : "View setup"; });
  const body = document.createElement("div");
  body.className = "save-mods__body";
  const description = document.createElement("p");
  description.textContent = comparison.description;
  body.appendChild(description);
  if (comparison.kind !== "same") {
    const advice = document.createElement("p");
    advice.className = "save-mods__advice";
    advice.textContent = "You can still play. Export a backup before trying a different setup.";
    body.appendChild(advice);
  }
  const lists = document.createElement("div");
  lists.className = "save-mods__lists";
  lists.tabIndex = 0;
  lists.setAttribute("role", "region");
  lists.setAttribute("aria-label", "Mod lists in load order");
  lists.append(
    modList("Last played", previous, selected, "Removed"),
    modList("Selected now", selected, previous, "Added"),
  );
  body.appendChild(lists);
  root.append(summary, body);
  return root;
}

function modList(
  title: string,
  mods: readonly PlayProfileModRef[] | null,
  other: readonly PlayProfileModRef[] | null,
  missingLabel: string,
): HTMLElement {
  const section = document.createElement("section");
  const heading = document.createElement("h4");
  heading.textContent = `${title}${mods === null ? "" : ` (${mods.length})`}`;
  section.appendChild(heading);
  if (mods === null || mods.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = mods === null ? "Not recorded" : "No mods";
    section.appendChild(empty);
    return section;
  }
  const otherById = new Map((other ?? []).map(mod => [mod.id, mod]));
  const list = document.createElement("ol");
  list.setAttribute("aria-label", `${title} mods, in load order`);
  for (const mod of mods) {
    const row = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = mod.displayName;
    const version = document.createElement("small");
    version.textContent = mod.version;
    const metadata = document.createElement("span");
    metadata.className = "save-mods__metadata";
    metadata.appendChild(version);
    row.append(name, metadata);
    const match = otherById.get(mod.id);
    const change = other === null ? undefined
      : match === undefined ? missingLabel : match.digest !== mod.digest ? "Updated" : undefined;
    if (change !== undefined) {
      const tag = document.createElement("em");
      tag.textContent = change;
      metadata.appendChild(tag);
    }
    list.appendChild(row);
  }
  section.appendChild(list);
  return section;
}
