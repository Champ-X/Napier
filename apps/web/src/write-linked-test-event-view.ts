type WriteLinkedTestStatus =
  | "passed"
  | "failed"
  | "timed_out"
  | "output_capped"
  | "no_match"
  | "selection_incomplete"
  | "drifted"
  | "cancelled"
  | "unavailable";

export interface WriteLinkedTestEventTraceView {
  writeLinkedTestStatus?: WriteLinkedTestStatus;
  writeLinkedChangedFileCount?: number;
  writeLinkedChangedSymbolCount?: number;
  writeLinkedChangedSymbolsTruncated?: boolean;
  writeLinkedScannedFileCount?: number;
  writeLinkedConfigurationFileCount?: number;
  writeLinkedWorkspacePackageCount?: number;
  writeLinkedPathAliasCount?: number;
  writeLinkedWorkspacePackageEdgeCount?: number;
  writeLinkedPathAliasEdgeCount?: number;
  writeLinkedCandidateTestCount?: number;
  writeLinkedSelectedTestCount?: number;
  writeLinkedOmittedTestCount?: number;
  writeLinkedUnresolvedImportCount?: number;
  writeLinkedGraphTruncated?: boolean;
  writeLinkedDurationMs?: number;
  writeLinkedExitCode?: number;
  writeLinkedStdoutTruncated?: boolean;
  writeLinkedStderrTruncated?: boolean;
  writeLinkedChangedFileSetSha256?: string;
  writeLinkedChangedSymbolSetSha256?: string;
  writeLinkedDependencyGraphSha256?: string;
  writeLinkedSelectedTestSetSha256?: string;
  writeLinkedSelectionSnapshotSha256?: string;
  writeLinkedObservedSnapshotSha256?: string;
  writeLinkedVerifierSha256?: string;
  writeLinkedVerifierVersion?: string;
  writeLinkedRuntimeIdentitySha256?: string;
  writeLinkedStdoutSha256?: string;
  writeLinkedStderrSha256?: string;
  writeLinkedErrorSha256?: string;
  writeLinkedResultSha256?: string;
}

