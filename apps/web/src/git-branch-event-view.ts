export interface GitBranchToolEventTraceView {
  gitBranchOperation?: "create";
  gitBranchAction?: "preview" | "apply";
  gitBranchStatus?: "ready" | "applied" | "indeterminate";
  gitBranchPostcondition?: "not_applied" | "verified" | "indeterminate";
  gitBranchNameBytes?: number;
  gitBranchDurationMs?: number;
  gitBranchDurable?: boolean;
  gitBranchCancellationObserved?: boolean;
  gitBranchRefUpdateStatus?:
    | "succeeded"
    | "failed"
    | "timed_out"
    | "output_capped"
    | "unknown";
  gitBranchRefSha256?: string;
  gitBranchTargetCommitSha1?: string;
  gitBranchBeforeRepositoryStateSha256?: string;
  gitBranchAfterRepositoryStateSha256?: string;
  gitBranchSourcePreviewResultSha256?: string;
  gitBranchErrorSha256?: string;
  gitBranchRuntimeEvidenceSha256?: string;
  gitBranchResultSha256?: string;
}

export function gitBranchEventEvidence(
  value: unknown,
): GitBranchToolEventTraceView | undefined {
  if (!record(value)) return undefined;
  const action = branchAction(value["action"]);
  const status = branchStatus(value["status"]);
  const postcondition = branchPostcondition(value["postcondition"]);
  const nameBytes = integer(value["branchNameBytes"], 1, 200);
  const duration = integer(value["durationMs"], 0, 61_000);
  const refUpdateStatus = refStatus(value["refUpdateStatus"]);
  const requiredDigests = [
    value["branchRefSha256"],
    value["beforeRepositoryStateSha256"],
    value["runtimeEvidenceSha256"],
    value["resultSha256"],
  ];
  if (
    value["kind"] !== "napier.git-branch" ||
    value["schemaVersion"] !== 1 ||
    value["operation"] !== "create" ||
    !validShape(value, action, status, postcondition, refUpdateStatus) ||
    nameBytes === undefined ||
    duration === undefined ||
    typeof value["durable"] !== "boolean" ||
    typeof value["cancellationObserved"] !== "boolean" ||
    !sha1(value["targetCommitSha1"]) ||
    !requiredDigests.every(sha256) ||
    !optionalSha256(value["afterRepositoryStateSha256"]) ||
    !optionalSha256(value["sourcePreviewResultSha256"]) ||
    !optionalSha256(value["errorSha256"])
  ) {
    return undefined;
  }
  const digests = requiredDigests as string[];
  return {
    gitBranchOperation: "create",
    gitBranchAction: action!,
    gitBranchStatus: status!,
    gitBranchPostcondition: postcondition!,
    gitBranchNameBytes: nameBytes,
    gitBranchDurationMs: duration,
    gitBranchDurable: value["durable"],
    gitBranchCancellationObserved: value["cancellationObserved"],
    ...(refUpdateStatus ? { gitBranchRefUpdateStatus: refUpdateStatus } : {}),
    gitBranchRefSha256: digests[0]!,
    gitBranchBeforeRepositoryStateSha256: digests[1]!,
    gitBranchRuntimeEvidenceSha256: digests[2]!,
    gitBranchResultSha256: digests[3]!,
    gitBranchTargetCommitSha1: value["targetCommitSha1"],
    ...(typeof value["afterRepositoryStateSha256"] === "string"
      ? {
          gitBranchAfterRepositoryStateSha256:
            value["afterRepositoryStateSha256"],
        }
      : {}),
    ...(typeof value["sourcePreviewResultSha256"] === "string"
      ? {
          gitBranchSourcePreviewResultSha256:
            value["sourcePreviewResultSha256"],
        }
      : {}),
    ...(typeof value["errorSha256"] === "string"
      ? { gitBranchErrorSha256: value["errorSha256"] }
      : {}),
  };
}

export function gitBranchSummaryParts(
  view: GitBranchToolEventTraceView,
): string[] {
  return [
    ...(view.gitBranchAction
      ? [`git branch create ${view.gitBranchAction}`]
      : []),
    ...(view.gitBranchStatus ? [`branch ${view.gitBranchStatus}`] : []),
    ...(view.gitBranchPostcondition
      ? [`postcondition ${view.gitBranchPostcondition}`]
      : []),
    ...(view.gitBranchRefUpdateStatus
      ? [`ref ${view.gitBranchRefUpdateStatus}`]
      : []),
    ...(view.gitBranchTargetCommitSha1
      ? [`target ${view.gitBranchTargetCommitSha1.slice(0, 12)}`]
      : []),
    ...hash("branch-result", view.gitBranchResultSha256),
  ];
}

function validShape(
  value: Record<string, unknown>,
  action: "preview" | "apply" | undefined,
  status: "ready" | "applied" | "indeterminate" | undefined,
  postcondition: "not_applied" | "verified" | "indeterminate" | undefined,
  update: GitBranchToolEventTraceView["gitBranchRefUpdateStatus"],
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

function validPreviewCapability(value: Record<string, unknown>): boolean {
  return (
    typeof value["previewId"] === "string" &&
    /^gitbranchpreview_[a-z0-9]{8,80}$/u.test(value["previewId"]) &&
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

function branchAction(value: unknown) {
  return value === "preview" || value === "apply" ? value : undefined;
}

function branchStatus(value: unknown) {
  return value === "ready" || value === "applied" || value === "indeterminate"
    ? value
    : undefined;
}

function branchPostcondition(value: unknown) {
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

function hash(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
