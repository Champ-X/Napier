import { canonicalJson, sha256 } from "./ed25519.js";
import { normalizeGitPath } from "./git-repository.js";
import type { GitDiffCounts } from "./git-stage-model.js";

export const MAX_GIT_BRANCH_CHECKOUT_FILES = 32;
export const MAX_GIT_BRANCH_CHECKOUT_FILE_BYTES = 64 * 1024;
export const MAX_GIT_BRANCH_CHECKOUT_TOTAL_BYTES = 512 * 1024;
export const MAX_GIT_BRANCH_CHECKOUT_PATCH_BYTES = 128 * 1024;
export const GIT_BRANCH_CHECKOUT_CONTEXT_LINES = 3;
export const GIT_BRANCH_CHECKOUT_UNSUPPORTED_CONFIG_KEYS = [
  "core.autocrlf",
  "core.eol",
  "core.safecrlf",
] as const;

const SHA1 = /^[a-f0-9]{40}$/u;
const ZERO_SHA1 = "0".repeat(40);
const REGULAR_MODES = new Set([0o100644, 0o100755]);

export interface GitBranchCheckoutRawEntry {
  path: string;
  pathSha256: string;
  status: "A" | "M" | "D";
  sourceGitMode: number;
  targetGitMode: number;
  sourceBlobSha1: string;
  targetBlobSha1: string;
}

export interface GitBranchCheckoutFile {
  path: string;
  pathSha256: string;
  sourceGitMode: number;
  targetGitMode: number;
  sourceBlobSha1: string;
  targetBlobSha1: string;
  beforeSha256: string | null;
  expectedSha256: string | null;
  beforeMode: number | null;
  expectedMode: number | null;
  beforeBytes: number;
  expectedBytes: number;
}

export interface GitBranchCheckoutPlan {
  sourceCommitSha1: string;
  targetCommitSha1: string;
  sourceTreeSha1: string;
  targetTreeSha1: string;
  sourceIndexSha256: string;
  targetIndexSha256: string;
  files: GitBranchCheckoutFile[];
  counts: GitDiffCounts;
  patchSha256: string;
  patchBytes: number;
  worktreeTransitionSha256: string;
  planSha256: string;
}

export interface PreparedGitBranchCheckoutFile extends GitBranchCheckoutFile {
  targetContent?: Buffer;
}

export interface PreparedGitBranchCheckout {
  plan: GitBranchCheckoutPlan;
  files: PreparedGitBranchCheckoutFile[];
  patch: string;
  sourceIndexBytes: Buffer;
  targetIndexBytes: Buffer;
  temporaryDirectory: string;
}

export const GIT_BRANCH_CHECKOUT_LIMITS_SHA256 = sha256(
  canonicalJson({
    schemaVersion: 1,
    maximumFiles: MAX_GIT_BRANCH_CHECKOUT_FILES,
    maximumFileBytes: MAX_GIT_BRANCH_CHECKOUT_FILE_BYTES,
    maximumTotalBytes: MAX_GIT_BRANCH_CHECKOUT_TOTAL_BYTES,
    maximumPatchBytes: MAX_GIT_BRANCH_CHECKOUT_PATCH_BYTES,
    acceptedGitModes: [...REGULAR_MODES],
    acceptedStatuses: ["A", "M", "D"],
    textEncoding: "complete_utf8_without_nul",
    existingCanonicalParentsOnly: true,
    attributes: "all_worktree_and_info_attribute_files_absent",
    unsupportedConfigKeys: GIT_BRANCH_CHECKOUT_UNSUPPORTED_CONFIG_KEYS,
    cleanRepositoryRequired: true,
  }),
);

