import fs from "node:fs";

const pathParts = (path) => path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);

export function valueAtPath(root, path) {
  return pathParts(path).reduce((value, part) => value?.[part], root);
}

export function loadStateRules(file) {
  if (file === undefined) return Object.freeze([]);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.rules)) {
    throw new Error("Fidelity Lab rules file must contain a rules array");
  }
  return Object.freeze(parsed.rules.map((rule, index) => {
    if (typeof rule?.id !== "string" || !rule.id) throw new Error(`rules[${index}].id is required`);
    if (typeof rule.nativeText !== "string" || typeof rule.portPath !== "string") {
      throw new Error(`rules[${index}] requires nativeText and portPath strings`);
    }
    const regexp = new RegExp(rule.nativeText);
    return Object.freeze({
      id: rule.id,
      label: typeof rule.label === "string" ? rule.label : rule.id,
      regexp,
      portPath: rule.portPath,
      occurrence: Number.isSafeInteger(rule.occurrence) && rule.occurrence >= 0 ? rule.occurrence : 0,
      absoluteTolerance: Number.isFinite(rule.absoluteTolerance) && rule.absoluteTolerance >= 0
        ? rule.absoluteTolerance
        : 0,
      relativeTolerance: Number.isFinite(rule.relativeTolerance) && rule.relativeTolerance >= 0
        ? rule.relativeTolerance
        : 0,
    });
  }));
}

export function evaluateStateRules(rules, nativeScene, portState) {
  if (nativeScene === undefined || portState === undefined) return Object.freeze([]);
  const text = nativeScene.nodes.filter((node) => node.visible && typeof node.text === "string")
    .map((node) => node.text);
  return Object.freeze(rules.map((rule) => {
    const matches = text.flatMap((line) => {
      const match = rule.regexp.exec(line);
      return match === null ? [] : [match];
    });
    const match = matches[rule.occurrence];
    if (match === undefined) return Object.freeze({ id: rule.id, label: rule.label, status: "pending", reason: "native text not found" });
    const nativeValue = Number(match.groups?.value ?? match[1]);
    const portValue = Number(valueAtPath(portState, rule.portPath));
    if (!Number.isFinite(nativeValue) || !Number.isFinite(portValue)) {
      return Object.freeze({ id: rule.id, label: rule.label, status: "pending", reason: "numeric value unavailable" });
    }
    const delta = Math.abs(portValue - nativeValue);
    const margin = Math.max(rule.absoluteTolerance, Math.abs(nativeValue) * rule.relativeTolerance);
    return Object.freeze({
      id: rule.id,
      label: rule.label,
      status: delta <= margin ? "match" : "different",
      nativeValue,
      portValue,
      delta,
      margin,
      portPath: rule.portPath,
    });
  }));
}
