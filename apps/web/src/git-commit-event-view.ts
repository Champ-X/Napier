export interface GitCommitToolEventTraceView {
  gitCommitAction?: "preview" | "apply";
  gitCommitStatus?: "ready" | "applied" | "indeterminate";
  gitCommitPostcondition?: "not_applied" | "verified" | "indeterminate";
  gitCommitMessageBytes?: number;
  gitCommitTimestampSeconds?: number;
  gitCommitContextLines?: number;
  gitCommitFileCount?: number;
  gitCommitHunkCount?: number;
  gitCommitAddedLineCount?: number;
  gitCommitDeletedLineCount?: number;
  gitCommitPatchBytes?: number;
  gitCommitDurationMs?: number;
  gitCommitDurable?: boolean;
  gitCommitCancellationObserved?: boolean;
  gitCommitRefUpdateStatus?:
    | "succeeded"
    | "failed"
    | "timed_out"
    | "output_capped"
    | "unknown";
  gitCommitMessageSha256?: string;
  gitCommitBranchRefSha256?: string;
  gitCommitParentSha1?: string;
  gitCommitMergeParentSha1?: string;
  gitCommitTreeSha1?: string;
  gitCommitProposedSha1?: string;
  gitCommitIdentitySha256?: string;
  gitCommitPatchSha256?: string;
  gitCommitBeforeRepositoryStateSha256?: string;
  gitCommitAfterHeadStateSha256?: string;
  gitCommitSourcePreviewResultSha256?: string;
  gitCommitErrorSha256?: string;
  gitCommitRuntimeEvidenceSha256?: string;
  gitCommitResultSha256?: string;
}

export function gitCommitEventEvidence(
  value: unknown,
): GitCommitToolEventTraceView | undefined {
  if (!record(value)) return undefined;
  const action = commitAction(value["action"]);
  const status = commitStatus(value["status"]);
  const postcondition = commitPostcondition(value["postcondition"]);
  const messageBytes = integer(value["messageBytes"], 1, 4 * 1024);
  const timestamp = integer(value["commitTimestampSeconds"], 0, 9_999_999_999);
  const contextLines = integer(value["contextLines"], 0, 10);
  const fileCount = integer(value["fileCount"], 0, 32);
  const hunkCount = integer(value["hunkCount"], 0, 100_000);
  const added = integer(value["addedLineCount"], 0, 1_000_000);
  const deleted = integer(value["deletedLineCount"], 0, 1_000_000);
  const patchBytes = integer(value["stagedPatchBytes"], 1, 128 * 1024);
  const duration = integer(value["durationMs"], 0, 61_000);
  const refUpdateStatus = refStatus(value["refUpdateStatus"]);
  const sha256Values = [
    value["messageSha256"],
    value["branchRefSha256"],
    value["stagedPatchSha256"],
    value["beforeRepositoryStateSha256"],
    value["runtimeEvidenceSha256"],
    value["resultSha256"],
  ];
  if (
    !validEvidence({
      value,
      action,
      status,
      postcondition,
      refUpdateStatus,
      bounded: [
        messageBytes,
        timestamp,
        contextLines,
        fileCount,
        hunkCount,
        added,
        deleted,
        patchBytes,
        duration,
      ],
      sha256Values,
    }) ||
    (fileCount === 0 &&
      (!sha1(value["mergeParentCommitSha1"]) ||
        hunkCount !== 0 ||
        added !== 0 ||
        deleted !== 0))
  ) {
    return undefined;
  }
  const hashes = sha256Values as string[];
  return {
    gitCommitAction: action!,
    gitCommitStatus: status!,
    gitCommitPostcondition: postcondition!,
    gitCommitMessageBytes: messageBytes!,
    gitCommitTimestampSeconds: timestamp!,
    gitCommitContextLines: contextLines!,
    gitCommitFileCount: fileCount!,
    gitCommitHunkCount: hunkCount!,
    gitCommitAddedLineCount: added!,
    gitCommitDeletedLineCount: deleted!,
    gitCommitPatchBytes: patchBytes!,
    gitCommitDurationMs: duration!,
    gitCommitDurable: value["durable"] as boolean,
    gitCommitCancellationObserved: value["cancellationObserved"] as boolean,
    ...(refUpdateStatus ? { gitCommitRefUpdateStatus: refUpdateStatus } : {}),
    gitCommitMessageSha256: hashes[0]!,
    gitCommitBranchRefSha256: hashes[1]!,
    ...(typeof value["identitySha256"] === "string"
      ? { gitCommitIdentitySha256: value["identitySha256"] }
      : {}),
    gitCommitPatchSha256: hashes[2]!,
    gitCommitBeforeRepositoryStateSha256: hashes[3]!,
    gitCommitRuntimeEvidenceSha256: hashes[4]!,
    gitCommitResultSha256: hashes[5]!,
    gitCommitParentSha1: value["parentCommitSha1"] as string,
    ...(typeof value["mergeParentCommitSha1"] === "string"
      ? {
          gitCommitMergeParentSha1: value["mergeParentCommitSha1"],
        }
      : {}),
    gitCommitTreeSha1: value["treeSha1"] as string,
    gitCommitProposedSha1: value["proposedCommitSha1"] as string,
    ...(typeof value["afterHeadStateSha256"] === "string"
      ? { gitCommitAfterHeadStateSha256: value["afterHeadStateSha256"] }
      : {}),
    ...(typeof value["sourcePreviewResultSha256"] === "string"
      ? {
          gitCommitSourcePreviewResultSha256:
            value["sourcePreviewResultSha256"],
        }
      : {}),
    ...(typeof value["errorSha256"] === "string"
      ? { gitCommitErrorSha256: value["errorSha256"] }
      : {}),
  };
}

