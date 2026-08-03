export interface GitBranchSwitchToolEventTraceView {
  gitBranchSwitchAction?: "preview" | "apply";
  gitBranchSwitchStatus?: "ready" | "applied" | "indeterminate";
  gitBranchSwitchPostcondition?: "not_applied" | "verified" | "indeterminate";
  gitBranchSwitchTargetNameBytes?: number;
  gitBranchSwitchDurationMs?: number;
  gitBranchSwitchDurable?: boolean;
  gitBranchSwitchCancellationObserved?: boolean;
  gitBranchSwitchProcessStatus?:
    | "succeeded"
    | "failed"
    | "timed_out"
    | "output_capped"
    | "unknown";
  gitBranchSwitchTargetRefSha256?: string;
  gitBranchSwitchSourceCommitSha1?: string;
  gitBranchSwitchCommitSha1?: string;
  gitBranchSwitchCheckoutRequired?: boolean;
  gitBranchSwitchFileCount?: number;
  gitBranchSwitchRecoveryAction?: "none" | "rolled_back" | "completed";
  gitBranchSwitchAddedLineCount?: number;
  gitBranchSwitchDeletedLineCount?: number;
  gitBranchSwitchPatchBytes?: number;
  gitBranchSwitchPatchSha256?: string;
  gitBranchSwitchWorktreeTransitionSha256?: string;
  gitBranchSwitchProposedIndexSha256?: string;
  gitBranchSwitchBeforeRepositoryStateSha256?: string;
  gitBranchSwitchBeforeHeadReflogStateSha256?: string;
  gitBranchSwitchAfterRepositoryStateSha256?: string;
  gitBranchSwitchAfterHeadReflogStateSha256?: string;
  gitBranchSwitchSourcePreviewResultSha256?: string;
  gitBranchSwitchErrorSha256?: string;
  gitBranchSwitchRuntimeEvidenceSha256?: string;
  gitBranchSwitchResultSha256?: string;
}

const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const EMPTY_LIST_SHA256 =
  "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";

export function gitBranchSwitchEventEvidence(
  value: unknown,
): GitBranchSwitchToolEventTraceView | undefined {
  if (!record(value)) return undefined;
  const action = switchAction(value["action"]);
  const status = switchStatus(value["status"]);
  const postcondition = switchPostcondition(value["postcondition"]);
  const nameBytes = integer(value["targetBranchNameBytes"], 1, 200);
  const duration = integer(value["durationMs"], 0, 300_000);
  const processStatus = processResult(value["switchStatus"]);
  const checkout = checkoutEvidence(value);
  const requiredDigests = [
    value["targetRefSha256"],
    value["beforeRepositoryStateSha256"],
    value["beforeHeadReflogStateSha256"],
    value["runtimeEvidenceSha256"],
    value["resultSha256"],
  ];
  if (
    value["kind"] !== "napier.git-branch-switch" ||
    value["schemaVersion"] !== 1 ||
    !validShape(value, action, status, postcondition, processStatus) ||
    nameBytes === undefined ||
    duration === undefined ||
    typeof value["durable"] !== "boolean" ||
    typeof value["cancellationObserved"] !== "boolean" ||
    !sha1(value["commitSha1"]) ||
    checkout === null ||
    !requiredDigests.every(sha256) ||
    !optionalSha256(value["afterRepositoryStateSha256"]) ||
    !optionalSha256(value["afterHeadReflogStateSha256"]) ||
    !optionalSha256(value["sourcePreviewResultSha256"]) ||
    !optionalSha256(value["errorSha256"])
  ) {
    return undefined;
  }
  const digests = requiredDigests as string[];
  return {
    gitBranchSwitchAction: action!,
    gitBranchSwitchStatus: status!,
    gitBranchSwitchPostcondition: postcondition!,
    gitBranchSwitchTargetNameBytes: nameBytes,
    gitBranchSwitchDurationMs: duration,
    gitBranchSwitchDurable: value["durable"],
    gitBranchSwitchCancellationObserved: value["cancellationObserved"],
    ...(processStatus ? { gitBranchSwitchProcessStatus: processStatus } : {}),
    gitBranchSwitchTargetRefSha256: digests[0]!,
    gitBranchSwitchBeforeRepositoryStateSha256: digests[1]!,
    gitBranchSwitchBeforeHeadReflogStateSha256: digests[2]!,
    gitBranchSwitchRuntimeEvidenceSha256: digests[3]!,
    gitBranchSwitchResultSha256: digests[4]!,
    gitBranchSwitchCommitSha1: value["commitSha1"],
    ...(checkout
      ? {
          gitBranchSwitchSourceCommitSha1: checkout.sourceCommitSha1,
          gitBranchSwitchCheckoutRequired: checkout.checkoutRequired,
          gitBranchSwitchFileCount: checkout.fileCount,
          gitBranchSwitchRecoveryAction: checkout.recoveryAction,
          gitBranchSwitchAddedLineCount: checkout.addedLineCount,
          gitBranchSwitchDeletedLineCount: checkout.deletedLineCount,
          gitBranchSwitchPatchBytes: checkout.patchBytes,
          gitBranchSwitchPatchSha256: checkout.patchSha256,
          gitBranchSwitchWorktreeTransitionSha256:
            checkout.worktreeTransitionSha256,
          gitBranchSwitchProposedIndexSha256: checkout.proposedIndexSha256,
        }
      : {}),
    ...(typeof value["afterRepositoryStateSha256"] === "string"
      ? {
          gitBranchSwitchAfterRepositoryStateSha256:
            value["afterRepositoryStateSha256"],
        }
      : {}),
    ...(typeof value["afterHeadReflogStateSha256"] === "string"
      ? {
          gitBranchSwitchAfterHeadReflogStateSha256:
            value["afterHeadReflogStateSha256"],
        }
      : {}),
    ...(typeof value["sourcePreviewResultSha256"] === "string"
      ? {
          gitBranchSwitchSourcePreviewResultSha256:
            value["sourcePreviewResultSha256"],
        }
      : {}),
    ...(typeof value["errorSha256"] === "string"
      ? { gitBranchSwitchErrorSha256: value["errorSha256"] }
      : {}),
  };
}

