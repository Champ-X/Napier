import { chmod, lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./ed25519.js";
import {
  gitBranchCheckoutBlobArguments,
  gitBranchCheckoutPatchArguments,
  gitBranchCheckoutRawArguments,
  gitBranchCheckoutReadTreeArguments,
  gitBranchCheckoutStatusArguments,
  gitBranchCheckoutTreeArguments,
  gitBranchCheckoutWriteTreeArguments,
} from "./git-branch-switch-checkout-arguments.js";
import {
  assertNoGitBranchCheckoutAttributes,
  assertGitBranchCheckoutBlob,
  cleanupGitBranchCheckoutDirectory,
  createGitBranchCheckoutPrivateDirectory,
  gitBlobSha1,
  readGitBranchCheckoutIndex,
  snapshotGitBranchCheckoutPath,
  writeGitBranchCheckoutFile,
} from "./git-branch-switch-checkout-files.js";
import {
  createGitBranchCheckoutPlan,
  GIT_BRANCH_CHECKOUT_CONTEXT_LINES,
  GIT_BRANCH_CHECKOUT_UNSUPPORTED_CONFIG_KEYS,
  gitBranchCheckoutExpectedMode,
  MAX_GIT_BRANCH_CHECKOUT_TOTAL_BYTES,
  parseGitBranchCheckoutRaw,
  type GitBranchCheckoutFile,
  type PreparedGitBranchCheckout,
  type PreparedGitBranchCheckoutFile,
} from "./git-branch-switch-checkout-model.js";
import {
  MAX_GIT_PROCESS_OUTPUT_CHARS,
  runGitInspectProcess,
  runGitProcess,
  type GitInspectProcessOptions,
  type GitInspectProcessResult,
  type GitPrivateProcessFiles,
} from "./git-inspect-process.js";
import {
  gitPathExists,
  readGitIndexBytes,
  type GitRepository,
  type GitRepositoryState,
} from "./git-repository.js";
import { gitDiffCounts } from "./git-stage-model.js";

const SHA1 = /^[a-f0-9]{40}$/u;

export interface PreparedGitBranchCheckoutResult {
  checkout?: PreparedGitBranchCheckout;
  processes: GitInspectProcessResult[];
}

export async function prepareGitBranchCheckout(input: {
  options: GitInspectProcessOptions;
  repository: GitRepository;
  repositoryState: GitRepositoryState;
  configOutput: string;
  sourceCommitSha1: string;
  targetCommitSha1: string;
  expectedPlanSha256?: string;
  deadline: number;
  signal?: AbortSignal;
}): Promise<PreparedGitBranchCheckoutResult> {
  if (input.sourceCommitSha1 === input.targetCommitSha1) {
    throw new Error("Git branch checkout requires a divergent target");
  }
  const sourceIndexBytes = await readGitIndexBytes(input.repository);
  if (
    !sourceIndexBytes ||
    sha256(sourceIndexBytes) !== input.repositoryState.index.sha256
  ) {
    throw new Error("Git branch checkout index is unavailable");
  }
  const temporaryDirectory = await createGitBranchCheckoutPrivateDirectory(
    input.repository,
    "preview-",
  );
  const objectDirectory = path.join(temporaryDirectory, "objects");
  const sourceIndexFile = path.join(temporaryDirectory, "source-index");
  const targetIndexFile = path.join(temporaryDirectory, "target-index");
  try {
    await mkdir(objectDirectory, { mode: 0o700 });
    await chmod(objectDirectory, 0o700);
    await writeGitBranchCheckoutFile(
      sourceIndexFile,
      sourceIndexBytes,
      input.repositoryState.index.mode,
    );
    const alternateObjectDirectory = await validateObjectDirectory(
      input.repository,
    );
    const sourcePrivate = privateFiles(
      sourceIndexFile,
      objectDirectory,
      alternateObjectDirectory,
    );
    const targetPrivate = privateFiles(
      targetIndexFile,
      objectDirectory,
      alternateObjectDirectory,
    );
    const [status, raw, patch, sourceTree, targetTree, sourceIndexTree] =
      await Promise.all([
        inspect(input, gitBranchCheckoutStatusArguments(input.repository)),
        inspect(
          input,
          gitBranchCheckoutRawArguments(
            input.repository,
            input.sourceCommitSha1,
            input.targetCommitSha1,
          ),
        ),
        inspect(
          input,
          gitBranchCheckoutPatchArguments(
            input.repository,
            input.sourceCommitSha1,
            input.targetCommitSha1,
            GIT_BRANCH_CHECKOUT_CONTEXT_LINES,
          ),
        ),
        inspect(
          input,
          gitBranchCheckoutTreeArguments(
            input.repository,
            input.sourceCommitSha1,
          ),
        ),
        inspect(
          input,
          gitBranchCheckoutTreeArguments(
            input.repository,
            input.targetCommitSha1,
          ),
        ),
        mutatePrivateIndex(
          input,
          gitBranchCheckoutWriteTreeArguments(input.repository),
          sourcePrivate,
        ),
      ]);
    const sourceTreeSha1 = requireSha1(sourceTree, "source tree");
    const targetTreeSha1 = requireSha1(targetTree, "target tree");
    const initialProcesses = [
      status,
      raw,
      patch,
      sourceTree,
      targetTree,
      sourceIndexTree,
    ];
    if (sourceTreeSha1 === targetTreeSha1) {
      assertEmptyInspection(raw, "raw delta");
      assertEmptyInspection(patch, "patch");
      await cleanupGitBranchCheckoutDirectory(temporaryDirectory);
      return { processes: initialProcesses };
    }
    assertCleanStatus(status);
    assertCheckoutConfig(input.configOutput);
    assertBoundedOutput(raw, "raw delta");
    assertBoundedOutput(patch, "patch");
    if (requireSha1(sourceIndexTree, "source index tree") !== sourceTreeSha1) {
      throw new Error("Git branch checkout source is not a clean tree");
    }
    const rawEntries = parseGitBranchCheckoutRaw(raw.stdout);
    await assertNoGitBranchCheckoutAttributes(
      input.repository,
      rawEntries.map((entry) => entry.path),
    );
    const readTree = await mutatePrivateIndex(
      input,
      gitBranchCheckoutReadTreeArguments(
        input.repository,
        input.targetCommitSha1,
      ),
      targetPrivate,
    );
    assertEmptyMutation(readTree, "target index");
    const targetIndexTree = await mutatePrivateIndex(
      input,
      gitBranchCheckoutWriteTreeArguments(input.repository),
      targetPrivate,
    );
    if (requireSha1(targetIndexTree, "target index tree") !== targetTreeSha1) {
      throw new Error("Git branch checkout target index is invalid");
    }
    const targetIndexBytes = await readGitBranchCheckoutIndex(targetIndexFile);
    const preparedFiles: PreparedGitBranchCheckoutFile[] = [];
    const blobProcesses: GitInspectProcessResult[] = [];
    let totalBytes = 0;
    for (const entry of rawEntries) {
      const source = await snapshotGitBranchCheckoutPath(
        input.repository,
        entry.path,
      );
      assertSourcePath(entry, source);
      let targetContent: Buffer | undefined;
      if (entry.targetGitMode !== 0) {
        const blob = await inspect(
          input,
          gitBranchCheckoutBlobArguments(
            input.repository,
            entry.targetBlobSha1,
          ),
        );
        blobProcesses.push(blob);
        if (blob.status !== "succeeded" || blob.stderr.length > 0) {
          throw new Error("Git branch checkout target blob is unavailable");
        }
        targetContent = Buffer.from(blob.stdout, "utf8");
        assertGitBranchCheckoutBlob(targetContent, entry.targetBlobSha1);
      }
      totalBytes += source.bytes + (targetContent?.length ?? 0);
      if (totalBytes > MAX_GIT_BRANCH_CHECKOUT_TOTAL_BYTES) {
        throw new Error("Git branch checkout file set exceeds its byte limit");
      }
      preparedFiles.push({
        path: entry.path,
        pathSha256: entry.pathSha256,
        sourceGitMode: entry.sourceGitMode,
        targetGitMode: entry.targetGitMode,
        sourceBlobSha1: entry.sourceBlobSha1,
        targetBlobSha1: entry.targetBlobSha1,
        beforeSha256: source.sha256,
        expectedSha256: targetContent ? sha256(targetContent) : null,
        beforeMode: source.mode,
        beforeBytes: source.bytes,
        expectedMode: gitBranchCheckoutExpectedMode(
          source.mode,
          entry.targetGitMode,
        ),
        expectedBytes: targetContent?.length ?? 0,
        ...(targetContent ? { targetContent } : {}),
      });
    }
    const files = preparedFiles.map(publicFile);
    const plan = createGitBranchCheckoutPlan({
      sourceCommitSha1: input.sourceCommitSha1,
      targetCommitSha1: input.targetCommitSha1,
      sourceTreeSha1,
      targetTreeSha1,
      sourceIndexSha256: sha256(sourceIndexBytes),
      targetIndexSha256: sha256(targetIndexBytes),
      files,
      counts: gitDiffCounts(patch.stdout),
      patch: patch.stdout,
    });
    if (
      input.expectedPlanSha256 &&
      plan.planSha256 !== input.expectedPlanSha256
    ) {
      throw new Error(
        "Git branch checkout preview is stale; preview the switch again",
      );
    }
    return {
      checkout: {
        plan,
        files: preparedFiles,
        patch: patch.stdout,
        sourceIndexBytes,
        targetIndexBytes,
        temporaryDirectory,
      },
      processes: [
        ...initialProcesses,
        readTree,
        targetIndexTree,
        ...blobProcesses,
      ],
    };
  } catch (error) {
    await cleanupGitBranchCheckoutDirectory(temporaryDirectory);
    throw error;
  }
}

function privateFiles(
  indexFile: string,
  objectDirectory: string,
  alternateObjectDirectory: string,
): GitPrivateProcessFiles {
  return { indexFile, objectDirectory, alternateObjectDirectory };
}

async function inspect(
  input: Parameters<typeof prepareGitBranchCheckout>[0],
  args: string[],
): Promise<GitInspectProcessResult> {
  return runGitInspectProcess(
    input.options,
    args,
    remainingTime(input.deadline),
    input.signal,
  );
}

async function mutatePrivateIndex(
  input: Parameters<typeof prepareGitBranchCheckout>[0],
  args: string[],
  files: GitPrivateProcessFiles,
): Promise<GitInspectProcessResult> {
  return runGitProcess(
    input.options,
    args,
    remainingTime(input.deadline),
    input.signal,
    {
      operation: "switch",
      privateFiles: files,
      workspaceWritePaths: [path.dirname(files.indexFile)],
    },
  );
}

function assertCleanStatus(result: GitInspectProcessResult): void {
  if (
    result.status !== "succeeded" ||
    result.stdout.length > 0 ||
    result.stderr.length > 0
  ) {
    throw new Error("Git divergent branch switch requires a clean repository");
  }
}

function assertCheckoutConfig(output: string): void {
  const unsupported = new Set<string>(
    GIT_BRANCH_CHECKOUT_UNSUPPORTED_CONFIG_KEYS,
  );
  if (
    output
      .split("\n")
      .map((value) => value.trim().toLowerCase())
      .some((value) => unsupported.has(value))
  ) {
    throw new Error("Git branch checkout conversion config is unsupported");
  }
}

function assertBoundedOutput(
  result: GitInspectProcessResult,
  label: string,
): void {
  if (
    result.status !== "succeeded" ||
    result.stderr.length > 0 ||
    result.stdout.length === 0 ||
    Buffer.byteLength(result.stdout, "utf8") > MAX_GIT_PROCESS_OUTPUT_CHARS
  ) {
    throw new Error(`Git branch checkout ${label} is unavailable`);
  }
}

function assertEmptyMutation(
  result: GitInspectProcessResult,
  label: string,
): void {
  if (
    result.status !== "succeeded" ||
    result.stdout.length > 0 ||
    result.stderr.length > 0
  ) {
    throw new Error(`Git branch checkout ${label} is unavailable`);
  }
}

function assertEmptyInspection(
  result: GitInspectProcessResult,
  label: string,
): void {
  if (
    result.status !== "succeeded" ||
    result.stdout.length > 0 ||
    result.stderr.length > 0
  ) {
    throw new Error(`Git branch checkout ${label} is invalid`);
  }
}

function requireSha1(result: GitInspectProcessResult, label: string): string {
  const value = result.stdout.trim();
  if (
    result.status !== "succeeded" ||
    result.stderr.length > 0 ||
    !SHA1.test(value)
  ) {
    throw new Error(`Git branch checkout ${label} is unavailable`);
  }
  return value;
}

function assertSourcePath(
  entry: ReturnType<typeof parseGitBranchCheckoutRaw>[number],
  source: Awaited<ReturnType<typeof snapshotGitBranchCheckoutPath>>,
): void {
  if (entry.sourceGitMode === 0) {
    if (source.present) {
      throw new Error("Git branch checkout addition target already exists");
    }
    return;
  }
  if (
    !source.present ||
    !source.content ||
    gitBlobSha1(source.content) !== entry.sourceBlobSha1 ||
    ((source.mode! & 0o111) !== 0) !== (entry.sourceGitMode === 0o100755)
  ) {
    throw new Error("Git branch checkout source path is not clean");
  }
}

function publicFile(
  file: PreparedGitBranchCheckoutFile,
): GitBranchCheckoutFile {
  const { targetContent: _targetContent, ...value } = file;
  return value;
}

async function validateObjectDirectory(
  repository: GitRepository,
): Promise<string> {
  const objectRoot = path.join(repository.gitDirectory, "objects");
  const info = await lstat(objectRoot);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (await realpath(objectRoot)) !== objectRoot ||
    (await gitPathExists(path.join(objectRoot, "info/alternates")))
  ) {
    throw new Error("Git branch checkout object directory is unsupported");
  }
  return objectRoot;
}

function remainingTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Git branch switch timed out");
  return remaining;
}