export function parseGitBranchCheckoutRaw(
  output: string,
): GitBranchCheckoutRawEntry[] {
  if (!output || Buffer.byteLength(output, "utf8") > 64 * 1024) {
    throw new Error("Git branch checkout raw delta is unavailable");
  }
  const fields = output.split("\u0000");
  if (fields.at(-1) === "") fields.pop();
  if (
    fields.length < 2 ||
    fields.length % 2 !== 0 ||
    fields.length / 2 > MAX_GIT_BRANCH_CHECKOUT_FILES
  ) {
    throw new Error("Git branch checkout raw delta is invalid");
  }
  const entries: GitBranchCheckoutRawEntry[] = [];
  const pathIdentities = new Set<string>();
  for (let index = 0; index < fields.length; index += 2) {
    const header = fields[index] ?? "";
    const rawPath = fields[index + 1] ?? "";
    const match =
      /^:(\d{6}) (\d{6}) ([a-f0-9]{40}) ([a-f0-9]{40}) ([AMD])$/u.exec(header);
    if (!match) throw new Error("Git branch checkout raw entry is invalid");
    let path: string;
    try {
      path = normalizeGitPath(rawPath);
    } catch {
      throw new Error("Git branch checkout path is invalid");
    }
    const identity = checkoutPathIdentity(path);
    if (pathIdentities.has(identity)) {
      throw new Error("Git branch checkout paths collide");
    }
    pathIdentities.add(identity);
    const sourceGitMode = Number.parseInt(match[1]!, 8);
    const targetGitMode = Number.parseInt(match[2]!, 8);
    const sourceBlobSha1 = match[3]!;
    const targetBlobSha1 = match[4]!;
    const status = match[5]! as GitBranchCheckoutRawEntry["status"];
    assertRawTransition({
      status,
      sourceGitMode,
      targetGitMode,
      sourceBlobSha1,
      targetBlobSha1,
    });
    entries.push({
      path,
      pathSha256: sha256(path),
      status,
      sourceGitMode,
      targetGitMode,
      sourceBlobSha1,
      targetBlobSha1,
    });
  }
  return entries.sort((left, right) =>
    compareGitBranchCheckoutPaths(left.path, right.path),
  );
}

export function createGitBranchCheckoutPlan(input: {
  sourceCommitSha1: string;
  targetCommitSha1: string;
  sourceTreeSha1: string;
  targetTreeSha1: string;
  sourceIndexSha256: string;
  targetIndexSha256: string;
  files: GitBranchCheckoutFile[];
  counts: GitDiffCounts;
  patch: string;
}): GitBranchCheckoutPlan {
  for (const value of [
    input.sourceCommitSha1,
    input.targetCommitSha1,
    input.sourceTreeSha1,
    input.targetTreeSha1,
  ]) {
    if (!SHA1.test(value))
      throw new Error("Git branch checkout plan is invalid");
  }
  if (
    input.sourceCommitSha1 === input.targetCommitSha1 ||
    input.sourceTreeSha1 === input.targetTreeSha1 ||
    input.files.length < 1 ||
    input.files.length > MAX_GIT_BRANCH_CHECKOUT_FILES ||
    input.counts.fileCount !== input.files.length
  ) {
    throw new Error("Git branch checkout plan is invalid");
  }
  const patchBytes = Buffer.byteLength(input.patch, "utf8");
  if (patchBytes < 1 || patchBytes > MAX_GIT_BRANCH_CHECKOUT_PATCH_BYTES) {
    throw new Error("Git branch checkout patch exceeds its bounded limit");
  }
  const worktreeTransitionSha256 = sha256(
    canonicalJson(
      input.files.map((file) => ({
        pathSha256: file.pathSha256,
        beforeSha256: file.beforeSha256,
        expectedSha256: file.expectedSha256,
        beforeMode: file.beforeMode,
        expectedMode: file.expectedMode,
      })),
    ),
  );
  const content = {
    sourceCommitSha1: input.sourceCommitSha1,
    targetCommitSha1: input.targetCommitSha1,
    sourceTreeSha1: input.sourceTreeSha1,
    targetTreeSha1: input.targetTreeSha1,
    sourceIndexSha256: input.sourceIndexSha256,
    targetIndexSha256: input.targetIndexSha256,
    files: input.files,
    counts: input.counts,
    patchSha256: sha256(input.patch),
    patchBytes,
    worktreeTransitionSha256,
  };
  return { ...content, planSha256: sha256(canonicalJson(content)) };
}