export function gitBranchSwitchSummaryParts(
  view: GitBranchSwitchToolEventTraceView,
): string[] {
  return [
    ...(view.gitBranchSwitchAction
      ? [`git branch switch ${view.gitBranchSwitchAction}`]
      : []),
    ...(view.gitBranchSwitchStatus
      ? [`switch ${view.gitBranchSwitchStatus}`]
      : []),
    ...(view.gitBranchSwitchPostcondition
      ? [`postcondition ${view.gitBranchSwitchPostcondition}`]
      : []),
    ...(view.gitBranchSwitchProcessStatus
      ? [`process ${view.gitBranchSwitchProcessStatus}`]
      : []),
    ...(view.gitBranchSwitchCommitSha1
      ? [`commit ${view.gitBranchSwitchCommitSha1.slice(0, 12)}`]
      : []),
    ...(view.gitBranchSwitchCheckoutRequired
      ? [`checkout ${view.gitBranchSwitchFileCount ?? 0} files`]
      : []),
    ...(view.gitBranchSwitchRecoveryAction &&
    view.gitBranchSwitchRecoveryAction !== "none"
      ? [`recovery ${view.gitBranchSwitchRecoveryAction}`]
      : []),
    ...hash("switch-result", view.gitBranchSwitchResultSha256),
  ];
}