export function writeLinkedTestEventEvidence(
  value: unknown,
): WriteLinkedTestEventTraceView | undefined {
  if (!record(value)) return undefined;
  const schemaVersion = value["schemaVersion"];
  const status = writeLinkedStatus(value["status"]);
  const changedFileCount = integer(value["changedFileCount"], 1, 32);
  const changedSymbolCount = integer(value["changedSymbolCount"], 0, 16_384);
  const scannedFileCount = integer(value["scannedFileCount"], 0, 1_000);
  const configurationFileCount =
    schemaVersion === 2
      ? integer(value["configurationFileCount"], 0, 128)
      : undefined;
  const workspacePackageCount =
    schemaVersion === 2
      ? integer(value["workspacePackageCount"], 0, 64)
      : undefined;
  const pathAliasCount =
    schemaVersion === 2 ? integer(value["pathAliasCount"], 0, 128) : undefined;
  const workspacePackageEdgeCount =
    schemaVersion === 2
      ? integer(value["workspacePackageEdgeCount"], 0, 5_000)
      : undefined;
  const pathAliasEdgeCount =
    schemaVersion === 2
      ? integer(value["pathAliasEdgeCount"], 0, 5_000)
      : undefined;
  const candidateTestCount = integer(value["candidateTestCount"], 0, 1_000);
  const selectedTestCount = integer(value["selectedTestCount"], 0, 8);
  const omittedTestCount = integer(value["omittedTestCount"], 0, 1_000);
  const unresolvedImportCount = integer(
    value["unresolvedImportCount"],
    0,
    5_000,
  );
  const durationMs = integer(value["durationMs"], 0, 180_000);
  if (
    value["kind"] !== "napier.write-linked-test-verification" ||
    (schemaVersion !== 1 && schemaVersion !== 2) ||
    !status ||
    changedFileCount === undefined ||
    changedSymbolCount === undefined ||
    scannedFileCount === undefined ||
    candidateTestCount === undefined ||
    selectedTestCount === undefined ||
    omittedTestCount === undefined ||
    unresolvedImportCount === undefined ||
    (schemaVersion === 2 &&
      (configurationFileCount === undefined ||
        workspacePackageCount === undefined ||
        pathAliasCount === undefined ||
        workspacePackageEdgeCount === undefined ||
        pathAliasEdgeCount === undefined ||
        workspacePackageEdgeCount + pathAliasEdgeCount > 5_000)) ||
    durationMs === undefined ||
    typeof value["graphTruncated"] !== "boolean" ||
    typeof value["changedSymbolsTruncated"] !== "boolean" ||
    candidateTestCount > scannedFileCount ||
    selectedTestCount > candidateTestCount ||
    !validStatusBinding(
      value,
      status,
      selectedTestCount,
      omittedTestCount,
      unresolvedImportCount,
    )
  ) {
    return undefined;
  }
  const hashes = hashFields(value);
  if (
    !hashes.writeLinkedChangedFileSetSha256 ||
    !hashes.writeLinkedChangedSymbolSetSha256 ||
    !hashes.writeLinkedDependencyGraphSha256 ||
    !hashes.writeLinkedSelectedTestSetSha256 ||
    !hashes.writeLinkedSelectionSnapshotSha256 ||
    !hashes.writeLinkedResultSha256
  ) {
    return undefined;
  }
  const exitCode =
    value["exitCode"] === null
      ? undefined
      : integer(value["exitCode"], -1, 255);
  if (
    value["exitCode"] !== undefined &&
    value["exitCode"] !== null &&
    exitCode === undefined
  ) {
    return undefined;
  }
  return {
    writeLinkedTestStatus: status,
    writeLinkedChangedFileCount: changedFileCount,
    writeLinkedChangedSymbolCount: changedSymbolCount,
    writeLinkedChangedSymbolsTruncated: value["changedSymbolsTruncated"],
    writeLinkedScannedFileCount: scannedFileCount,
    ...(configurationFileCount !== undefined
      ? { writeLinkedConfigurationFileCount: configurationFileCount }
      : {}),
    ...(workspacePackageCount !== undefined
      ? { writeLinkedWorkspacePackageCount: workspacePackageCount }
      : {}),
    ...(pathAliasCount !== undefined
      ? { writeLinkedPathAliasCount: pathAliasCount }
      : {}),
    ...(workspacePackageEdgeCount !== undefined
      ? { writeLinkedWorkspacePackageEdgeCount: workspacePackageEdgeCount }
      : {}),
    ...(pathAliasEdgeCount !== undefined
      ? { writeLinkedPathAliasEdgeCount: pathAliasEdgeCount }
      : {}),
    writeLinkedCandidateTestCount: candidateTestCount,
    writeLinkedSelectedTestCount: selectedTestCount,
    writeLinkedOmittedTestCount: omittedTestCount,
    writeLinkedUnresolvedImportCount: unresolvedImportCount,
    writeLinkedGraphTruncated: value["graphTruncated"],
    writeLinkedDurationMs: durationMs,
    ...(exitCode !== undefined ? { writeLinkedExitCode: exitCode } : {}),
    ...(value["stdoutTruncated"] === true
      ? { writeLinkedStdoutTruncated: true }
      : {}),
    ...(value["stderrTruncated"] === true
      ? { writeLinkedStderrTruncated: true }
      : {}),
    ...hashes,
    ...verifierVersionField(value),
  };
}

export function writeLinkedTestSummaryParts(
  view: WriteLinkedTestEventTraceView,
): string[] {
  return [
    ...(view.writeLinkedTestStatus
      ? [`linked-tests ${view.writeLinkedTestStatus}`]
      : []),
    ...(view.writeLinkedSelectedTestCount !== undefined
      ? [`selected-tests ${view.writeLinkedSelectedTestCount}`]
      : []),
    ...(view.writeLinkedCandidateTestCount !== undefined
      ? [`candidate-tests ${view.writeLinkedCandidateTestCount}`]
      : []),
    ...(view.writeLinkedChangedSymbolCount !== undefined
      ? [`changed-symbols ${view.writeLinkedChangedSymbolCount}`]
      : []),
    ...(view.writeLinkedChangedSymbolsTruncated
      ? ["changed-symbols-incomplete"]
      : []),
    ...(view.writeLinkedScannedFileCount !== undefined
      ? [`scanned-files ${view.writeLinkedScannedFileCount}`]
      : []),
    ...(view.writeLinkedWorkspacePackageEdgeCount
      ? [`workspace-package-edges ${view.writeLinkedWorkspacePackageEdgeCount}`]
      : []),
    ...(view.writeLinkedPathAliasEdgeCount
      ? [`path-alias-edges ${view.writeLinkedPathAliasEdgeCount}`]
      : []),
    ...(view.writeLinkedConfigurationFileCount !== undefined
      ? [`resolution-configs ${view.writeLinkedConfigurationFileCount}`]
      : []),
    ...(view.writeLinkedGraphTruncated ? ["test-selection-incomplete"] : []),
    ...(view.writeLinkedDurationMs !== undefined
      ? [`linked-test-ms ${view.writeLinkedDurationMs}`]
      : []),
    ...hashSummary("test-files", view.writeLinkedChangedFileSetSha256),
    ...hashSummary("test-symbols", view.writeLinkedChangedSymbolSetSha256),
    ...hashSummary("test-graph", view.writeLinkedDependencyGraphSha256),
    ...hashSummary("selected-test-set", view.writeLinkedSelectedTestSetSha256),
    ...hashSummary("linked-test-result", view.writeLinkedResultSha256),
  ];
}

