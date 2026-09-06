import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2).filter((value) => value !== "--");
const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
const output = path.resolve(invocationDirectory, args[0] ?? "output/fidelity-lab/native-observer.txt");
const durationMinutes = Number(args[1] ?? 60);
const intervalMs = Number(args[2] ?? 250);
if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) throw new Error("duration minutes must be positive");
if (!Number.isSafeInteger(intervalMs) || intervalMs < 50) throw new Error("interval must be an integer >= 50ms");
fs.mkdirSync(path.dirname(output), { recursive: true });
const durationMs = durationMinutes * 60_000;
const lines = [
  "# Generated Fidelity Lab observer. It injects no input; DUMP only snapshots the cocos scene.",
];
for (let at = 0; at <= durationMs; at += intervalMs) lines.push(`DUMP ${at}`);
fs.writeFileSync(output, `${lines.join("\n")}\n`);
console.log(output);