function validEvidence(input: {
  value: Record<string, unknown>;
  action: "preview" | "apply" | undefined;
  status: "ready" | "applied" | "indeterminate" | undefined;
  postcondition: "not_applied" | "verified" | "indeterminate" | undefined;
  refUpdateStatus: GitCommitToolEventTraceView["gitCommitRefUpdateStatus"];
  bounded: Array<number | undefined>;
  sha256Values: unknown[];
}): boolean {
  return (
    validEnvelope(input) &&
    input.bounded.every((value) => value !== undefined) &&
    validDigests(input.value, input.sha256Values)
  );
}

function validEnvelope(input: {
  value: Record<string, unknown>;
  action: "preview" | "apply" | undefined;
  status: "ready" | "applied" | "indeterminate" | undefined;
  postcondition: "not_applied" | "verified" | "indeterminate" | undefined;
  refUpdateStatus: GitCommitToolEventTraceView["gitCommitRefUpdateStatus"];
}): boolean {
  return (
    input.value["kind"] === "napier.git-commit" &&
    input.value["schemaVersion"] === 1 &&
    validShape(
      input.value,
      input.action,
      input.status,
      input.postcondition,
      input.refUpdateStatus,
    ) &&
    typeof input.value["durable"] === "boolean" &&
    typeof input.value["cancellationObserved"] === "boolean"
  );
}

function validDigests(
  value: Record<string, unknown>,
  sha256Values: unknown[],
): boolean {
  return (
    sha1(value["parentCommitSha1"]) &&
    optionalSha1(value["mergeParentCommitSha1"]) &&
    value["mergeParentCommitSha1"] !== value["parentCommitSha1"] &&
    sha1(value["treeSha1"]) &&
    sha1(value["proposedCommitSha1"]) &&
    sha256Values.every(sha256) &&
    optionalSha256(value["identitySha256"]) &&
    optionalSha256(value["afterHeadStateSha256"]) &&
    optionalSha256(value["sourcePreviewResultSha256"]) &&
    optionalSha256(value["errorSha256"])
  );
}

export function gitCommitSummaryParts(
  view: GitCommitToolEventTraceView,
): string[] {
  return [
    ...(view.gitCommitAction ? [`git commit ${view.gitCommitAction}`] : []),
    ...(view.gitCommitStatus ? [`commit ${view.gitCommitStatus}`] : []),
    ...(view.gitCommitPostcondition
      ? [`postcondition ${view.gitCommitPostcondition}`]
      : []),
    ...(view.gitCommitRefUpdateStatus
      ? [`ref ${view.gitCommitRefUpdateStatus}`]
      : []),
    ...(view.gitCommitFileCount !== undefined
      ? [`files ${view.gitCommitFileCount}`]
      : []),
    ...(view.gitCommitPatchBytes !== undefined
      ? [`patch-bytes ${view.gitCommitPatchBytes}`]
      : []),
    ...(view.gitCommitProposedSha1
      ? [`commit ${view.gitCommitProposedSha1.slice(0, 12)}`]
      : []),
    ...(view.gitCommitMergeParentSha1 ? ["merge-parents 2"] : []),
    ...hash("commit-result", view.gitCommitResultSha256),
  ];
}

function validShape(
  value: Record<string, unknown>,
  action: "preview" | "apply" | undefined,
  status: "ready" | "applied" | "indeterminate" | undefined,
  postcondition: "not_applied" | "verified" | "indeterminate" | undefined,
  update: GitCommitToolEventTraceView["gitCommitRefUpdateStatus"],
): action is "preview" | "apply" {
  if (action === "preview") {
    return (
      status === "ready" &&
      postcondition === "not_applied" &&
      value["durable"] === false &&
      validPreviewCapability(value) &&
      update === undefined &&
      value["afterHeadStateSha256"] === undefined &&
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
      sha256(value["afterHeadStateSha256"])
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
    /^gitcommitpreview_[a-z0-9]{8,80}$/u.test(value["previewId"]) &&
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

function commitAction(value: unknown): "preview" | "apply" | undefined {
  return value === "preview" || value === "apply" ? value : undefined;
}

function commitStatus(value: unknown) {
  return value === "ready" || value === "applied" || value === "indeterminate"
    ? value
    : undefined;
}

function commitPostcondition(value: unknown) {
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

function optionalSha1(value: unknown): boolean {
  return value === undefined || sha1(value);
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