export function assertGitBranchCheckoutPlan(plan: GitBranchCheckoutPlan): void {
  assertPlanIdentity(plan);
  assertPlanBounds(plan);
  assertPlanFiles(plan);
  assertPlanHash(plan);
}

function assertPlanIdentity(plan: GitBranchCheckoutPlan): void {
  if (
    !SHA1.test(plan.sourceCommitSha1) ||
    !SHA1.test(plan.targetCommitSha1) ||
    plan.sourceCommitSha1 === plan.targetCommitSha1 ||
    !SHA1.test(plan.sourceTreeSha1) ||
    !SHA1.test(plan.targetTreeSha1) ||
    plan.sourceTreeSha1 === plan.targetTreeSha1 ||
    !digest(plan.sourceIndexSha256) ||
    !digest(plan.targetIndexSha256) ||
    !digest(plan.patchSha256) ||
    !digest(plan.worktreeTransitionSha256) ||
    !digest(plan.planSha256)
  ) {
    throw new Error("Git branch checkout plan is invalid");
  }
}

function assertPlanBounds(plan: GitBranchCheckoutPlan): void {
  if (
    !Array.isArray(plan.files) ||
    plan.files.length < 1 ||
    plan.files.length > MAX_GIT_BRANCH_CHECKOUT_FILES ||
    plan.counts.fileCount !== plan.files.length ||
    !countsValid(plan.counts) ||
    !Number.isSafeInteger(plan.patchBytes) ||
    plan.patchBytes < 1 ||
    plan.patchBytes > MAX_GIT_BRANCH_CHECKOUT_PATCH_BYTES
  ) {
    throw new Error("Git branch checkout plan is invalid");
  }
}

function assertPlanFiles(plan: GitBranchCheckoutPlan): void {
  let previousPath: string | undefined;
  let totalBytes = 0;
  for (const file of plan.files) {
    assertPlanFile(file, previousPath);
    previousPath = file.path;
    totalBytes += file.beforeBytes + file.expectedBytes;
  }
  if (totalBytes > MAX_GIT_BRANCH_CHECKOUT_TOTAL_BYTES) {
    throw new Error("Git branch checkout plan file set is too large");
  }
}

function assertPlanFile(
  file: GitBranchCheckoutFile,
  previousPath: string | undefined,
): void {
  const beforePresent = file.beforeSha256 !== null;
  const expectedPresent = file.expectedSha256 !== null;
  if (
    planFilePathInvalid(file, previousPath) ||
    planFileContentInvalid(file, beforePresent, expectedPresent) ||
    planFileGitStateInvalid(file, beforePresent, expectedPresent) ||
    planFileOutputInvalid(file, beforePresent, expectedPresent)
  ) {
    throw new Error("Git branch checkout plan file is invalid");
  }
}

function planFilePathInvalid(
  file: GitBranchCheckoutFile,
  previousPath: string | undefined,
): boolean {
  return (
    normalizeGitPath(file.path) !== file.path ||
    sha256(file.path) !== file.pathSha256 ||
    (previousPath !== undefined &&
      compareGitBranchCheckoutPaths(previousPath, file.path) >= 0)
  );
}

function planFileContentInvalid(
  file: GitBranchCheckoutFile,
  beforePresent: boolean,
  expectedPresent: boolean,
): boolean {
  return (
    (beforePresent && !digest(file.beforeSha256)) ||
    (expectedPresent && !digest(file.expectedSha256)) ||
    beforePresent !== (file.beforeMode !== null) ||
    expectedPresent !== (file.expectedMode !== null)
  );
}

function planFileGitStateInvalid(
  file: GitBranchCheckoutFile,
  beforePresent: boolean,
  expectedPresent: boolean,
): boolean {
  return (
    !gitModeValid(file.sourceGitMode, beforePresent) ||
    !gitModeValid(file.targetGitMode, expectedPresent) ||
    !gitObjectValid(file.sourceBlobSha1, beforePresent) ||
    !gitObjectValid(file.targetBlobSha1, expectedPresent)
  );
}

