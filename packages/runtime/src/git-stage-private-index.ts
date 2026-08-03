import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { inflate } from "node:zlib";

import { canonicalJson, sha256 } from "./ed25519.js";
import { gitStageDiffArguments } from "./git-inspect-arguments.js";
import {
  MAX_GIT_PROCESS_OUTPUT_CHARS,
  runGitProcess,
  type GitInspectProcessOptions,
  type GitInspectProcessResult,
  type GitProcessIsolation,
} from "./git-inspect-process.js";
import {
  gitErrorCode,
  gitPathExists,
  MAX_GIT_INDEX_BYTES,
  type GitRepository,
} from "./git-repository.js";
import {
  gitDiffCounts,
  type GitDiffCounts,
  MAX_GIT_STAGE_TARGETS,
} from "./git-stage-model.js";
import { gitStageIndexTransitions } from "./git-stage-index-transition.js";
import { preparePrivateStageMutation } from "./git-stage-private-mutation.js";
import { syncDirectory } from "./workspace-file-scope.js";

const inflateAsync = promisify(inflate);
const MAX_LOOSE_OBJECTS = 64;
const MAX_LOOSE_OBJECT_BYTES = 20 * 1024 * 1024;
const OBJECT_DIRECTORY = /^[a-f0-9]{2}$/u;
const OBJECT_FILE = /^[a-f0-9]{38}$/u;

export interface PreparedGitStage {
  temporaryDirectory: string;
  objectDirectory: string;
  indexBytes: Buffer;
  indexSha256: string;
  patch: string;
  counts: GitDiffCounts;
  targetCount: number;
  selectionMode: "path" | "hunks";
  selectedHunkCount: number;
  hunkSelectionSha256: string;
  sandboxSha256: string;
  executableSha256: string;
  environmentSha256: string;
  resourceLimitsSha256: string;
  durationMs: number;
}

