import { randomBytes } from "node:crypto";
import { link, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type {
  PrepareWorkspacePatch,
  WorkspacePatchResult,
} from "./workspace-patch-model.js";

export async function syncWorkspacePatchDirectory(
  directory: string,
): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function commitWorkspacePatch(input: {
  target: string;
  mode: number;
  output: Buffer;
  result: WorkspacePatchResult;
  prepare?: PrepareWorkspacePatch | undefined;
  committed(): void;
  beforeCommit(): Promise<void>;
}): Promise<void> {
  const parent = path.dirname(input.target);
  const temporaryPath = path.join(
    parent,
    `.${path.basename(input.target)}.napier-${randomBytes(8).toString("hex")}.tmp`,
  );
  let temporaryExists = false;
  let beginCommit: void | (() => Promise<void>);
  try {
    const temporary = await open(temporaryPath, "wx", input.mode);
    temporaryExists = true;
    try {
      await temporary.writeFile(input.output);
      await temporary.sync();
      const identity = await temporary.stat();
      beginCommit = await input.prepare?.(input.result, {
        dev: identity.dev,
        ino: identity.ino,
      });
    } finally {
      await temporary.close();
    }
    await input.beforeCommit();
    await beginCommit?.();
    if (input.result.operation === "create") {
      await link(temporaryPath, input.target);
      // The target already exists if unlink/fsync subsequently fails.
      input.committed();
      await unlink(temporaryPath);
    } else {
      await rename(temporaryPath, input.target);
      input.committed();
    }
    temporaryExists = false;
    await syncWorkspacePatchDirectory(parent);
  } finally {
    if (temporaryExists) await unlink(temporaryPath).catch(() => undefined);
  }
}
