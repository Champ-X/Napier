export interface GitStageToolEventTraceView {
  gitStageAction?: "preview" | "apply";
  gitStageStatus?: "ready" | "applied" | "indeterminate";
  gitStagePostcondition?: "not_applied" | "verified" | "indeterminate";
  gitStageContextLines?: number;
  gitStageFileCount?: number;
  gitStageHunkCount?: number;
  gitStageAddedLineCount?: number;
  gitStageDeletedLineCount?: number;
  gitStagePatchBytes?: number;
  gitStageDurationMs?: number;
  gitStageDurable?: boolean;
  gitStageCancellationObserved?: boolean;
  gitStagePathSha256?: string;
  gitStagePathStateSha256?: string;
  gitStageAttributesStateSha256?: string;
  gitStagePatchSha256?: string;
  gitStageBeforeRepositoryStateSha256?: string;
  gitStageBeforeNonIndexStateSha256?: string;
  gitStageBeforeIndexSha256?: string;
  gitStageProposedIndexSha256?: string;
  gitStageAfterIndexSha256?: string;
  gitStageSourcePreviewResultSha256?: string;
  gitStageSandboxSha256?: string;
  gitStageExecutableSha256?: string;
  gitStageArgumentsSha256?: string;
  gitStageEnvironmentSha256?: string;
  gitStageLimitsSha256?: string;
  gitStageResultSha256?: string;
}

export function gitStageEventEvidence(
  value: unknown,
): GitStageToolEventTraceView | undefined {
  if (!record(value)) return undefined;
  const action = stageAction(value["action"]);
  const status = stageStatus(value["status"]);
  const postcondition = stagePostcondition(value["postcondition"]);
  const contextLines = integer(value["contextLines"], 0, 10);
  const fileCount = integer(value["fileCount"], 1, 16);
  const hunkCount = integer(value["hunkCount"], 0, 100_000);
  const addedLineCount = integer(value["addedLineCount"], 0, 1_000_000);
  const deletedLineCount = integer(value["deletedLineCount"], 0, 1_000_000);
  const patchBytes = integer(value["patchBytes"], 1, 128 * 1024);
  const durationMs = integer(value["durationMs"], 0, 31_000);
  const requiredDigests = [
    value["pathSha256"],
    value["pathStateSha256"],
    value["attributesStateSha256"],
    value["patchSha256"],
    value["beforeRepositoryStateSha256"],
    value["beforeNonIndexStateSha256"],
    value["beforeIndexSha256"],
    value["proposedIndexSha256"],
    value["sandboxSha256"],
    value["gitExecutableSha256"],
    value["gitArgumentsSha256"],
    value["gitEnvironmentSha256"],
    value["gitResourceLimitsSha256"],
    value["resultSha256"],
  ];
  if (
    value["kind"] !== "napier.git-stage" ||
    value["schemaVersion"] !== 1 ||
    !validShape(value, action, status, postcondition) ||
    contextLines === undefined ||
    fileCount === undefined ||
    hunkCount === undefined ||
    addedLineCount === undefined ||
    deletedLineCount === undefined ||
    patchBytes === undefined ||
    durationMs === undefined ||
    typeof value["durable"] !== "boolean" ||
    typeof value["cancellationObserved"] !== "boolean" ||
    !requiredDigests.every(sha256) ||
    (value["afterIndexSha256"] !== undefined &&
      !sha256(value["afterIndexSha256"])) ||
    (value["sourcePreviewResultSha256"] !== undefined &&
      !sha256(value["sourcePreviewResultSha256"]))
  ) {
    return undefined;
  }
  const digest = requiredDigests as string[];
  return {
    gitStageAction: action,
    gitStageStatus: status!,
    gitStagePostcondition: postcondition!,
    gitStageContextLines: contextLines,
    gitStageFileCount: fileCount,
    gitStageHunkCount: hunkCount,
    gitStageAddedLineCount: addedLineCount,
    gitStageDeletedLineCount: deletedLineCount,
    gitStagePatchBytes: patchBytes,
    gitStageDurationMs: durationMs,
    gitStageDurable: value["durable"],
    gitStageCancellationObserved: value["cancellationObserved"],
    gitStagePathSha256: digest[0]!,
    gitStagePathStateSha256: digest[1]!,
    gitStageAttributesStateSha256: digest[2]!,
    gitStagePatchSha256: digest[3]!,
    gitStageBeforeRepositoryStateSha256: digest[4]!,
    gitStageBeforeNonIndexStateSha256: digest[5]!,
    gitStageBeforeIndexSha256: digest[6]!,
    gitStageProposedIndexSha256: digest[7]!,
    ...(typeof value["afterIndexSha256"] === "string"
      ? { gitStageAfterIndexSha256: value["afterIndexSha256"] }
      : {}),
    ...(typeof value["sourcePreviewResultSha256"] === "string"
      ? {
          gitStageSourcePreviewResultSha256: value["sourcePreviewResultSha256"],
        }
      : {}),
    gitStageSandboxSha256: digest[8]!,
    gitStageExecutableSha256: digest[9]!,
    gitStageArgumentsSha256: digest[10]!,
    gitStageEnvironmentSha256: digest[11]!,
    gitStageLimitsSha256: digest[12]!,
    gitStageResultSha256: digest[13]!,
  };
}

