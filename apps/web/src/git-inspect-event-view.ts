export interface GitInspectToolEventTraceView {
  gitInspectAction?: "status" | "diff" | "conflict";
  gitInspectScope?: "working" | "staged";
  gitInspectContextLines?: number;
  gitInspectStatusEntryCount?: number;
  gitInspectFileCount?: number;
  gitInspectHunkCount?: number;
  gitInspectAddedLineCount?: number;
  gitInspectDeletedLineCount?: number;
  gitInspectConflictKind?:
    | "both_modified"
    | "both_added"
    | "deleted_by_them"
    | "deleted_by_us"
    | "mixed";
  gitInspectConflictStageCount?: number;
  gitInspectBasePresent?: boolean;
  gitInspectOursPresent?: boolean;
  gitInspectTheirsPresent?: boolean;
  gitInspectWorktreePresent?: boolean;
  gitInspectConflictEvidenceSha256?: string;
  gitInspectOutputBytes?: number;
  gitInspectDurationMs?: number;
  gitInspectIndexPresent?: boolean;
  gitInspectRepositoryPathSha256?: string;
  gitInspectDirectorySha256?: string;
  gitInspectPathSha256?: string;
  gitInspectOutputSha256?: string;
  gitInspectRepositoryStateSha256?: string;
  gitInspectHeadStateSha256?: string;
  gitInspectIndexSha256?: string;
  gitInspectConfigSha256?: string;
  gitInspectSandboxSha256?: string;
  gitInspectExecutableSha256?: string;
  gitInspectArgumentsSha256?: string;
  gitInspectEnvironmentSha256?: string;
  gitInspectLimitsSha256?: string;
  gitInspectResultSha256?: string;
}

export function gitInspectEventEvidence(
  value: unknown,
): GitInspectToolEventTraceView | undefined {
  if (!record(value)) return undefined;
  const action = gitAction(value["action"]);
  const scope = gitScope(value["scope"]);
  const statusEntryCount = integer(value["statusEntryCount"], 0, 100_000);
  const fileCount = integer(value["fileCount"], 0, 100_000);
  const hunkCount = integer(value["hunkCount"], 0, 100_000);
  const addedLineCount = integer(value["addedLineCount"], 0, 1_000_000);
  const deletedLineCount = integer(value["deletedLineCount"], 0, 1_000_000);
  const outputBytes = integer(value["outputBytes"], 0, 128 * 1024);
  const durationMs = integer(value["durationMs"], 0, 31_000);
  const contextLines = integer(value["contextLines"], 0, 10);
  const conflictKind = gitConflictKind(value["conflictKind"]);
  const conflictStageCount = integer(value["conflictStageCount"], 2, 12);
  const digests = [
    value["repositoryPathSha256"],
    value["gitDirectorySha256"],
    value["outputSha256"],
    value["repositoryStateSha256"],
    value["headStateSha256"],
    value["indexSha256"],
    value["configSha256"],
    value["sandboxSha256"],
    value["gitExecutableSha256"],
    value["gitArgumentsSha256"],
    value["gitEnvironmentSha256"],
    value["gitResourceLimitsSha256"],
    value["resultSha256"],
  ];
  if (
    value["kind"] !== "napier.git-inspection" ||
    value["schemaVersion"] !== 1 ||
    !validActionShape(value, action, scope, contextLines) ||
    statusEntryCount === undefined ||
    fileCount === undefined ||
    hunkCount === undefined ||
    addedLineCount === undefined ||
    deletedLineCount === undefined ||
    outputBytes === undefined ||
    durationMs === undefined ||
    typeof value["indexPresent"] !== "boolean" ||
    !digests.every(sha256) ||
    !validConflictShape(value, action, conflictKind, conflictStageCount) ||
    (value["pathSha256"] !== undefined && !sha256(value["pathSha256"]))
  ) {
    return undefined;
  }
  const validated = digests as string[];
  return {
    gitInspectAction: action,
    ...(scope ? { gitInspectScope: scope } : {}),
    ...(contextLines !== undefined
      ? { gitInspectContextLines: contextLines }
      : {}),
    gitInspectStatusEntryCount: statusEntryCount,
    gitInspectFileCount: fileCount,
    gitInspectHunkCount: hunkCount,
    gitInspectAddedLineCount: addedLineCount,
    gitInspectDeletedLineCount: deletedLineCount,
    ...(conflictKind
      ? {
          gitInspectConflictKind: conflictKind,
          gitInspectConflictStageCount: conflictStageCount!,
          gitInspectBasePresent: Boolean(value["basePresent"]),
          gitInspectOursPresent: Boolean(value["oursPresent"]),
          gitInspectTheirsPresent: Boolean(value["theirsPresent"]),
          gitInspectWorktreePresent: Boolean(value["worktreePresent"]),
          gitInspectConflictEvidenceSha256: value[
            "conflictEvidenceSha256"
          ] as string,
        }
      : {}),
    gitInspectOutputBytes: outputBytes,
    gitInspectDurationMs: durationMs,
    gitInspectIndexPresent: value["indexPresent"],
    gitInspectRepositoryPathSha256: validated[0]!,
    gitInspectDirectorySha256: validated[1]!,
    ...(typeof value["pathSha256"] === "string"
      ? { gitInspectPathSha256: value["pathSha256"] }
      : {}),
    gitInspectOutputSha256: validated[2]!,
    gitInspectRepositoryStateSha256: validated[3]!,
    gitInspectHeadStateSha256: validated[4]!,
    gitInspectIndexSha256: validated[5]!,
    gitInspectConfigSha256: validated[6]!,
    gitInspectSandboxSha256: validated[7]!,
    gitInspectExecutableSha256: validated[8]!,
    gitInspectArgumentsSha256: validated[9]!,
    gitInspectEnvironmentSha256: validated[10]!,
    gitInspectLimitsSha256: validated[11]!,
    gitInspectResultSha256: validated[12]!,
  };
}

