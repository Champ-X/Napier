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
  gitBranchSwitchCommitSha1?: string;
  gitBranchSwitchBeforeRepositoryStateSha256?: string;
  gitBranchSwitchBeforeHeadReflogStateSha256?: string;
  gitBranchSwitchAfterRepositoryStateSha256?: string;
  gitBranchSwitchAfterHeadReflogStateSha256?: string;
  gitBranchSwitchSourcePreviewResultSha256?: string;
  gitBranchSwitchErrorSha256?: string;
  gitBranchSwitchRuntimeEvidenceSha256?: string;
  gitBranchSwitchResultSha256?: string;
}

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
    ...hash("switch-result", view.gitBranchSwitchResultSha256),
  ];
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
