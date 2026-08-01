import {
  chmod,
  constants,
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
} from "node:fs/promises";
import path from "node:path";

import type { WorkspaceFileEntryKind } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  compareDirectoryEntries,
  inspectAbsoluteEntry,
  syncDirectory,
} from "./workspace-file-scope.js";

export async function inspectWorkspaceProcessRecoveryEntry(target: string) {
  const snapshot = await inspectAbsoluteEntry(target);
  const modes: Array<{
    path: string;
    entryKind: WorkspaceFileEntryKind;
    mode: number;
  }> = [];
  const visit = async (current: string, relative: string): Promise<void> => {
    const info = await lstat(current);
    if (info.isSymbolicLink()) {
      throw new Error("Workspace Process recovery refuses symbolic links");
    }
    const entryKind: WorkspaceFileEntryKind = info.isDirectory()
      ? "directory"
      : "file";
    modes.push({
      path: relative,
      entryKind,
      mode: info.mode & 0o777,
    });
    if (!info.isDirectory()) return;
    const children = await readdir(current, { withFileTypes: true });
    children.sort(compareDirectoryEntries);
    for (const child of children) {
      await visit(
        path.join(current, child.name),
        relative === "." ? child.name : path.join(relative, child.name),
      );
    }
  };
  await visit(target, ".");
  return {
    ...snapshot,
    modeSetSha256: sha256(canonicalJson(modes)),
  };
}

export async function copyWorkspaceProcessRecoveryEntry(
  source: string,
  destination: string,
): Promise<void> {
  const info = await lstat(source);
  if (info.isSymbolicLink()) {
    throw new Error("Workspace Process recovery refuses symbolic links");
  }
  if (info.isFile()) {
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    await chmod(destination, info.mode & 0o777);
    const handle = await open(destination, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    return;
  }
  if (!info.isDirectory()) {
    throw new Error("Workspace Process recovery contains an unsupported entry");
  }
  await mkdir(destination, { mode: 0o700 });
  const children = await readdir(source, { withFileTypes: true });
  children.sort(compareDirectoryEntries);
  for (const child of children) {
    await copyWorkspaceProcessRecoveryEntry(
      path.join(source, child.name),
      path.join(destination, child.name),
    );
  }
  await chmod(destination, info.mode & 0o777);
  await syncDirectory(destination);
}
