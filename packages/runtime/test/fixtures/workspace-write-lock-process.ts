import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { createInterface } from "node:readline";
import { acquireWorkspacePathLocks } from "../../src/workspace-write-lock.js";

const root = process.argv[2];
if (!root) throw new Error("Lock fixture root is required");
if (process.argv[3] === "race-fifo") {
  const original = fs.lstatSync;
  let replaced = false;
  Reflect.set(fs, "lstatSync", ((filename: Parameters<typeof fs.lstatSync>[0]) => {
    const value = original(filename);
    if (!replaced && typeof filename === "string" && filename.endsWith(".lock")) {
      replaced = true; fs.unlinkSync(filename); execFileSync("mkfifo", [filename]);
    }
    return value;
  }) as typeof fs.lstatSync);
  syncBuiltinESMExports();
  try { await acquireWorkspacePathLocks(root, [path.join(root, "target")], "Fixture"); throw new Error("FIFO owner must remain unknown"); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes("already being edited")) throw error;
    process.stdout.write("fifo-busy\n");
  }
  process.exit(0);
}
const input = createInterface({ input: process.stdin });
process.stdout.write("ready\n");
let lease: Awaited<ReturnType<typeof acquireWorkspacePathLocks>> | undefined;
try {
  for await (const line of input) {
    if (line === "acquire") {
      try {
        lease = await acquireWorkspacePathLocks(root, [path.join(root, "target")], "Fixture");
        process.stdout.write("acquired\n");
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("already being edited")) throw error;
        process.stdout.write("busy\n");
      }
    }
    if (line === "release") { await lease?.release(); lease = undefined; process.stdout.write("released\n"); }
    if (line === "stop") break;
  }
} finally { await lease?.release(); input.close(); }