export async function preparePrivateGitStage(input: {
  processOptions: GitInspectProcessOptions;
  repository: GitRepository;
  initialIndexBytes: Buffer;
  targetPaths: string[];
  contextLines: number;
  hunkIndexes?: number[];
  deadline: number;
  configProcess: GitInspectProcessResult;
  signal?: AbortSignal;
}): Promise<PreparedGitStage> {
  if (
    input.targetPaths.length < 1 ||
    input.targetPaths.length > MAX_GIT_STAGE_TARGETS ||
    (input.hunkIndexes !== undefined && input.targetPaths.length !== 1)
  ) {
    throw new Error("Git private stage target set is invalid");
  }
  const stageRoot = await ensurePrivateStageRoot(input.repository);
  const temporaryDirectory = await mkdtemp(path.join(stageRoot, "stage-"));
  await chmod(temporaryDirectory, 0o700);
  const objectDirectory = path.join(temporaryDirectory, "objects");
  const indexFile = path.join(temporaryDirectory, "index");
  try {
    await mkdir(objectDirectory, { mode: 0o700 });
    await writePrivateIndex(indexFile, input.initialIndexBytes);
    const isolation: GitProcessIsolation = {
      operation: "stage",
      privateFiles: {
        indexFile,
        objectDirectory,
        alternateObjectDirectory: await validateObjectDirectory(
          input.repository,
        ),
      },
      workspaceWritePaths: [temporaryDirectory],
    };
    const initialIndexSha256 = sha256(input.initialIndexBytes);
    const mutation = await preparePrivateStageMutation({
      processOptions: input.processOptions,
      repository: input.repository,
      targetPaths: input.targetPaths,
      contextLines: input.contextLines,
      ...(input.hunkIndexes ? { hunkIndexes: input.hunkIndexes } : {}),
      deadline: input.deadline,
      ...(input.signal ? { signal: input.signal } : {}),
      isolation,
    });
    const indexBytes = await readPrivateIndex(indexFile);
    const indexSha256 = sha256(indexBytes);
    if (indexSha256 === initialIndexSha256) {
      throw new Error("Git stage target has no unstaged change");
    }
    const diffs = await createGitStageDiffs(input, isolation);
    const patch = diffs.parts.join("");
    const processes = [
      input.configProcess,
      ...mutation.processes,
      ...diffs.processes,
    ];
    assertSameRuntime(processes);
    const counts = gitDiffCounts(patch);
    return {
      temporaryDirectory,
      objectDirectory,
      indexBytes,
      indexSha256,
      patch,
      counts: {
        ...counts,
        fileCount: counts.fileCount + diffs.indexTransitionCount,
      },
      targetCount: input.targetPaths.length,
      selectionMode: mutation.selectionMode,
      selectedHunkCount: mutation.selectedHunkCount,
      hunkSelectionSha256: mutation.hunkSelectionSha256,
      sandboxSha256: mutation.processes.at(-1)!.sandboxSha256,
      executableSha256: mutation.processes.at(-1)!.executableSha256,
      environmentSha256: sha256(
        canonicalJson(processes.map((item) => item.environmentSha256)),
      ),
      resourceLimitsSha256: sha256(
        canonicalJson(processes.map((item) => item.resourceLimitsSha256)),
      ),
      durationMs: processes.reduce((total, item) => total + item.durationMs, 0),
    };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function createGitStageDiffs(
  input: Parameters<typeof preparePrivateGitStage>[0],
  isolation: GitProcessIsolation,
): Promise<{
  processes: GitInspectProcessResult[];
  parts: string[];
  indexTransitionCount: number;
}> {
  const processes: GitInspectProcessResult[] = [];
  for (const targetPath of input.targetPaths) {
    const diff = await runGitProcess(
      input.processOptions,
      gitStageDiffArguments(input.repository, targetPath, input.contextLines),
      remainingTime(input.deadline),
      input.signal,
      isolation,
    );
    const outputTooLarge =
      Buffer.byteLength(diff.stdout, "utf8") > MAX_GIT_PROCESS_OUTPUT_CHARS;
    if (
      diff.status !== "succeeded" ||
      diff.stderr.length > 0 ||
      outputTooLarge
    ) {
      throw new Error(
        diff.status === "output_capped" || outputTooLarge
          ? "Git stage preview exceeds its bounded output limit"
          : "Git stage preview could not be constructed",
      );
    }
    processes.push(diff);
  }
  const emptyPaths = input.targetPaths.filter(
    (_targetPath, index) => processes[index]?.stdout.length === 0,
  );
  const transitions =
    emptyPaths.length > 0 && input.hunkIndexes === undefined
      ? gitStageIndexTransitions(input.initialIndexBytes, emptyPaths)
      : new Map<string, string>();
  const parts: string[] = [];
  let totalBytes = 0;
  for (let index = 0; index < input.targetPaths.length; index += 1) {
    const targetPath = input.targetPaths[index]!;
    const part = processes[index]!.stdout || transitions.get(targetPath) || "";
    if (part.length === 0) {
      throw new Error("Every Git stage target must have a staged change");
    }
    totalBytes += Buffer.byteLength(part, "utf8");
    if (totalBytes > MAX_GIT_PROCESS_OUTPUT_CHARS) {
      throw new Error("Git stage preview exceeds its bounded output limit");
    }
    parts.push(part);
  }
  return {
    processes,
    parts,
    indexTransitionCount: transitions.size,
  };
}

export async function promotePreparedGitObjects(
  prepared: Pick<PreparedGitStage, "objectDirectory">,
  repository: GitRepository,
): Promise<void> {
  const objectRoot = await validateObjectDirectory(repository);
  const directories = await readdir(prepared.objectDirectory, {
    withFileTypes: true,
  });
  if (
    directories.length > MAX_LOOSE_OBJECTS ||
    directories.some(
      (entry) =>
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        !OBJECT_DIRECTORY.test(entry.name),
    )
  ) {
    throw new Error("Git stage produced unsupported object metadata");
  }
  let objectCount = 0;
  for (const directory of directories) {
    const sourceDirectory = path.join(prepared.objectDirectory, directory.name);
    const targetDirectory = path.join(objectRoot, directory.name);
    await ensureObjectSubdirectory(targetDirectory);
    const files = await readdir(sourceDirectory, { withFileTypes: true });
    for (const file of files) {
      objectCount += 1;
      if (
        objectCount > MAX_LOOSE_OBJECTS ||
        !file.isFile() ||
        file.isSymbolicLink() ||
        !OBJECT_FILE.test(file.name)
      ) {
        throw new Error("Git stage produced unsupported object metadata");
      }
      const objectId = `${directory.name}${file.name}`;
      const source = path.join(sourceDirectory, file.name);
      await verifyLooseObject(source, objectId);
      const target = path.join(targetDirectory, file.name);
      try {
        await link(source, target);
      } catch (error) {
        if (gitErrorCode(error) !== "EEXIST") throw error;
        await verifyLooseObject(target, objectId);
      }
    }
    await syncDirectory(targetDirectory);
  }
  await syncDirectory(objectRoot);
}

export async function installPreparedGitIndex(input: {
  prepared: Pick<PreparedGitStage, "indexBytes">;
  repository: GitRepository;
  indexMode: number;
  verifyCurrentState: () => Promise<void>;
  signal?: AbortSignal;
}): Promise<boolean> {
  const lockPath = path.join(input.repository.gitDirectory, "index.lock");
  const indexPath = path.join(input.repository.gitDirectory, "index");
  let handle;
  let committed = false;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await chmod(lockPath, input.indexMode);
    await input.verifyCurrentState();
    abort(input.signal);
    await handle.writeFile(input.prepared.indexBytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    abort(input.signal);
    await rename(lockPath, indexPath);
    committed = true;
    try {
      await syncDirectory(input.repository.gitDirectory);
      return true;
    } catch {
      return false;
    }
  } finally {
    await handle?.close().catch(() => undefined);
    if (!committed) await unlink(lockPath).catch(() => undefined);
  }
}

export async function cleanupPreparedGitStage(
  prepared: Pick<PreparedGitStage, "temporaryDirectory">,
): Promise<void> {
  await rm(prepared.temporaryDirectory, { recursive: true, force: true });
}

function remainingTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Git stage operation timed out");
  return remaining;
}

async function ensurePrivateStageRoot(
  repository: GitRepository,
): Promise<string> {
  const stageRoot = path.join(repository.gitDirectory, "napier-stage");
  let created = false;
  try {
    await mkdir(stageRoot, { mode: 0o700 });
    created = true;
  } catch (error) {
    if (gitErrorCode(error) !== "EEXIST") throw error;
  }
  const info = await lstat(stageRoot);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (!created &&
      ((info.mode & 0o777) !== 0o700 ||
        (typeof process.getuid === "function" &&
          info.uid !== process.getuid())))
  ) {
    throw new Error("Git private stage root is invalid");
  }
  return stageRoot;
}

