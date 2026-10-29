import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import type { RunEvent } from "@napier/contracts";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { sha256 } from "./ed25519.js";
import type { SubagentWorkingSetCapsule } from "./subagent-working-set-capsule.js";

/** Exact retained read_file dependencies only; this is not a whole-workspace version claim. */
export async function assertSubagentRestoreWorkspace(workspaceRoot: string, capsule: SubagentWorkingSetCapsule,
  events: readonly RunEvent[]): Promise<void> {
  const root = await realpath(workspaceRoot);
  for (const message of capsule.messages) {
    if (message.role !== "toolResult") continue;
    if (message.isError && !events.some((event) => event.type === "tool.started" &&
        record(event.payload)["providerCallId"] === message.toolCallId)) continue;
    const dependency = readDependency(message);
    await assertFileBytes(await dependencyPath(root, dependency.path), dependency);
  }
}
function readDependency(message: ToolResultMessage): { path: string; sha256: string; sizeBytes: number } {
  const details = record(message.details);
  if (message.isError || message.toolName !== "read_file" || typeof details["path"] !== "string" ||
      typeof details["sha256"] !== "string" || !/^[a-f0-9]{64}$/u.test(details["sha256"]) ||
      details["pathSha256"] !== sha256(details["path"]) || !Number.isSafeInteger(details["sizeBytes"]) ||
      Number(details["sizeBytes"]) < 0 || Number(details["sizeBytes"]) > 2 * 1024 * 1024)
    throw new Error("Child continuation workspace dependency is unverifiable");
  return { path: details["path"], sha256: details["sha256"], sizeBytes: Number(details["sizeBytes"]) };
}
async function dependencyPath(root: string, relative: string): Promise<string> {
  if (path.isAbsolute(relative) || path.normalize(relative) !== relative || relative === "." ||
      relative === ".." || relative.startsWith(`..${path.sep}`) || relative.includes("\0"))
    throw new Error("Child continuation workspace dependency escapes its root");
  let current = root;
  const parts = relative.split(path.sep);
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile()))
      throw new Error("Child continuation workspace dependency changed identity");
  }
  return current;
}
async function assertFileBytes(target: string, dependency: { sha256: string; sizeBytes: number }): Promise<void> {
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== dependency.sizeBytes || before.size > 2 * 1024 * 1024)
      throw new Error("Child continuation workspace dependency changed");
    const bytes = Buffer.alloc(before.size + 1);
    const result = await handle.read(bytes, 0, bytes.length, 0), after = await handle.stat();
    if (result.bytesRead !== before.size || before.dev !== after.dev || before.ino !== after.ino ||
        before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs ||
        sha256(bytes.subarray(0, result.bytesRead)) !== dependency.sha256)
      throw new Error("Child continuation workspace dependency changed");
  } finally { await handle.close(); }
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
