import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import type { ThreadDetail } from "@napier/contracts";
import { sha256 } from "./ed25519.js";
import { isPathInsideWorkspace } from "./policy.js";

type Narrative = NonNullable<ThreadDetail["taskNarrative"]>;
type Deliverable = NonNullable<Narrative["deliverables"]>[number];
const MAX_CANDIDATE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

/** Only explicit response references are inspected. Never scan the workspace.
 * This observes current bytes; it does not certify that the Run created them. */
export async function inspectTaskDeliverables(
  narrative: Narrative,
  workspaceRoot: string | undefined,
): Promise<Narrative> {
  if (!workspaceRoot) return narrative;
  const root = await realpath(workspaceRoot).catch(() => undefined);
  if (!root)
    return {
      ...narrative,
      deliverables:
        narrative.deliverables?.filter((entry) => entry.source === "plan") ??
        [],
    };
  const declared = (narrative.deliverables ?? []).filter(
    (entry) => entry.source === "plan",
  );
  const known = new Set(
    declared.map((entry) => path.resolve(workspaceRoot, entry.path)),
  );
  const candidates: Deliverable[] = [];
  let remainingBytes = MAX_TOTAL_BYTES;
  for (const entry of narrative.deliverables ?? []) {
    if (
      entry.source !== "final_reference" ||
      !entry.sourceEventId ||
      !entry.artifact.sourceRunId
    )
      continue;
    const target = candidatePath(entry.path, workspaceRoot);
    if (!target || known.has(target)) continue;
    const observed = await inspectCandidate(root, target, remainingBytes);
    if (!observed) continue;
    remainingBytes -= observed.sizeBytes;
    known.add(target);
    const relative = path.relative(root, observed.resolved);
    candidates.push({
      ...entry,
      path: relative,
      accessibility: "available",
      artifact: {
        ...entry.artifact,
        path: relative,
        sha256: observed.sha256,
        sizeBytes: observed.sizeBytes,
      },
    });
  }
  return { ...narrative, deliverables: [...declared, ...candidates] };
}

function candidatePath(value: string, root: string): string | undefined {
  if (
    !value ||
    /[\x00-\x1f]/u.test(value) ||
    /^[a-z][a-z\d+.-]*:/iu.test(value) ||
    value.includes("#") ||
    value.includes("?")
  )
    return undefined;
  const target = path.resolve(root, value);
  return isPathInsideWorkspace(target, root) ? target : undefined;
}

async function inspectCandidate(root: string, target: string, budget: number) {
  let handle;
  try {
    if ((await lstat(target)).isSymbolicLink()) return undefined;
    const resolved = await realpath(target);
    if (!isPathInsideWorkspace(resolved, root)) return undefined;
    // A referenced or raced FIFO must reach the descriptor type check without
    // waiting for a writer and blocking the entire task detail projection.
    handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    if (!before.isFile() || before.size > Math.min(budget, MAX_CANDIDATE_BYTES))
      return undefined;
    // Read a bounded descriptor even if another writer grows the file.
    const buffer = Buffer.alloc(before.size + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const after = await handle.stat();
    const current = await lstat(resolved);
    if (current.dev !== before.dev || current.ino !== before.ino)
      return undefined;
    if (
      bytesRead !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      (await realpath(target)) !== resolved
    )
      return undefined;
    return {
      resolved,
      sizeBytes: bytesRead,
      sha256: sha256(buffer.subarray(0, bytesRead)),
    };
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}
