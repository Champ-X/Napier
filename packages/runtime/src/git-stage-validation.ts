import { normalizeGitPath, type GitRepositoryState } from "./git-repository.js";
import { normalizeGitStageHunkIndexes } from "./git-stage-hunk-patch.js";
import { MAX_GIT_STAGE_TIMEOUT_MS } from "./git-stage-model.js";

export function validateGitStageRequest(request: {
  path: string;
  contextLines?: number;
  hunkIndexes?: number[];
  timeoutMs?: number;
}): {
  path: string;
  hunkIndexes?: number[];
} {
  if (
    request.contextLines !== undefined &&
    (!Number.isSafeInteger(request.contextLines) ||
      request.contextLines < 0 ||
      request.contextLines > 10)
  ) {
    throw new Error("Git stage context is invalid");
  }
  if (request.timeoutMs !== undefined) {
    validateGitStageTimeout(request.timeoutMs);
  }
  const hunkIndexes = normalizeGitStageHunkIndexes(request.hunkIndexes);
  return {
    path: normalizeGitPath(request.path),
    ...(hunkIndexes ? { hunkIndexes } : {}),
  };
}

export function validateGitStageApply(
  previewId: string,
  timeoutMs: number,
): void {
  if (!/^gitstagepreview_[a-z0-9]{8,80}$/u.test(previewId)) {
    throw new Error("Git stage preview ID is invalid");
  }
  validateGitStageTimeout(timeoutMs);
}

export function requireGitStageIndex(state: GitRepositoryState): void {
  if (!state.index.present) {
    throw new Error("Git stage requires an existing repository index");
  }
}

export function remainingGitStageTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Git stage operation timed out");
  return remaining;
}

export function abortGitStage(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Git stage operation was aborted");
}

function validateGitStageTimeout(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 1_000 ||
    value > MAX_GIT_STAGE_TIMEOUT_MS
  ) {
    throw new Error("Git stage timeout is invalid");
  }
}
