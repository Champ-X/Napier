import { lstat, mkdir, rename, rmdir, unlink } from "node:fs/promises";
import path from "node:path";

import type { WorkspaceTrashItem } from "@napier/contracts";

import {
  inspectAbsoluteEntry,
  syncDirectory,
  type MissingPathPlan,
  type WorkspaceEntrySnapshot,
  writeJsonExclusive,
} from "./workspace-file-scope.js";

export interface WorkspaceFileCompensationPlan {
  request: { operation: "create_directory" | "move" | "trash" | "restore" };
  source?: WorkspaceEntrySnapshot;
  destination: MissingPathPlan;
  trashItem?: WorkspaceTrashItem;
}

export interface AppliedWorkspaceFileMutation {
  after?: WorkspaceEntrySnapshot;
}

/**
 * Reverses a filesystem commit whose Ledger outcome could not be appended.
 * Every branch checks that the committed bytes have not drifted before moving
 * them and verifies the exact pre-commit state after the reversal.
 */
export async function compensateWorkspaceFileMutation(
  plan: WorkspaceFileCompensationPlan,
  applied: AppliedWorkspaceFileMutation,
  renameEntry: typeof rename,
): Promise<boolean> {
  try {
    if (plan.request.operation === "create_directory") {
      return await removeCreatedDirectories(plan, applied);
    }
    if (plan.request.operation === "move") {
      return await reverseRename(
        plan.destination.target,
        plan.source,
        applied.after,
        renameEntry,
      );
    }
    if (plan.request.operation === "trash") {
      const payload = path.join(plan.destination.target, "payload");
      if (
        !(await reverseRename(payload, plan.source, applied.after, renameEntry))
      ) {
        return false;
      }
      await unlink(path.join(plan.destination.target, "manifest.json"));
      await rmdir(plan.destination.target);
      await syncDirectory(path.dirname(plan.destination.target));
      return (
        (await pathIsMissing(plan.destination.target)) &&
        (await snapshotMatches(plan.source?.target, plan.source))
      );
    }
    return await restoreTrashState(plan, applied, renameEntry);
  } catch {
    return false;
  }
}

async function removeCreatedDirectories(
  plan: WorkspaceFileCompensationPlan,
  applied: AppliedWorkspaceFileMutation,
): Promise<boolean> {
  if (
    !applied.after ||
    !(await snapshotMatches(plan.destination.target, applied.after))
  ) {
    return false;
  }
  for (const directory of [...plan.destination.missingDirectories].reverse()) {
    await rmdir(directory);
    await syncDirectory(path.dirname(directory));
  }
  return await Promise.all(
    plan.destination.missingDirectories.map(pathIsMissing),
  ).then((results) => results.every(Boolean));
}

async function restoreTrashState(
  plan: WorkspaceFileCompensationPlan,
  applied: AppliedWorkspaceFileMutation,
  renameEntry: typeof rename,
): Promise<boolean> {
  const source = plan.source;
  const trashItem = plan.trashItem;
  if (!source || !trashItem || !applied.after) return false;
  if (!(await snapshotMatches(plan.destination.target, applied.after))) {
    return false;
  }
  const itemDirectory = path.dirname(source.target);
  await mkdir(itemDirectory, { mode: 0o700 });
  let manifestWritten = false;
  try {
    await writeJsonExclusive(
      path.join(itemDirectory, "manifest.json"),
      trashItem,
    );
    manifestWritten = true;
    await renameEntry(plan.destination.target, source.target);
    await syncRenameParents(plan.destination.target, source.target);
  } catch (error) {
    if (manifestWritten && (await pathIsMissing(source.target))) {
      await unlink(path.join(itemDirectory, "manifest.json")).catch(
        () => undefined,
      );
      await rmdir(itemDirectory).catch(() => undefined);
    }
    throw error;
  }
  return (
    (await pathIsMissing(plan.destination.target)) &&
    (await snapshotMatches(source.target, source))
  );
}

async function reverseRename(
  committedPath: string,
  original: WorkspaceEntrySnapshot | undefined,
  committed: WorkspaceEntrySnapshot | undefined,
  renameEntry: typeof rename,
): Promise<boolean> {
  if (!original || !committed) return false;
  if (!(await pathIsMissing(original.target))) return false;
  if (!(await snapshotMatches(committedPath, committed))) return false;
  await renameEntry(committedPath, original.target);
  await syncRenameParents(committedPath, original.target);
  return (
    (await pathIsMissing(committedPath)) &&
    (await snapshotMatches(original.target, original))
  );
}

async function syncRenameParents(
  source: string,
  destination: string,
): Promise<void> {
  const sourceParent = path.dirname(source);
  const destinationParent = path.dirname(destination);
  await syncDirectory(sourceParent);
  if (destinationParent !== sourceParent)
    await syncDirectory(destinationParent);
}

async function snapshotMatches(
  target: string | undefined,
  expected: WorkspaceEntrySnapshot | undefined,
): Promise<boolean> {
  if (!target || !expected) return false;
  const actual = await inspectAbsoluteEntry(target).catch(() => undefined);
  return Boolean(
    actual &&
    actual.entryKind === expected.entryKind &&
    actual.snapshotSha256 === expected.snapshotSha256 &&
    actual.fileCount === expected.fileCount &&
    actual.directoryCount === expected.directoryCount &&
    actual.bytes === expected.bytes,
  );
}

async function pathIsMissing(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return false;
  } catch (error) {
    return (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    );
  }
}