function checkoutEvidence(value: Record<string, unknown>):
  | {
      sourceCommitSha1: string;
      checkoutRequired: boolean;
      fileCount: number;
      recoveryAction: "none" | "rolled_back" | "completed";
      addedLineCount: number;
      deletedLineCount: number;
      patchBytes: number;
      patchSha256: string;
      worktreeTransitionSha256: string;
      proposedIndexSha256: string;
    }
  | null
  | undefined {
  const fields = [
    "sourceCommitSha1",
    "checkoutRequired",
    "fileCount",
    "recoveryAction",
    "addedLineCount",
    "deletedLineCount",
    "patchBytes",
    "patchSha256",
    "worktreeTransitionSha256",
    "proposedIndexSha256",
  ] as const;
  if (fields.every((field) => value[field] === undefined)) return undefined;
  const sourceCommitSha1 = value["sourceCommitSha1"];
  const checkoutRequired = value["checkoutRequired"];
  const fileCount = integer(value["fileCount"], 0, 32);
  const recoveryAction = checkoutRecoveryAction(value["recoveryAction"]);
  const addedLineCount = integer(value["addedLineCount"], 0, 1_000_000);
  const deletedLineCount = integer(value["deletedLineCount"], 0, 1_000_000);
  const patchBytes = integer(value["patchBytes"], 0, 128 * 1024);
  if (
    !sha1(sourceCommitSha1) ||
    typeof checkoutRequired !== "boolean" ||
    fileCount === undefined ||
    recoveryAction === undefined ||
    addedLineCount === undefined ||
    deletedLineCount === undefined ||
    patchBytes === undefined ||
    !sha256(value["patchSha256"]) ||
    !sha256(value["worktreeTransitionSha256"]) ||
    !sha256(value["proposedIndexSha256"]) ||
    (checkoutRequired
      ? fileCount < 1 ||
        patchBytes < 1 ||
        sourceCommitSha1 === value["commitSha1"]
      : fileCount !== 0 ||
        addedLineCount !== 0 ||
        deletedLineCount !== 0 ||
        patchBytes !== 0 ||
        value["patchSha256"] !== EMPTY_SHA256 ||
        value["worktreeTransitionSha256"] !== EMPTY_LIST_SHA256)
  ) {
    return null;
  }
  return {
    sourceCommitSha1,
    checkoutRequired,
    fileCount,
    recoveryAction,
    addedLineCount,
    deletedLineCount,
    patchBytes,
    patchSha256: value["patchSha256"],
    worktreeTransitionSha256: value["worktreeTransitionSha256"],
    proposedIndexSha256: value["proposedIndexSha256"],
  };
}

function checkoutRecoveryAction(
  value: unknown,
): "none" | "rolled_back" | "completed" | undefined {
  return value === "none" || value === "rolled_back" || value === "completed"
    ? value
    : undefined;
}

function validShape(
  value: Record<string, unknown>,
  action: "preview" | "apply" | undefined,
  status: "ready" | "applied" | "indeterminate" | undefined,
  postcondition: "not_applied" | "verified" | "indeterminate" | undefined,
  processStatus:
    | "succeeded"
    | "failed"
    | "timed_out"
    | "output_capped"
    | "unknown"
    | undefined,
): boolean {
  if (action === "preview") {
    return (
      status === "ready" &&
      postcondition === "not_applied" &&
      value["durable"] === false &&
      validPreviewCapability(value) &&
      processStatus === undefined &&
      value["afterRepositoryStateSha256"] === undefined &&
      value["afterHeadReflogStateSha256"] === undefined &&
      value["sourcePreviewResultSha256"] === undefined
    );
  }
  if (
    action !== "apply" ||
    processStatus === undefined ||
    !sha256(value["sourcePreviewResultSha256"]) ||
    value["previewId"] !== undefined ||
    value["expiresAt"] !== undefined
  ) {
    return false;
  }
  if (status === "applied") {
    return (
      postcondition === "verified" &&
      processStatus === "succeeded" &&
      value["durable"] === true &&
      sha256(value["afterRepositoryStateSha256"]) &&
      sha256(value["afterHeadReflogStateSha256"])
    );
  }
  return (
    status === "indeterminate" &&
    postcondition === "indeterminate" &&
    value["durable"] === false
  );
}

function validPreviewCapability(value: Record<string, unknown>): boolean {
  return (
    typeof value["previewId"] === "string" &&
    /^gitswitchpreview_[a-z0-9]{8,80}$/u.test(value["previewId"]) &&
    typeof value["expiresAt"] === "string" &&
    Number.isFinite(Date.parse(value["expiresAt"]))
  );
}

function integer(value: unknown, minimum: number, maximum: number) {
  return Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
    ? Number(value)
    : undefined;
}

function switchAction(value: unknown) {
  return value === "preview" || value === "apply" ? value : undefined;
}

function switchStatus(value: unknown) {
  return value === "ready" || value === "applied" || value === "indeterminate"
    ? value
    : undefined;
}

function switchPostcondition(value: unknown) {
  return value === "not_applied" ||
    value === "verified" ||
    value === "indeterminate"
    ? value
    : undefined;
}

function processResult(value: unknown) {
  return value === "succeeded" ||
    value === "failed" ||
    value === "timed_out" ||
    value === "output_capped" ||
    value === "unknown"
    ? value
    : undefined;
}

function sha1(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function optionalSha256(value: unknown): boolean {
  return value === undefined || sha256(value);
}

function hash(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