function validStatusBinding(
  value: Record<string, unknown>,
  status: WriteLinkedTestStatus,
  selectedTestCount: number,
  omittedTestCount: number,
  unresolvedImportCount: number,
): boolean {
  const executed =
    status === "passed" ||
    status === "failed" ||
    status === "timed_out" ||
    status === "output_capped";
  if (executed) {
    return (
      selectedTestCount > 0 &&
      value["graphTruncated"] === false &&
      hash(value["observedSnapshotSha256"]) !== undefined &&
      hash(value["verifierSha256"]) !== undefined &&
      hash(value["stdoutSha256"]) !== undefined &&
      hash(value["stderrSha256"]) !== undefined &&
      value["errorSha256"] === undefined
    );
  }
  if (status === "no_match") {
    return (
      selectedTestCount === 0 &&
      omittedTestCount === 0 &&
      unresolvedImportCount === 0 &&
      value["graphTruncated"] === false &&
      value["verifierSha256"] === undefined &&
      value["errorSha256"] === undefined
    );
  }
  if (status === "selection_incomplete") {
    return (
      value["graphTruncated"] === true &&
      value["verifierSha256"] === undefined &&
      value["errorSha256"] === undefined
    );
  }
  return (
    hash(value["errorSha256"]) !== undefined ||
    (status === "drifted" &&
      hash(value["observedSnapshotSha256"]) !== undefined)
  );
}

function hashFields(
  value: Record<string, unknown>,
): WriteLinkedTestEventTraceView {
  const fields: Record<string, keyof WriteLinkedTestEventTraceView> = {
    changedFileSetSha256: "writeLinkedChangedFileSetSha256",
    changedSymbolSetSha256: "writeLinkedChangedSymbolSetSha256",
    dependencyGraphSha256: "writeLinkedDependencyGraphSha256",
    selectedTestSetSha256: "writeLinkedSelectedTestSetSha256",
    selectionSnapshotSha256: "writeLinkedSelectionSnapshotSha256",
    observedSnapshotSha256: "writeLinkedObservedSnapshotSha256",
    verifierSha256: "writeLinkedVerifierSha256",
    runtimeIdentitySha256: "writeLinkedRuntimeIdentitySha256",
    stdoutSha256: "writeLinkedStdoutSha256",
    stderrSha256: "writeLinkedStderrSha256",
    errorSha256: "writeLinkedErrorSha256",
    resultSha256: "writeLinkedResultSha256",
  };
  const result: Record<string, string> = {};
  for (const [source, target] of Object.entries(fields)) {
    const digest = hash(value[source]);
    if (digest) result[target] = digest;
  }
  return result as WriteLinkedTestEventTraceView;
}

function visibleVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,79}$/u.test(value)
  );
}

function verifierVersionField(
  value: Record<string, unknown>,
): Pick<WriteLinkedTestEventTraceView, "writeLinkedVerifierVersion"> {
  return visibleVersion(value["verifierVersion"])
    ? { writeLinkedVerifierVersion: value["verifierVersion"] }
    : {};
}

function writeLinkedStatus(value: unknown): WriteLinkedTestStatus | undefined {
  return value === "passed" ||
    value === "failed" ||
    value === "timed_out" ||
    value === "output_capped" ||
    value === "no_match" ||
    value === "selection_incomplete" ||
    value === "drifted" ||
    value === "cancelled" ||
    value === "unavailable"
    ? value
    : undefined;
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

function hashSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}

function hash(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