export function gitInspectSummaryParts(
  view: GitInspectToolEventTraceView,
): string[] {
  return [
    ...(view.gitInspectAction
      ? [
          `git ${view.gitInspectAction}${view.gitInspectScope ? ` ${view.gitInspectScope}` : ""}`,
        ]
      : []),
    ...(view.gitInspectStatusEntryCount !== undefined
      ? [`status-entries ${view.gitInspectStatusEntryCount}`]
      : []),
    ...(view.gitInspectContextLines !== undefined
      ? [`context ${view.gitInspectContextLines}`]
      : []),
    ...(view.gitInspectFileCount !== undefined
      ? [`files ${view.gitInspectFileCount}`]
      : []),
    ...(view.gitInspectHunkCount !== undefined
      ? [`hunks ${view.gitInspectHunkCount}`]
      : []),
    ...(view.gitInspectAddedLineCount !== undefined
      ? [`added ${view.gitInspectAddedLineCount}`]
      : []),
    ...(view.gitInspectDeletedLineCount !== undefined
      ? [`deleted ${view.gitInspectDeletedLineCount}`]
      : []),
    ...(view.gitInspectConflictKind
      ? [
          `conflict ${view.gitInspectConflictKind}`,
          `stages ${view.gitInspectConflictStageCount}`,
        ]
      : []),
    ...(view.gitInspectOutputBytes !== undefined
      ? [`output-bytes ${view.gitInspectOutputBytes}`]
      : []),
    ...hash("git-sandbox", view.gitInspectSandboxSha256),
    ...hash("git-state", view.gitInspectRepositoryStateSha256),
    ...hash("git-output", view.gitInspectOutputSha256),
  ];
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

function gitAction(value: unknown): "status" | "diff" | "conflict" | undefined {
  return value === "status" || value === "diff" || value === "conflict"
    ? value
    : undefined;
}

function validActionShape(
  value: Record<string, unknown>,
  action: "status" | "diff" | "conflict" | undefined,
  scope: "working" | "staged" | undefined,
  contextLines: number | undefined,
): action is "status" | "diff" {
  if (action === "diff") {
    return (
      scope !== undefined &&
      contextLines !== undefined &&
      value["statusEntryCount"] === 0
    );
  }
  if (action === "conflict") {
    return (
      scope === undefined &&
      contextLines === undefined &&
      value["statusEntryCount"] === 0 &&
      integer(value["fileCount"], 1, 4) !== undefined &&
      value["hunkCount"] === 0 &&
      value["addedLineCount"] === 0 &&
      value["deletedLineCount"] === 0 &&
      sha256(value["pathSha256"])
    );
  }
  return (
    action === "status" &&
    scope === undefined &&
    contextLines === undefined &&
    value["pathSha256"] === undefined &&
    value["fileCount"] === 0 &&
    value["hunkCount"] === 0 &&
    value["addedLineCount"] === 0 &&
    value["deletedLineCount"] === 0
  );
}

function validConflictShape(
  value: Record<string, unknown>,
  action: "status" | "diff" | "conflict" | undefined,
  conflictKind: GitInspectToolEventTraceView["gitInspectConflictKind"],
  conflictStageCount: number | undefined,
): boolean {
  const keys = [
    "conflictKind",
    "conflictStageCount",
    "basePresent",
    "oursPresent",
    "theirsPresent",
    "worktreePresent",
    "conflictEvidenceSha256",
  ] as const;
  if (action !== "conflict") {
    return keys.every((key) => value[key] === undefined);
  }
  return (
    conflictKind !== undefined &&
    conflictStageCount !== undefined &&
    ["basePresent", "oursPresent", "theirsPresent", "worktreePresent"].every(
      (key) => typeof value[key] === "boolean",
    ) &&
    conflictStageShapeValid(value) &&
    sha256(value["conflictEvidenceSha256"])
  );
}

function conflictStageShapeValid(value: Record<string, unknown>): boolean {
  const files = integer(value["fileCount"], 1, 4) ?? 0;
  const stages = Number(value["conflictStageCount"]);
  if (value["conflictKind"] === "mixed") {
    return files >= 2 && stages >= files * 2 && stages <= files * 3;
  }
  const shape = [
    stages,
    value["basePresent"],
    value["oursPresent"],
    value["theirsPresent"],
  ];
  switch (value["conflictKind"]) {
    case "both_modified":
      return (
        JSON.stringify(shape) === JSON.stringify([files * 3, true, true, true])
      );
    case "both_added":
      return (
        JSON.stringify(shape) === JSON.stringify([files * 2, false, true, true])
      );
    case "deleted_by_them":
      return (
        JSON.stringify(shape) === JSON.stringify([files * 2, true, true, false])
      );
    case "deleted_by_us":
      return (
        JSON.stringify(shape) === JSON.stringify([files * 2, true, false, true])
      );
    default:
      return false;
  }
}

function gitConflictKind(
  value: unknown,
): GitInspectToolEventTraceView["gitInspectConflictKind"] {
  return value === "both_modified" ||
    value === "both_added" ||
    value === "deleted_by_them" ||
    value === "deleted_by_us" ||
    value === "mixed"
    ? value
    : undefined;
}

function gitScope(value: unknown): "working" | "staged" | undefined {
  return value === "working" || value === "staged" ? value : undefined;
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
