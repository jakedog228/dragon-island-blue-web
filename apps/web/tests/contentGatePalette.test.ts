import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const index = readFileSync(resolve(import.meta.dirname, "..", "index.html"), "utf8");
const contentGateSource = readFileSync(
  resolve(import.meta.dirname, "..", "src", "content", "contentGate.ts"),
  "utf8",
);
const gateStart = index.indexOf(".content-gate {");
const gateEnd = index.indexOf(".save-health {");
const contentGateCss = index.slice(gateStart, gateEnd);

describe("content-gate palette", () => {
  it("uses the flat Hearth palette in both light and dark modes", () => {
    expect(gateStart).toBeGreaterThanOrEqual(0);
    expect(gateEnd).toBeGreaterThan(gateStart);
    expect(contentGateCss).toContain("--gate-orchid:#c8795e");
    expect(contentGateCss).toContain("--gate-peach:#d2a04f");
    expect(contentGateCss).toContain("--gate-leaf:#709675");
    expect(contentGateCss).toContain("--gate-orchid-fill:#c8795ee6");
    expect(contentGateCss).toContain("--gate-peach-fill:#d2a04fe6");
    expect(contentGateCss).toContain("--gate-leaf-fill:#709675e6");
    expect(contentGateCss).toContain("--gate-backdrop:#0a0d15c4");
    expect(contentGateCss).toContain("--gate-backdrop:#e2e5ebd0");
    expect(contentGateCss).toContain("--gate-privacy-surface:#101827");
    expect(contentGateCss).toContain("--gate-privacy-surface:#eef3ed");
    expect(contentGateCss).toContain("--gate-privacy-border:#3d4b63");
    expect(contentGateCss).toContain("--gate-privacy-border:#cad8ca");
    expect(contentGateCss).not.toContain("data-gate-palette");
    expect(contentGateCss).toContain('[data-gate-mode="dark"]');
    expect(contentGateCss).toContain('[data-gate-mode="light"]');
    expect(contentGateCss).not.toMatch(/(?:linear|radial|conic)-gradient\(/i);
    expect(contentGateCss).toContain("background: var(--gate-leaf-fill); color: var(--gate-ink)");
    expect(contentGateCss).toContain("background: var(--gate-peach-fill)");
    expect(contentGateCss).toContain("background: var(--gate-orchid-fill); color: var(--gate-ink)");
    expect(contentGateCss).toContain("background: var(--gate-privacy-surface); color: var(--gate-muted)");
    expect(contentGateCss).toContain("box-shadow: inset 0 0 0 1px var(--gate-privacy-border)");
    expect(contentGateCss).toContain(".content-gate__privacy-content strong");
  });

  it("marks the Online mode as beta", () => {
    expect(contentGateSource).toContain('value="official"> Online (Beta)</label>');
  });

  it("uses a classic floppy disk for the storage dialog mark", () => {
    expect(contentGateSource).toContain(
      '<span class="content-gate__storage-dialog-mark">${saveIcon()}</span>',
    );
    expect(contentGateSource).toContain("function saveIcon(): string");
    expect(contentGateSource).toContain('M7 3v6h10V3M7 21v-8h10v8M14 5v2');
  });
});
