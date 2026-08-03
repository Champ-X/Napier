import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import { gitPathSetSha256, normalizeGitPathSet } from "./git-path-set.js";
import {
  snapshotGitRepository,
  type GitRepository,
  type GitRepositoryState,
} from "./git-repository.js";
import {
  assertGitStagePathAncestors,
  MAX_GIT_STAGE_TOTAL_BYTES,
  type GitStagePathState,
  snapshotGitAttributeState,
  snapshotGitStagePath,
} from "./git-stage-model.js";

export interface GitStageTarget {
  path: string;
  absolutePath: string;
  pathState: GitStagePathState;
  attributesStateSha256: string;
}

export async function snapshotGitStageTargets(
  repository: GitRepository,
  targetPaths: readonly string[],
): Promise<GitStageTarget[]> {
  const targets: GitStageTarget[] = [];
  let totalBytes = 0;
  for (const targetPath of targetPaths) {
    await assertGitStagePathAncestors(repository, targetPath);
    const absolutePath = path.join(repository.root, targetPath);
    const [pathState, attributesStateSha256] = await Promise.all([
      snapshotGitStagePath(absolutePath),
      snapshotGitAttributeState(repository, targetPath),
    ]);
    totalBytes += pathState.bytes;
    if (totalBytes > MAX_GIT_STAGE_TOTAL_BYTES) {
      throw new Error("Git stage target set exceeds its bounded byte limit");
    }
    targets.push({
      path: targetPath,
      absolutePath,
      pathState,
      attributesStateSha256,
    });
  }
  return targets;
}

export async function assertGitStageTargetsState(
  repository: GitRepository,
  expectedRepository: GitRepositoryState,
  expectedTargets: readonly GitStageTarget[],
  allowIndexLock = false,
): Promise<void> {
  const [currentRepository, currentTargets] = await Promise.all([
    snapshotGitRepository(repository, { allowIndexLock }),
    snapshotGitStageTargets(
      repository,
      expectedTargets.map((target) => target.path),
    ),
  ]);
  if (
    currentRepository.stateSha256 !== expectedRepository.stateSha256 ||
    !sameGitStageTargets(currentTargets, expectedTargets)
  ) {
    throw new Error("Git stage preview is stale; preview the target again");
  }
}

export async function verifyGitStageTargetsApplied(input: {
  repository: GitRepository;
  expectedRepository: GitRepositoryState;
  expectedTargets: readonly GitStageTarget[];
  expectedIndexSha256: string;
}): Promise<boolean> {
  const [currentRepository, currentTargets] = await Promise.all([
    snapshotGitRepository(input.repository),
    snapshotGitStageTargets(
      input.repository,
      input.expectedTargets.map((target) => target.path),
    ),
  ]);
  return (
    currentRepository.nonIndexStateSha256 ===
      input.expectedRepository.nonIndexStateSha256 &&
    currentRepository.index.sha256 === input.expectedIndexSha256 &&
    sameGitStageTargets(currentTargets, input.expectedTargets)
  );
}

export function gitStageTargetPathsSha256(
  targets: readonly GitStageTarget[],
): string {
  return gitPathSetSha256(targets.map((target) => target.path));
}

export function gitStageTargetStatesSha256(
  targets: readonly GitStageTarget[],
): string {
  return targets.length === 1
    ? targets[0]!.pathState.stateSha256
    : sha256(
        canonicalJson(
          targets.map((target) => ({
            pathSha256: sha256(target.path),
            stateSha256: target.pathState.stateSha256,
          })),
        ),
      );
}

export function gitStageTargetAttributesSha256(
  targets: readonly GitStageTarget[],
): string {
  return targets.length === 1
    ? targets[0]!.attributesStateSha256
    : sha256(
        canonicalJson(
          targets.map((target) => ({
            pathSha256: sha256(target.path),
            attributesStateSha256: target.attributesStateSha256,
          })),
        ),
      );
}

export function normalizeGitStageTargetPaths(
  values: readonly string[],
): string[] {
  try {
    return normalizeGitPathSet(values);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Git target paths collide"
    ) {
      throw new Error("Git stage target paths collide");
    }
    throw error;
  }
}

function sameGitStageTargets(
  left: readonly GitStageTarget[],
  right: readonly GitStageTarget[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (target, index) =>
        target.path === right[index]?.path &&
        target.pathState.stateSha256 === right[index]?.pathState.stateSha256 &&
        target.attributesStateSha256 === right[index]?.attributesStateSha256,
    )
  );
}