function planFileOutputInvalid(
  file: GitBranchCheckoutFile,
  beforePresent: boolean,
  expectedPresent: boolean,
): boolean {
  return (
    !modeValid(file.beforeMode) ||
    !modeValid(file.expectedMode) ||
    !Number.isSafeInteger(file.beforeBytes) ||
    file.beforeBytes < 0 ||
    file.beforeBytes > MAX_GIT_BRANCH_CHECKOUT_FILE_BYTES ||
    !Number.isSafeInteger(file.expectedBytes) ||
    file.expectedBytes < 0 ||
    file.expectedBytes > MAX_GIT_BRANCH_CHECKOUT_FILE_BYTES ||
    (!beforePresent && file.beforeBytes !== 0) ||
    (!expectedPresent && file.expectedBytes !== 0) ||
    (file.beforeSha256 === file.expectedSha256 &&
      file.beforeMode === file.expectedMode)
  );
}

function assertPlanHash(plan: GitBranchCheckoutPlan): void {
  const transition = sha256(
    canonicalJson(
      plan.files.map((file) => ({
        pathSha256: file.pathSha256,
        beforeSha256: file.beforeSha256,
        expectedSha256: file.expectedSha256,
        beforeMode: file.beforeMode,
        expectedMode: file.expectedMode,
      })),
    ),
  );
  const { planSha256, ...content } = plan;
  if (
    transition !== plan.worktreeTransitionSha256 ||
    sha256(canonicalJson(content)) !== planSha256
  ) {
    throw new Error("Git branch checkout plan hash mismatch");
  }
}

export function gitBranchCheckoutExpectedMode(
  sourceMode: number | null,
  targetGitMode: number,
): number | null {
  if (targetGitMode === 0) return null;
  const base = sourceMode ?? 0o644;
  return targetGitMode === 0o100755 ? base | 0o111 : base & ~0o111;
}

function countsValid(counts: GitDiffCounts): boolean {
  return Object.values(counts).every(
    (value) => Number.isSafeInteger(value) && value >= 0,
  );
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function modeValid(value: number | null): boolean {
  return (
    value === null ||
    (Number.isSafeInteger(value) && value >= 0 && value <= 0o777)
  );
}

function gitModeValid(value: number, present: boolean): boolean {
  return present ? REGULAR_MODES.has(value) : value === 0;
}

function gitObjectValid(value: string, present: boolean): boolean {
  return present ? SHA1.test(value) : value === ZERO_SHA1;
}

function checkoutPathIdentity(value: string): string {
  const normalized = value.normalize("NFC");
  return process.platform === "darwin" || process.platform === "win32"
    ? normalized.toLowerCase()
    : normalized;
}

function compareGitBranchCheckoutPaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertRawTransition(input: {
  status: "A" | "M" | "D";
  sourceGitMode: number;
  targetGitMode: number;
  sourceBlobSha1: string;
  targetBlobSha1: string;
}): void {
  const sourceRegular = REGULAR_MODES.has(input.sourceGitMode);
  const targetRegular = REGULAR_MODES.has(input.targetGitMode);
  const valid =
    (input.status === "A" &&
      input.sourceGitMode === 0 &&
      input.sourceBlobSha1 === ZERO_SHA1 &&
      targetRegular &&
      SHA1.test(input.targetBlobSha1)) ||
    (input.status === "D" &&
      sourceRegular &&
      SHA1.test(input.sourceBlobSha1) &&
      input.targetGitMode === 0 &&
      input.targetBlobSha1 === ZERO_SHA1) ||
    (input.status === "M" &&
      sourceRegular &&
      targetRegular &&
      SHA1.test(input.sourceBlobSha1) &&
      SHA1.test(input.targetBlobSha1) &&
      (input.sourceBlobSha1 !== input.targetBlobSha1 ||
        input.sourceGitMode !== input.targetGitMode));
  if (!valid) throw new Error("Git branch checkout transition is unsupported");
}
