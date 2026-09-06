import fs from "node:fs";
import path from "node:path";
import { loadFidelityTask } from "../src/task.mjs";

const args = process.argv.slice(2).filter((value) => value !== "--");
const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
const taskFile = args[0];
const output = args[1];
const durationMs = Number(args[2] ?? 180_000);
const dumpEveryMs = Number(args[3] ?? 250);
if (!taskFile || !output) {
  throw new Error("Usage: make-native-task-script.mjs <task.json> <output.txt> [durationMs] [dumpEveryMs]");
}
if (!Number.isSafeInteger(durationMs) || durationMs < 1_000) throw new Error("durationMs must be >= 1000");
if (!Number.isSafeInteger(dumpEveryMs) || dumpEveryMs < 50) throw new Error("dumpEveryMs must be >= 50");
const task = loadFidelityTask(path.resolve(invocationDirectory, taskFile));
const lines = [`# Generated from Fidelity Lab task ${task.id}.`];
for (const step of task.steps) {
  if (step.kind === "drag") throw new Error(`Task ${task.id} uses drag ${step.id}; TouchHLE's static harness supports TAP only`);
  if (step.kind !== "tap") continue;
  if (!Number.isSafeInteger(step.nativeAtMs)) throw new Error(`Task tap ${step.id} requires integer nativeAtMs`);
  lines.push(`TAP ${step.nativeAtMs} ${Math.round(step.x * 960)} ${Math.round(step.y * 640)}`);
}
for (let at = 0; at <= durationMs; at += dumpEveryMs) lines.push(`DUMP ${at}`);
const outputFile = path.resolve(invocationDirectory, output);
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${lines.join("\n")}\n`);
console.log(outputFile);
