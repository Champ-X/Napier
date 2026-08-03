export interface GitReviewToolEventTraceView {
  gitReviewAction?: "preview" | "apply";
  gitReviewStatus?: "ready" | "applied" | "indeterminate";
  gitReviewPostcondition?: "not_applied" | "verified" | "indeterminate";
  gitReviewSourceBranchNameBytes?: number;
  gitReviewTargetBranchNameBytes?: number;
  gitReviewCommitCount?: number;
  gitReviewFileCount?: number;
  gitReviewHunkCount?: number;
  gitReviewAddedLineCount?: number;
  gitReviewDeletedLineCount?: number;
  gitReviewPatchBytes?: number;
  gitReviewDurationMs?: number;
  gitReviewDurable?: boolean;
  gitReviewCancellationObserved?: boolean;
  gitReviewRefUpdateStatus?:
    | "succeeded"
    | "failed"
    | "timed_out"
    | "output_capped"
    | "unknown";
  gitReviewSourceCommitSha1?: string;
  gitReviewTargetCommitSha1?: string;
  gitReviewSourceBranchRefSha256?: string;
  gitReviewTargetBranchRefSha256?: string;
  gitReviewPatchSha256?: string;
  gitReviewPlanSha256?: string;
  gitReviewBeforeRepositoryStateSha256?: string;
  gitReviewAfterRepositoryStateSha256?: string;
  gitReviewSourcePreviewResultSha256?: string;
  gitReviewErrorSha256?: string;
  gitReviewRuntimeEvidenceSha256?: string;
  gitReviewResultSha256?: string;
}

export function gitReviewEventEvidence(
  value: unknown,
): GitReviewToolEventTraceView | undefined {
  if (!record(value)) return undefined;
  const action = reviewAction(value["action"]);
  const status = reviewStatus(value["status"]);
  const postcondition = reviewPostcondition(value["postcondition"]);
  const sourceNameBytes = integer(value["sourceBranchNameBytes"], 1, 200);
  const targetNameBytes = integer(value["targetBranchNameBytes"], 1, 200);
  const commitCount = integer(value["commitCount"], 1, 64);
  const fileCount = integer(value["fileCount"], 0, 32);
  const hunkCount = integer(value["hunkCount"], 0, 100_000);
  const addedLineCount = integer(value["addedLineCount"], 0, 1_000_000);
  const deletedLineCount = integer(value["deletedLineCount"], 0, 1_000_000);
  const patchBytes = integer(value["patchBytes"], 0, 128 * 1024);
  const durationMs = integer(value["durationMs"], 0, 61_000);
  const refUpdateStatus = refStatus(value["refUpdateStatus"]);
  const requiredDigests = [
    value["sourceBranchRefSha256"],
    value["targetBranchRefSha256"],
    value["patchSha256"],
    value["reviewPlanSha256"],
    value["beforeRepositoryStateSha256"],
    value["runtimeEvidenceSha256"],
    value["resultSha256"],
  ];
  if (
    value["kind"] !== "napier.git-review" ||
    value["schemaVersion"] !== 1 ||
    !validShape(value, action, status, postcondition, refUpdateStatus) ||
    sourceNameBytes === undefined ||
    targetNameBytes === undefined ||
    commitCount === undefined ||
    fileCount === undefined ||
    hunkCount === undefined ||
    addedLineCount === undefined ||
    deletedLineCount === undefined ||
    patchBytes === undefined ||
    durationMs === undefined ||
    !validPatchShape(
      fileCount,
      hunkCount,
      addedLineCount,
      deletedLineCount,
      patchBytes,
    ) ||
    typeof value["durable"] !== "boolean" ||
    typeof value["cancellationObserved"] !== "boolean" ||
    !validCommitRange(value) ||
    !requiredDigests.every(sha256) ||
    !validOptionalDigests(value)
  ) {
    return undefined;
  }
  const digests = requiredDigests as string[];
  return {
    gitReviewAction: action!,
    gitReviewStatus: status!,
    gitReviewPostcondition: postcondition!,
    gitReviewSourceBranchNameBytes: sourceNameBytes,
    gitReviewTargetBranchNameBytes: targetNameBytes,
    gitReviewCommitCount: commitCount,
    gitReviewFileCount: fileCount,
    gitReviewHunkCount: hunkCount,
    gitReviewAddedLineCount: addedLineCount,
    gitReviewDeletedLineCount: deletedLineCount,
    gitReviewPatchBytes: patchBytes,
    gitReviewDurationMs: durationMs,
    gitReviewDurable: value["durable"],
    gitReviewCancellationObserved: value["cancellationObserved"],
    ...(refUpdateStatus ? { gitReviewRefUpdateStatus: refUpdateStatus } : {}),
    gitReviewSourceCommitSha1: value["sourceCommitSha1"] as string,
    gitReviewTargetCommitSha1: value["targetCommitSha1"] as string,
    gitReviewSourceBranchRefSha256: digests[0]!,
    gitReviewTargetBranchRefSha256: digests[1]!,
    gitReviewPatchSha256: digests[2]!,
    gitReviewPlanSha256: digests[3]!,
    gitReviewBeforeRepositoryStateSha256: digests[4]!,
    gitReviewRuntimeEvidenceSha256: digests[5]!,
    gitReviewResultSha256: digests[6]!,
    ...(typeof value["afterRepositoryStateSha256"] === "string"
      ? {
          gitReviewAfterRepositoryStateSha256:
            value["afterRepositoryStateSha256"],
        }
      : {}),
    ...(typeof value["sourcePreviewResultSha256"] === "string"
      ? {
          gitReviewSourcePreviewResultSha256:
            value["sourcePreviewResultSha256"],
        }
      : {}),
    ...(typeof value["errorSha256"] === "string"
      ? { gitReviewErrorSha256: value["errorSha256"] }
      : {}),
  };
}

