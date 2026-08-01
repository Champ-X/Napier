export interface VerificationToolEventTraceView {
  verificationKind?: "typecheck" | "test" | "format";
  verificationStatus?: "passed" | "failed" | "timed_out" | "output_capped";
  verificationExitCode?: number;
  verificationScopeSha256?: string;
  verificationCwdPathSha256?: string;
  verificationTargetPathSha256?: string;
  verificationTargetSnapshotSha256?: string;
  verificationTargetSnapshotTruncated?: boolean;
  verificationVerifierSha256?: string;
  verificationToolchainExternal?: boolean;
  verificationToolchainSha256?: string;
  verificationResultSha256?: string;
  verificationWorkspaceSnapshotSha256?: string;
  verificationWorkspaceSnapshotFileCount?: number;
  verificationWorkspaceSnapshotBytes?: number;
  verificationWorkspaceSnapshotTruncated?: boolean;
  verificationStdoutSha256?: string;
  verificationStderrSha256?: string;
  verificationStdoutTruncated?: boolean;
  verificationStderrTruncated?: boolean;
}

export function verificationEventEvidence(
  value: unknown,
): VerificationToolEventTraceView | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const kind = verificationKind(record["kind"]);
  const status = verificationStatus(record["status"]);
  if (!kind || !status) return undefined;
  const exitCode = integerInRange(record["exitCode"], -1, 255);
  const workspaceSnapshotFileCount = integerInRange(
    record["workspaceSnapshotFileCount"],
    0,
    2_001,
  );
  const workspaceSnapshotBytes = integerInRange(
    record["workspaceSnapshotBytes"],
    0,
    16 * 1024 * 1024,
  );
  return {
    verificationKind: kind,
    verificationStatus: status,
    ...(exitCode !== undefined ? { verificationExitCode: exitCode } : {}),
    ...hashField(record, "scopeSha256", "verificationScopeSha256"),
    ...hashField(record, "cwdPathSha256", "verificationCwdPathSha256"),
    ...hashField(record, "targetPathSha256", "verificationTargetPathSha256"),
    ...hashField(
      record,
      "targetSnapshotSha256",
      "verificationTargetSnapshotSha256",
    ),
    ...(record["targetSnapshotTruncated"] === true
      ? { verificationTargetSnapshotTruncated: true }
      : {}),
    ...hashField(record, "verifierSha256", "verificationVerifierSha256"),
    ...(record["toolchainExternal"] === true
      ? { verificationToolchainExternal: true }
      : {}),
    ...hashField(record, "toolchainSha256", "verificationToolchainSha256"),
    ...hashField(record, "resultSha256", "verificationResultSha256"),
    ...hashField(
      record,
      "workspaceSnapshotSha256",
      "verificationWorkspaceSnapshotSha256",
    ),
    ...(workspaceSnapshotFileCount !== undefined
      ? { verificationWorkspaceSnapshotFileCount: workspaceSnapshotFileCount }
      : {}),
    ...(workspaceSnapshotBytes !== undefined
      ? { verificationWorkspaceSnapshotBytes: workspaceSnapshotBytes }
      : {}),
    ...(record["workspaceSnapshotTruncated"] === true
      ? { verificationWorkspaceSnapshotTruncated: true }
      : {}),
    ...hashField(record, "stdoutSha256", "verificationStdoutSha256"),
    ...hashField(record, "stderrSha256", "verificationStderrSha256"),
    ...(record["stdoutTruncated"] === true
      ? { verificationStdoutTruncated: true }
      : {}),
    ...(record["stderrTruncated"] === true
      ? { verificationStderrTruncated: true }
      : {}),
  };
}

export function verificationSummaryParts(
  view: VerificationToolEventTraceView,
): string[] {
  return [
    ...(view.verificationKind && view.verificationStatus
      ? [
          `verification ${view.verificationKind} ${view.verificationStatus}`,
          ...(view.verificationExitCode !== undefined
            ? [`exit ${view.verificationExitCode}`]
            : []),
        ]
      : []),
    ...shortHashPart("scope", view.verificationScopeSha256),
    ...shortHashPart("cwd", view.verificationCwdPathSha256),
    ...shortHashPart("target", view.verificationTargetPathSha256),
    ...shortHashPart("target-snapshot", view.verificationTargetSnapshotSha256),
    ...(view.verificationTargetSnapshotTruncated
      ? ["target-snapshot-truncated"]
      : []),
    ...shortHashPart("verifier", view.verificationVerifierSha256),
    ...(view.verificationToolchainExternal ? ["external-toolchain"] : []),
    ...shortHashPart("toolchain", view.verificationToolchainSha256),
    ...(view.verificationWorkspaceSnapshotFileCount !== undefined
      ? [`snapshot-files ${view.verificationWorkspaceSnapshotFileCount}`]
      : []),
    ...(view.verificationWorkspaceSnapshotBytes !== undefined
      ? [`snapshot-bytes ${view.verificationWorkspaceSnapshotBytes}`]
      : []),
    ...(view.verificationWorkspaceSnapshotTruncated
      ? ["snapshot-truncated"]
      : []),
    ...shortHashPart(
      "workspace-snapshot",
      view.verificationWorkspaceSnapshotSha256,
    ),
    ...shortHashPart("stdout", view.verificationStdoutSha256),
    ...shortHashPart("stderr", view.verificationStderrSha256),
    ...(view.verificationStdoutTruncated ? ["stdout-truncated"] : []),
    ...(view.verificationStderrTruncated ? ["stderr-truncated"] : []),
    ...shortHashPart("verification-result", view.verificationResultSha256),
  ];
}

function hashField<Key extends keyof VerificationToolEventTraceView>(
  record: Record<string, unknown>,
  source: string,
  target: Key,
): Partial<Pick<VerificationToolEventTraceView, Key>> {
  const value = sha256(record[source]);
  return value
    ? ({ [target]: value } as Partial<
        Pick<VerificationToolEventTraceView, Key>
      >)
    : {};
}

function shortHashPart(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}

function verificationKind(
  value: unknown,
): VerificationToolEventTraceView["verificationKind"] {
  return value === "typecheck" || value === "test" || value === "format"
    ? value
    : undefined;
}

function verificationStatus(
  value: unknown,
): VerificationToolEventTraceView["verificationStatus"] {
  return value === "passed" ||
    value === "failed" ||
    value === "timed_out" ||
    value === "output_capped"
    ? value
    : undefined;
}

function integerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return Number.isInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
    ? (value as number)
    : undefined;
}

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}
