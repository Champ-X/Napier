export interface BrowserObservationTraceView {
  browserFindQuerySha256?: string;
  browserFindQueryChars?: number;
  browserFindMatchCount?: number;
  browserFindMatchesSha256?: string;
  browserFindScannedChars?: number;
  browserFindTruncated?: boolean;
  browserScrollDeltaY?: number;
  browserScrollPositionY?: number;
  browserScrollViewportHeight?: number;
  browserScrollDocumentHeight?: number;
  browserScrollAtStart?: boolean;
  browserScrollAtEnd?: boolean;
  browserViewportTextSha256?: string;
  browserViewportTextChars?: number;
  browserViewportTextTruncated?: boolean;
}

export function browserObservationEvidence(
  action: "find" | "scroll" | "other",
  value: Record<string, unknown>,
): BrowserObservationTraceView | null | undefined {
  const find = optionalFind(value);
  const scroll = optionalScroll(value);
  if (find === null || scroll === null) return null;
  if (Boolean(find) !== (action === "find")) return null;
  if (Boolean(scroll) !== (action === "scroll")) return null;
  return { ...(find ?? {}), ...(scroll ?? {}) };
}

export function browserObservationSummaryParts(
  view: BrowserObservationTraceView,
): string[] {
  return [
    ...(view.browserFindMatchCount !== undefined
      ? [`find-matches ${view.browserFindMatchCount}`]
      : []),
    ...(view.browserFindScannedChars !== undefined
      ? [`find-scanned-chars ${view.browserFindScannedChars}`]
      : []),
    ...(view.browserFindTruncated ? ["find-truncated"] : []),
    ...(view.browserScrollDeltaY !== undefined
      ? [`scroll-delta ${view.browserScrollDeltaY}`]
      : []),
    ...(view.browserScrollPositionY !== undefined
      ? [`scroll-position ${view.browserScrollPositionY}`]
      : []),
    ...(view.browserScrollAtStart ? ["scroll-at-start"] : []),
    ...(view.browserScrollAtEnd ? ["scroll-at-end"] : []),
    ...(view.browserViewportTextChars !== undefined
      ? [`viewport-chars ${view.browserViewportTextChars}`]
      : []),
    ...(view.browserViewportTextTruncated ? ["viewport-truncated"] : []),
  ];
}

function optionalFind(
  value: Record<string, unknown>,
):
  | Pick<
      BrowserObservationTraceView,
      | "browserFindQuerySha256"
      | "browserFindQueryChars"
      | "browserFindMatchCount"
      | "browserFindMatchesSha256"
      | "browserFindScannedChars"
      | "browserFindTruncated"
    >
  | null
  | undefined {
  const present = FIND_FIELDS.some((field) => value[field] !== undefined);
  if (!present) return undefined;
  const queryChars = integer(value["findQueryChars"], 1, 256);
  const matchCount = integer(value["findMatchCount"], 0, 20);
  const scannedChars = integer(value["findScannedChars"], 0, 2_000_000);
  if (
    !sha256(value["findQuerySha256"]) ||
    queryChars === undefined ||
    matchCount === undefined ||
    !sha256(value["findMatchesSha256"]) ||
    scannedChars === undefined ||
    typeof value["findTruncated"] !== "boolean"
  ) {
    return null;
  }
  return {
    browserFindQuerySha256: value["findQuerySha256"],
    browserFindQueryChars: queryChars,
    browserFindMatchCount: matchCount,
    browserFindMatchesSha256: value["findMatchesSha256"],
    browserFindScannedChars: scannedChars,
    browserFindTruncated: value["findTruncated"],
  };
}

function optionalScroll(
  value: Record<string, unknown>,
):
  | Pick<
      BrowserObservationTraceView,
      | "browserScrollDeltaY"
      | "browserScrollPositionY"
      | "browserScrollViewportHeight"
      | "browserScrollDocumentHeight"
      | "browserScrollAtStart"
      | "browserScrollAtEnd"
      | "browserViewportTextSha256"
      | "browserViewportTextChars"
      | "browserViewportTextTruncated"
    >
  | null
  | undefined {
  const present = SCROLL_FIELDS.some((field) => value[field] !== undefined);
  if (!present) return undefined;
  const deltaY = integer(value["scrollDeltaY"], -5_000, 5_000);
  const positionY = integer(value["scrollPositionY"], 0, 100_000_000);
  const viewportHeight = integer(value["scrollViewportHeight"], 1, 1_000_000);
  const documentHeight = integer(value["scrollDocumentHeight"], 1, 100_000_000);
  const viewportTextChars = integer(value["viewportTextChars"], 0, 12_000);
  if (
    deltaY === undefined ||
    positionY === undefined ||
    viewportHeight === undefined ||
    documentHeight === undefined ||
    positionY > documentHeight ||
    typeof value["scrollAtStart"] !== "boolean" ||
    typeof value["scrollAtEnd"] !== "boolean" ||
    !sha256(value["viewportTextSha256"]) ||
    viewportTextChars === undefined ||
    typeof value["viewportTextTruncated"] !== "boolean"
  ) {
    return null;
  }
  return {
    browserScrollDeltaY: deltaY,
    browserScrollPositionY: positionY,
    browserScrollViewportHeight: viewportHeight,
    browserScrollDocumentHeight: documentHeight,
    browserScrollAtStart: value["scrollAtStart"],
    browserScrollAtEnd: value["scrollAtEnd"],
    browserViewportTextSha256: value["viewportTextSha256"],
    browserViewportTextChars: viewportTextChars,
    browserViewportTextTruncated: value["viewportTextTruncated"],
  };
}

const FIND_FIELDS = [
  "findQuerySha256",
  "findQueryChars",
  "findMatchCount",
  "findMatchesSha256",
  "findScannedChars",
  "findTruncated",
] as const;
const SCROLL_FIELDS = [
  "scrollDeltaY",
  "scrollPositionY",
  "scrollViewportHeight",
  "scrollDocumentHeight",
  "scrollAtStart",
  "scrollAtEnd",
  "viewportTextSha256",
  "viewportTextChars",
  "viewportTextTruncated",
] as const;

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
