export interface BrowserLocalPreviewTraceView {
  browserConsoleEntryCount?: number;
  browserConsoleErrorCount?: number;
  browserConsoleWarningCount?: number;
  browserConsoleEntriesSha256?: string;
  browserConsoleTruncated?: boolean;
  browserWorkspacePreviewEntryPathSha256?: string;
  browserWorkspacePreviewEntrySha256?: string;
  browserWorkspacePreviewEntryBytes?: number;
}

export function validBrowserActionEvidence(input: {
  action: string;
  snapshot: unknown;
  screenshot: unknown;
  file: unknown;
  suggestedFilenameSha256: string | undefined;
}): boolean {
  const snapshotExpected = ![
    "screenshot",
    "close",
    "find",
    "scroll",
    "console",
  ].includes(input.action);
  return (
    Boolean(input.snapshot) === snapshotExpected &&
    Boolean(input.screenshot) === (input.action === "screenshot") &&
    Boolean(input.file) ===
      (input.action === "upload" || input.action === "download") &&
    Boolean(input.suggestedFilenameSha256) === (input.action === "download")
  );
}

export function browserLocalPreviewEvidence(
  value: Record<string, unknown>,
): BrowserLocalPreviewTraceView | null {
  const consoleEvidence = optionalConsole(value);
  const previewEvidence = optionalWorkspacePreview(value);
  return consoleEvidence === null || previewEvidence === null
    ? null
    : { ...(consoleEvidence ?? {}), ...(previewEvidence ?? {}) };
}

export function browserLocalPreviewSummaryParts(
  view: BrowserLocalPreviewTraceView,
): string[] {
  return [
    ...(view.browserConsoleErrorCount !== undefined
      ? [`console-errors ${view.browserConsoleErrorCount}`]
      : []),
    ...(view.browserConsoleWarningCount !== undefined
      ? [`console-warnings ${view.browserConsoleWarningCount}`]
      : []),
    ...(view.browserWorkspacePreviewEntryBytes !== undefined
      ? [`preview-bytes ${view.browserWorkspacePreviewEntryBytes}`]
      : []),
    ...hash("browser-console", view.browserConsoleEntriesSha256),
    ...hash("browser-preview-entry", view.browserWorkspacePreviewEntrySha256),
  ];
}

function optionalConsole(
  value: Record<string, unknown>,
):
  | Pick<
      BrowserLocalPreviewTraceView,
      | "browserConsoleEntryCount"
      | "browserConsoleErrorCount"
      | "browserConsoleWarningCount"
      | "browserConsoleEntriesSha256"
      | "browserConsoleTruncated"
    >
  | null
  | undefined {
  if (value["consoleEntryCount"] === undefined) return undefined;
  const entryCount = integer(value["consoleEntryCount"], 0, 50);
  const errorCount = integer(value["consoleErrorCount"], 0, 50);
  const warningCount = integer(value["consoleWarningCount"], 0, 50);
  if (
    entryCount === undefined ||
    errorCount === undefined ||
    warningCount === undefined ||
    errorCount + warningCount !== entryCount ||
    !sha256(value["consoleEntriesSha256"]) ||
    typeof value["consoleTruncated"] !== "boolean"
  ) {
    return null;
  }
  return {
    browserConsoleEntryCount: entryCount,
    browserConsoleErrorCount: errorCount,
    browserConsoleWarningCount: warningCount,
    browserConsoleEntriesSha256: value["consoleEntriesSha256"],
    browserConsoleTruncated: value["consoleTruncated"],
  };
}

function optionalWorkspacePreview(
  value: Record<string, unknown>,
):
  | Pick<
      BrowserLocalPreviewTraceView,
      | "browserWorkspacePreviewEntryPathSha256"
      | "browserWorkspacePreviewEntrySha256"
      | "browserWorkspacePreviewEntryBytes"
    >
  | null
  | undefined {
  if (value["workspacePreviewEntrySha256"] === undefined) return undefined;
  const bytes = integer(
    value["workspacePreviewEntryBytes"],
    1,
    16 * 1024 * 1024,
  );
  if (
    !sha256(value["workspacePreviewEntryPathSha256"]) ||
    !sha256(value["workspacePreviewEntrySha256"]) ||
    bytes === undefined
  ) {
    return null;
  }
  return {
    browserWorkspacePreviewEntryPathSha256:
      value["workspacePreviewEntryPathSha256"],
    browserWorkspacePreviewEntrySha256: value["workspacePreviewEntrySha256"],
    browserWorkspacePreviewEntryBytes: bytes,
  };
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

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function hash(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}