export function gitStageSummaryParts(
  view: GitStageToolEventTraceView,
): string[] {
  return [
    ...(view.gitStageAction ? [`git stage ${view.gitStageAction}`] : []),
    ...(view.gitStageStatus ? [`stage ${view.gitStageStatus}`] : []),
    ...(view.gitStagePostcondition
      ? [`postcondition ${view.gitStagePostcondition}`]
      : []),
    ...(view.gitStageHunkCount !== undefined
      ? [`hunks ${view.gitStageHunkCount}`]
      : []),
    ...(view.gitStageAddedLineCount !== undefined
      ? [`added ${view.gitStageAddedLineCount}`]
      : []),
    ...(view.gitStageDeletedLineCount !== undefined
      ? [`deleted ${view.gitStageDeletedLineCount}`]
      : []),
    ...(view.gitStagePatchBytes !== undefined
      ? [`patch-bytes ${view.gitStagePatchBytes}`]
      : []),
    ...hash("stage-index", view.gitStageProposedIndexSha256),
    ...hash("stage-patch", view.gitStagePatchSha256),
  ];
}

function validShape(
  value: Record<string, unknown>,
  action: "preview" | "apply" | undefined,
  status: "ready" | "applied" | "indeterminate" | undefined,
  postcondition: "not_applied" | "verified" | "indeterminate" | undefined,
): action is "preview" | "apply" {
  if (action === "preview") {
    return (
      status === "ready" &&
      postcondition === "not_applied" &&
      value["durable"] === false &&
      value["afterIndexSha256"] === undefined &&
      value["sourcePreviewResultSha256"] === undefined
    );
  }
  return (
    action === "apply" &&
    (status === "applied" || status === "indeterminate") &&
    (postcondition === "verified" || postcondition === "indeterminate") &&
    sha256(value["sourcePreviewResultSha256"]) &&
    (status !== "applied" ||
      (postcondition === "verified" &&
        value["durable"] === true &&
        sha256(value["afterIndexSha256"])))
  );
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
    ? Number(value)
    : undefined;
}

function stageAction(value: unknown): "preview" | "apply" | undefined {
  return value === "preview" || value === "apply" ? value : undefined;
}

function stageStatus(
  value: unknown,
): "ready" | "applied" | "indeterminate" | undefined {
  return value === "ready" || value === "applied" || value === "indeterminate"
    ? value
    : undefined;
}

function stagePostcondition(
  value: unknown,
): "not_applied" | "verified" | "indeterminate" | undefined {
  return value === "not_applied" ||
    value === "verified" ||
    value === "indeterminate"
    ? value
    : undefined;
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function hash(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
