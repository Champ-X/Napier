export interface LspSessionToolEventTraceView {
  lspSessionMode?: "one_shot" | "run_persistent";
  lspSessionReused?: boolean;
  lspSessionOperation?: number;
  lspSessionIdSha256?: string;
  lspSessionWorkspaceSha256?: string;
  lspSessionLimitsSha256?: string;
}

export function lspSessionEventEvidence(
  value: Record<string, unknown>,
): LspSessionToolEventTraceView | undefined {
  if (value["sessionMode"] === undefined) return {};
  const operation = integerInRange(value["sessionOperation"], 1, 32);
  if (
    (value["sessionMode"] !== "one_shot" &&
      value["sessionMode"] !== "run_persistent") ||
    typeof value["sessionReused"] !== "boolean" ||
    operation === undefined ||
    value["sessionReused"] !== operation > 1 ||
    !sha256(value["sessionIdSha256"]) ||
    !sha256(value["sessionWorkspaceSha256"]) ||
    !sha256(value["sessionLimitsSha256"])
  ) {
    return undefined;
  }
  return {
    lspSessionMode: value["sessionMode"],
    lspSessionReused: value["sessionReused"],
    lspSessionOperation: operation,
    lspSessionIdSha256: value["sessionIdSha256"],
    lspSessionWorkspaceSha256: value["sessionWorkspaceSha256"],
    lspSessionLimitsSha256: value["sessionLimitsSha256"],
  };
}

export function lspSessionSummaryParts(
  view: LspSessionToolEventTraceView,
): string[] {
  return [
    ...(view.lspSessionMode ? [`lsp-session ${view.lspSessionMode}`] : []),
    ...(view.lspSessionReused === true ? ["lsp-session-reused"] : []),
    ...(view.lspSessionOperation !== undefined
      ? [`lsp-session-operation ${view.lspSessionOperation}`]
      : []),
    ...hashSummary("lsp-session-id", view.lspSessionIdSha256),
    ...hashSummary("lsp-session-workspace", view.lspSessionWorkspaceSha256),
    ...hashSummary("lsp-session-limits", view.lspSessionLimitsSha256),
  ];
}

function integerInRange(
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

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function hashSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}
