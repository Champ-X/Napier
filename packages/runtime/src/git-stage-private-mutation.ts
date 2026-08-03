import { gitStageAddArguments } from "./git-inspect-arguments.js";
import {
  gitStageApplyPatchArguments,
  gitStageWorkingDiffArguments,
} from "./git-stage-hunk-arguments.js";
import {
  gitStagePathSelectionSha256,
  selectGitStageHunks,
} from "./git-stage-hunk-patch.js";
import {
  MAX_GIT_PROCESS_OUTPUT_CHARS,
  runGitProcess,
  type GitInspectProcessOptions,
  type GitInspectProcessResult,
  type GitProcessIsolation,
} from "./git-inspect-process.js";
import type { GitRepository } from "./git-repository.js";

export interface GitPrivateStageMutation {
  processes: GitInspectProcessResult[];
  selectionMode: "path" | "hunks";
  selectedHunkCount: number;
  hunkSelectionSha256: string;
}

export async function preparePrivateStageMutation(input: {
  processOptions: GitInspectProcessOptions;
  repository: GitRepository;
  targetPaths: readonly string[];
  contextLines: number;
  hunkIndexes?: number[];
  deadline: number;
  signal?: AbortSignal;
  isolation: GitProcessIsolation;
}): Promise<GitPrivateStageMutation> {
  if (input.hunkIndexes) return prepareSelectedHunks(input);
  const processes: GitInspectProcessResult[] = [];
  for (const targetPath of input.targetPaths) {
    const add = await runGitProcess(
      input.processOptions,
      gitStageAddArguments(input.repository, targetPath),
      remainingTime(input.deadline),
      input.signal,
      input.isolation,
    );
    assertEmptySuccessfulProcess(add, "Git stage preparation failed");
    processes.push(add);
  }
  return {
    processes,
    selectionMode: "path",
    selectedHunkCount: 0,
    hunkSelectionSha256: gitStagePathSelectionSha256(),
  };
}

async function prepareSelectedHunks(
  input: Parameters<typeof preparePrivateStageMutation>[0],
): Promise<GitPrivateStageMutation> {
  const targetPath = input.targetPaths[0]!;
  const working = await runGitProcess(
    input.processOptions,
    gitStageWorkingDiffArguments(
      input.repository,
      targetPath,
      input.contextLines,
    ),
    remainingTime(input.deadline),
    input.signal,
    input.isolation,
  );
  if (
    working.status !== "succeeded" ||
    working.stderr.length > 0 ||
    working.stdout.length === 0 ||
    Buffer.byteLength(working.stdout, "utf8") > MAX_GIT_PROCESS_OUTPUT_CHARS
  ) {
    throw new Error("Git stage working patch is unavailable");
  }
  const selection = selectGitStageHunks(working.stdout, input.hunkIndexes!);
  const apply = await runGitProcess(
    input.processOptions,
    gitStageApplyPatchArguments(input.repository),
    remainingTime(input.deadline),
    input.signal,
    {
      ...input.isolation,
      stdin: selection.selectedPatch,
    },
  );
  assertEmptySuccessfulProcess(apply, "Git selected hunk application failed");
  return {
    processes: [working, apply],
    selectionMode: "hunks",
    selectedHunkCount: selection.selectedHunkCount,
    hunkSelectionSha256: selection.selectionSha256,
  };
}

function assertEmptySuccessfulProcess(
  result: GitInspectProcessResult,
  message: string,
): void {
  if (
    result.status !== "succeeded" ||
    result.stdout.length > 0 ||
    result.stderr.length > 0
  ) {
    throw new Error(message);
  }
}

function remainingTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Git stage operation timed out");
  return remaining;
}