async function validateObjectDirectory(
  repository: GitRepository,
): Promise<string> {
  const objectRoot = path.join(repository.gitDirectory, "objects");
  const info = await lstat(objectRoot);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Git object directory is unsupported");
  }
  if (await gitPathExists(path.join(objectRoot, "info/alternates"))) {
    throw new Error("Git object alternates are unsupported");
  }
  return objectRoot;
}

async function ensureObjectSubdirectory(directory: string): Promise<void> {
  try {
    await mkdir(directory, { mode: 0o755 });
  } catch (error) {
    if (gitErrorCode(error) !== "EEXIST") throw error;
  }
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Git object directory is unsupported");
  }
}

async function writePrivateIndex(
  filePath: string,
  content: Buffer,
): Promise<void> {
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readPrivateIndex(filePath: string): Promise<Buffer> {
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_GIT_INDEX_BYTES) {
      throw new Error("Git private index is invalid");
    }
    return await readExact(handle, info.size, "Git private index");
  } finally {
    await handle.close();
  }
}

async function verifyLooseObject(
  filePath: string,
  expectedObjectId: string,
): Promise<void> {
  const info = await lstat(filePath);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > MAX_LOOSE_OBJECT_BYTES
  ) {
    throw new Error("Git loose object is invalid");
  }
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const compressed = await readExact(handle, info.size, "Git loose object");
    const inflated = await inflateAsync(compressed);
    if (
      createHash("sha1").update(inflated).digest("hex") !== expectedObjectId
    ) {
      throw new Error("Git loose object hash is invalid");
    }
  } finally {
    await handle.close();
  }
}

async function readExact(
  handle: Awaited<ReturnType<typeof open>>,
  size: number,
  label: string,
): Promise<Buffer> {
  const content = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const result = await handle.read(content, offset, size - offset, offset);
    if (result.bytesRead === 0) {
      throw new Error(`${label} changed while it was read`);
    }
    offset += result.bytesRead;
  }
  const probe = Buffer.alloc(1);
  if ((await handle.read(probe, 0, 1, size)).bytesRead > 0) {
    throw new Error(`${label} changed while it was read`);
  }
  return content;
}

function assertSameRuntime(processes: GitInspectProcessResult[]): void {
  const first = processes[0]!;
  if (
    processes.some(
      (item) =>
        item.sandboxSha256 !== first.sandboxSha256 ||
        item.executableSha256 !== first.executableSha256,
    )
  ) {
    throw new Error("Git stage runtime identity changed");
  }
}

function abort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Git stage operation was aborted");
}
