import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rm,
} from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  gitCommitTreeArguments,
  gitHeadCommitArguments,
  gitStagedDiffArguments,
  gitStagedRawArguments,
  gitWriteTreeArguments,
} from "./git-inspect-arguments.js";
import {
  GIT_COMMIT_IDENTITY,
  MAX_GIT_PROCESS_OUTPUT_CHARS,
  runGitInspectProcess,
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
import { MAX_GIT_COMMIT_FILES } from "./git-commit-model.js";
import { gitDiffCounts, type GitDiffCounts } from "./git-stage-model.js";

const SHA1 = /^[a-f0-9]{40}$/u;
const COMMIT_STATE_MARKERS = [
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "REBASE_HEAD",
  "AUTO_MERGE",
  "BISECT_LOG",
  "rebase-apply",
  "rebase-merge",
  "sequencer",
] as const;

export interface PreparedGitCommit {
  temporaryDirectory: string;
  objectDirectory: string;
  parentCommitSha1: string;
  treeSha1: string;
  commitSha1: string;
  stagedPatch: string;
  counts: GitDiffCounts;
  identitySha256: string;
  sandboxSha256: string;
  executableSha256: string;
  environmentSha256: string;
  resourceLimitsSha256: string;
  durationMs: number;
}

export async function preparePrivateGitCommit(input: {
  processOptions: GitInspectProcessOptions;
  repository: GitRepository;
  indexBytes: Buffer;
  message: string;
  timestampSeconds: number;
  contextLines: number;
  deadline: number;
  configProcess: GitInspectProcessResult;
  signal?: AbortSignal;
}): Promise<PreparedGitCommit> {
  await assertSimpleGitCommitState(input.repository);
  const stageRoot = await ensurePrivateRoot(input.repository);
  const temporaryDirectory = await mkdtemp(path.join(stageRoot, "commit-"));
  await chmod(temporaryDirectory, 0o700);
  const objectDirectory = path.join(temporaryDirectory, "objects");
  const indexFile = path.join(temporaryDirectory, "index");
  const messageFile = path.join(temporaryDirectory, "message");
  try {
    await mkdir(objectDirectory, { mode: 0o700 });
    await writePrivateFile(indexFile, input.indexBytes);
    await writePrivateFile(messageFile, Buffer.from(input.message, "utf8"));
    const parent = await runGitInspectProcess(
      input.processOptions,
      gitHeadCommitArguments(input.repository),
      remainingTime(input.deadline),
      input.signal,
    );
    const parentCommitSha1 = parseSha1(parent, "Git HEAD commit");
    const isolation: GitProcessIsolation = {
      operation: "commit",
      privateFiles: {
        indexFile,
        objectDirectory,
        alternateObjectDirectory: await validateObjectDirectory(
          input.repository,
        ),
      },
      workspaceWritePaths: [temporaryDirectory],
      commitTimestampSeconds: input.timestampSeconds,
    };
    const raw = await runGitProcess(
      input.processOptions,
      gitStagedRawArguments(input.repository),
      remainingTime(input.deadline),
      input.signal,
      isolation,
    );
    const rawCount = validateRawStagedEntries(raw);
    const diff = await runGitProcess(
      input.processOptions,
      gitStagedDiffArguments(input.repository, input.contextLines),
      remainingTime(input.deadline),
      input.signal,
      isolation,
    );
    validateStagedPatch(diff);
    const counts = gitDiffCounts(diff.stdout);
    if (
      counts.fileCount < 1 ||
      counts.fileCount > MAX_GIT_COMMIT_FILES ||
      counts.fileCount !== rawCount
    ) {
      throw new Error("Git commit staged file count exceeds its bounded limit");
    }
    const tree = await runGitProcess(
      input.processOptions,
      gitWriteTreeArguments(input.repository),
      remainingTime(input.deadline),
      input.signal,
      isolation,
    );
    const treeSha1 = parseSha1(tree, "Git commit tree");
    const commit = await runGitProcess(
      input.processOptions,
      gitCommitTreeArguments(
        input.repository,
        treeSha1,
        parentCommitSha1,
        messageFile,
      ),
      remainingTime(input.deadline),
      input.signal,
      isolation,
    );
    const commitSha1 = parseSha1(commit, "Git commit object");
    const processes = [input.configProcess, parent, raw, diff, tree, commit];
    assertSameRuntime(processes);
    return {
      temporaryDirectory,
      objectDirectory,
      parentCommitSha1,
      treeSha1,
      commitSha1,
      stagedPatch: diff.stdout,
      counts,
      identitySha256: sha256(canonicalJson(GIT_COMMIT_IDENTITY)),
      sandboxSha256: commit.sandboxSha256,
      executableSha256: commit.executableSha256,
      environmentSha256: sha256(
        canonicalJson(processes.map((item) => item.environmentSha256)),
      ),
      resourceLimitsSha256: sha256(
        canonicalJson(processes.map((item) => item.resourceLimitsSha256)),
      ),
      durationMs: processes.reduce((total, item) => total + item.durationMs, 0),
    };
  } catch (error) {
    await cleanupGitCommitDirectory(temporaryDirectory);
    throw error;
  }
}

function validateRawStagedEntries(result: GitInspectProcessResult): number {
  if (
    result.status !== "succeeded" ||
    result.stderr.length > 0 ||
    Buffer.byteLength(result.stdout, "utf8") > MAX_GIT_PROCESS_OUTPUT_CHARS
  ) {
    throw new Error("Git commit raw staged entries are unavailable");
  }
  if (result.stdout.length === 0) return 0;
  const fields = result.stdout.split("\u0000");
  if (fields.at(-1) === "") fields.pop();
  if (fields.length < 2 || fields.length % 2 !== 0) {
    throw new Error("Git commit raw staged entries are invalid");
  }
  for (let index = 0; index < fields.length; index += 2) {
    const header = fields[index] ?? "";
    const target = fields[index + 1] ?? "";
    const match = /^:(\d{6}) (\d{6}) [a-f0-9]+ [a-f0-9]+ [A-Z]$/u.exec(header);
    if (!match || !target || match[1] === "160000" || match[2] === "160000") {
      throw new Error("Git commit contains unsupported staged entries");
    }
  }
  return fields.length / 2;
}

export async function assertSimpleGitCommitState(
  repository: GitRepository,
): Promise<void> {
  for (const marker of COMMIT_STATE_MARKERS) {
    if (await gitPathExists(path.join(repository.gitDirectory, marker))) {
      throw new Error("Git commit cannot run during another Git operation");
    }
  }
}

export async function cleanupGitCommitDirectory(
  temporaryDirectory: string,
): Promise<void> {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function validateStagedPatch(result: GitInspectProcessResult): void {
  if (
    result.status === "output_capped" ||
    Buffer.byteLength(result.stdout, "utf8") > MAX_GIT_PROCESS_OUTPUT_CHARS
  ) {
    throw new Error("Git commit staged patch exceeds its bounded output limit");
  }
  if (
    result.status !== "succeeded" ||
    result.stderr.length > 0 ||
    result.stdout.length === 0
  ) {
    throw new Error("Git commit requires a non-empty staged patch");
  }
}

function parseSha1(result: GitInspectProcessResult, label: string): string {
  const value = result.stdout.trim();
  if (
    result.status !== "succeeded" ||
    result.stderr.length > 0 ||
    !SHA1.test(value)
  ) {
    throw new Error(`${label} is unavailable`);
  }
  return value;
}

async function ensurePrivateRoot(repository: GitRepository): Promise<string> {
  const root = path.join(repository.gitDirectory, "napier-stage");
  try {
    await mkdir(root, { mode: 0o700 });
  } catch (error) {
    if (gitErrorCode(error) !== "EEXIST") throw error;
  }
  const info = await lstat(root);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (info.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === "function" && info.uid !== process.getuid())
  ) {
    throw new Error("Git private commit root is invalid");
  }
  return root;
}

async function validateObjectDirectory(
  repository: GitRepository,
): Promise<string> {
  const objectRoot = path.join(repository.gitDirectory, "objects");
  const info = await lstat(objectRoot);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (await realpath(objectRoot)) !== objectRoot
  ) {
    throw new Error("Git object directory is unsupported");
  }
  if (await gitPathExists(path.join(objectRoot, "info/alternates"))) {
    throw new Error("Git object alternates are unsupported");
  }
  return objectRoot;
}

async function writePrivateFile(
  filePath: string,
  content: Buffer,
): Promise<void> {
  if (content.length > MAX_GIT_INDEX_BYTES) {
    throw new Error("Git private commit file exceeds its bounded limit");
  }
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function remainingTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Git commit operation timed out");
  return remaining;
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
    throw new Error("Git commit runtime identity changed");
  }
}
