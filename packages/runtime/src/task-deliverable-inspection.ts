import { constants, type Stats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import type { ThreadDetail } from "@napier/contracts";
import { taskArtifactBinding } from "@napier/contracts/task-narrative";
import { sha256 } from "./ed25519.js";
import { isPathInsideWorkspace } from "./policy.js";

type Narrative = NonNullable<ThreadDetail["taskNarrative"]>;
type Deliverable = NonNullable<Narrative["deliverables"]>[number];
type Observation = NonNullable<Deliverable["observation"]>;
type FileObservation = Omit<Observation, "source" | "bindingSha256">;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_FILE_CHECKS = 64;

/** Request-time observations only: never certify creation or future immutability.
 * File I/O is async and bounded by count/bytes; the workspace is never scanned. */
export async function inspectTaskDeliverables(
  narrative: Narrative,
  workspaceRoot: string | undefined,
): Promise<Narrative> {
  const root = workspaceRoot
    ? await realpath(workspaceRoot).catch(() => undefined)
    : undefined;
  const declared = (narrative.deliverables ?? []).filter(
    (entry) => entry.source === "plan",
  );
  const known = new Set(
    declared.map((entry) => path.resolve(workspaceRoot ?? ".", entry.path)),
  );
  const deliverables: Deliverable[] = [];
  let remainingBytes = MAX_TOTAL_BYTES,
    remainingChecks = MAX_FILE_CHECKS;
  for (const entry of narrative.deliverables ?? []) {
    const formal = entry.source === "plan";
    if (
      !formal &&
      (!entry.sourceEventId ||
        !entry.artifact.sourceRunId ||
        known.has(path.resolve(workspaceRoot ?? ".", entry.path)))
    )
      continue;
    const target =
      root && workspaceRoot
        ? candidatePath(entry.path, workspaceRoot, root)
        : undefined;
    let observed: FileObservation;
    if (!root) observed = unchecked("workspace_unavailable");
    else if (entry.artifact.kind !== "file")
      observed = unchecked("unsupported_kind");
    else if (!target) observed = unchecked("unsafe_path");
    else if (remainingChecks <= 0 || remainingBytes <= 0)
      observed = unchecked("budget_exceeded");
    else {
      remainingChecks -= 1;
      const result = await inspectFile(root, target, remainingBytes);
      observed = result.observed;
      remainingBytes -= result.bytesRead;
    }
    if (formal) {
      deliverables.push(observeDeclared(entry, observed));
    } else if (observed.status === "observed" && root && target) {
      known.add(path.resolve(workspaceRoot!, entry.path));
      const relative = path.relative(root, target);
      deliverables.push({
        ...entry,
        path: relative,
        accessibility: "available",
        artifact: {
          ...entry.artifact,
          path: relative,
          sha256: observed.sha256!,
          sizeBytes: observed.sizeBytes!,
        },
      });
    }
  }
  return { ...narrative, deliverables };
}

function observeDeclared(
  entry: Deliverable,
  observed: FileObservation,
): Deliverable {
  const hasExpected =
    entry.artifact.status === "verified" &&
    entry.artifact.sha256 !== undefined &&
    entry.artifact.sizeBytes !== undefined;
  const status =
    observed.status === "observed" && hasExpected
      ? observed.sha256 === entry.artifact.sha256 &&
        observed.sizeBytes === entry.artifact.sizeBytes
        ? "matched"
        : "mismatched"
      : observed.status;
  return {
    ...entry,
    verification: status === "matched" ? "integrity_observed" : "unverified",
    accessibility:
      status === "missing"
        ? "missing"
        : status === "mismatched"
          ? "drifted"
          : status === "observed" || status === "matched"
            ? "available"
            : "unchecked",
    observation: {
      ...observed,
      status,
      source: "workspace",
      bindingSha256: taskArtifactBinding(entry),
    },
  };
}

function candidatePath(
  value: string,
  workspaceRoot: string,
  root: string,
): string | undefined {
  if (
    !value ||
    value.length > 4096 ||
    value.split(/[\\/]/u).length > 64 ||
    /[\x00-\x1f]/u.test(value) ||
    /^[a-z][a-z\d+.-]*:/iu.test(value) ||
    value.includes("#") ||
    value.includes("?")
  )
    return;
  const target = path.resolve(workspaceRoot, value);
  if (isPathInsideWorkspace(target, workspaceRoot))
    return path.resolve(root, path.relative(workspaceRoot, target));
  return isPathInsideWorkspace(target, root) ? target : undefined;
}

function unchecked(reason: Observation["reason"]): FileObservation {
  return { status: "unchecked", ...(reason ? { reason } : {}) };
}

async function inspectFile(
  root: string,
  target: string,
  budget: number,
): Promise<{
  observed: FileObservation;
  bytesRead: number;
}> {
  let handle,
    bytesRead = 0;
  const done = (observed: FileObservation) => ({ observed, bytesRead });
  try {
    const chain = await pathChain(root, target);
    if (chain.some((entry) => entry.stat.isSymbolicLink()))
      return done(unchecked("symlink"));
    const before = chain.at(-1)!.stat;
    if (!before.isFile()) return done(unchecked("not_regular_file"));
    if (before.size > Math.min(budget, MAX_FILE_BYTES))
      return done(unchecked("budget_exceeded"));
    if ((await realpath(target)) !== target) return done(unchecked("unstable"));
    // O_NONBLOCK prevents a raced FIFO from waiting for a writer. Check the
    // opened identity before reading, including races in parent directories.
    handle = await open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    if (!sameFile(before, await handle.stat()))
      return done(unchecked("unstable"));
    const buffer = Buffer.alloc(
      Math.min(before.size + 1, budget, MAX_FILE_BYTES),
    );
    bytesRead = (await handle.read(buffer, 0, buffer.length, 0)).bytesRead;
    const after = await handle.stat();
    const current = await lstat(target);
    if (
      bytesRead !== before.size ||
      !sameFile(before, after) ||
      !sameFile(before, current) ||
      (await realpath(target)) !== target
    )
      return done(unchecked("unstable"));
    for (const entry of chain.slice(0, -1)) {
      const now = await lstat(entry.path);
      if (
        now.isSymbolicLink() ||
        now.dev !== entry.stat.dev ||
        now.ino !== entry.stat.ino
      )
        return done(unchecked("unstable"));
    }
    return done({
      status: "observed",
      sizeBytes: bytesRead,
      sha256: sha256(buffer.subarray(0, bytesRead)),
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return done(
      code === "ENOENT" || code === "ENOTDIR"
        ? { status: "missing" }
        : unchecked(code === "ELOOP" ? "symlink" : "unreadable"),
    );
  } finally {
    await handle?.close();
  }
}

async function pathChain(
  root: string,
  target: string,
): Promise<Array<{ path: string; stat: Stats }>> {
  let current = root;
  const chain: Array<{ path: string; stat: Stats }> = [];
  for (const segment of path.relative(root, target).split(path.sep)) {
    current = path.join(current, segment);
    const stat = await lstat(current);
    chain.push({ path: current, stat });
    if (stat.isSymbolicLink()) break;
  }
  return chain;
}

function sameFile(left: Stats, right: Stats): boolean {
  return (
    right.isFile() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}