export function gitReviewSummaryParts(
  view: GitReviewToolEventTraceView,
): string[] {
  return [
    ...(view.gitReviewAction ? [`git review ${view.gitReviewAction}`] : []),
    ...(view.gitReviewStatus ? [`review ${view.gitReviewStatus}`] : []),
    ...(view.gitReviewPostcondition
      ? [`postcondition ${view.gitReviewPostcondition}`]
      : []),
    ...(view.gitReviewCommitCount !== undefined
      ? [`commits ${view.gitReviewCommitCount}`]
      : []),
    ...(view.gitReviewFileCount !== undefined
      ? [`files ${view.gitReviewFileCount}`]
      : []),
    ...(view.gitReviewRefUpdateStatus
      ? [`ref ${view.gitReviewRefUpdateStatus}`]
      : []),
    ...(view.gitReviewSourceCommitSha1
      ? [`source ${view.gitReviewSourceCommitSha1.slice(0, 12)}`]
      : []),
    ...(view.gitReviewTargetCommitSha1
      ? [`target ${view.gitReviewTargetCommitSha1.slice(0, 12)}`]
      : []),
    ...hash("review-result", view.gitReviewResultSha256),
  ];
}

function validShape(
  value: Record<string, unknown>,
  action: "preview" | "apply" | undefined,
  status: "ready" | "applied" | "indeterminate" | undefined,
  postcondition: "not_applied" | "verified" | "indeterminate" | undefined,
  update: GitReviewToolEventTraceView["gitReviewRefUpdateStatus"],
): boolean {
  if (action === "preview") {
    return (
      status === "ready" &&
      postcondition === "not_applied" &&
      value["durable"] === false &&
      validPreviewCapability(value) &&
      update === undefined &&
      value["afterRepositoryStateSha256"] === undefined &&
      value["sourcePreviewResultSha256"] === undefined
    );
  }
  if (
    action !== "apply" ||
    update === undefined ||
    !sha256(value["sourcePreviewResultSha256"]) ||
    value["previewId"] !== undefined ||
    value["expiresAt"] !== undefined
  ) {
    return false;
  }
  if (status === "applied") {
    return (
      postcondition === "verified" &&
      update === "succeeded" &&
      value["durable"] === true &&
      sha256(value["afterRepositoryStateSha256"])
    );
  }
  return (
    status === "indeterminate" &&
    postcondition === "indeterminate" &&
    value["durable"] === false
  );
}

function validPatchShape(
  fileCount: number,
  hunkCount: number,
  addedLineCount: number,
  deletedLineCount: number,
  patchBytes: number,
): boolean {
  return fileCount === 0
    ? hunkCount === 0 &&
        addedLineCount === 0 &&
        deletedLineCount === 0 &&
        patchBytes > 0
    : patchBytes > 0;
}

function validPreviewCapability(value: Record<string, unknown>): boolean {
  return (
    typeof value["previewId"] === "string" &&
    /^gitreviewpreview_[a-z0-9]{8,80}$/u.test(value["previewId"]) &&
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

function reviewAction(value: unknown) {
  return value === "preview" || value === "apply" ? value : undefined;
}

function reviewStatus(value: unknown) {
  return value === "ready" || value === "applied" || value === "indeterminate"
    ? value
    : undefined;
}

function reviewPostcondition(value: unknown) {
  return value === "not_applied" ||
    value === "verified" ||
    value === "indeterminate"
    ? value
    : undefined;
}

function refStatus(value: unknown) {
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

function validCommitRange(value: Record<string, unknown>): boolean {
  return (
    sha1(value["sourceCommitSha1"]) &&
    sha1(value["targetCommitSha1"]) &&
    value["sourceCommitSha1"] !== value["targetCommitSha1"]
  );
}

function validOptionalDigests(value: Record<string, unknown>): boolean {
  return (
    optionalSha256(value["afterRepositoryStateSha256"]) &&
    optionalSha256(value["sourcePreviewResultSha256"]) &&
    optionalSha256(value["errorSha256"])
  );
}

function hash(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
