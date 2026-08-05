import type { ResearchSourceToolEventTraceView } from "./research-source-event-model";

const WEB_FETCH_BROWSER_FIELDS = [
  "webFetchBrowserSessionOperation",
  "webFetchBrowserSessionIdSha256",
  "webFetchBrowserExecutableSha256",
  "webFetchBrowserVersionSha256",
  "webFetchBrowserLimitsSha256",
  "webFetchBrowserNetworkDestinationsSha256",
] as const;

export function researchWebFetchProvenance(
  value: Record<string, unknown>,
): ResearchSourceToolEventTraceView | undefined {
  const format = value["webSourceFormat"];
  const lineCount = integer(value["webSourceLineCount"], 1, 20_000);
  const legacyStatic =
    value["webSourceRenderMode"] === undefined &&
    value["browserFallbackStatus"] === undefined &&
    value["browserFallbackDiagnostic"] === undefined &&
    WEB_FETCH_BROWSER_FIELDS.every((field) => value[field] === undefined);
  const renderMode =
    legacyStatic || value["webSourceRenderMode"] === "static"
      ? "static"
      : value["webSourceRenderMode"] === "browser_fallback"
        ? "browser_fallback"
        : undefined;
  const fallbackStatus =
    legacyStatic || value["browserFallbackStatus"] === "not_needed"
      ? "not_needed"
      : value["browserFallbackStatus"] === "used" ||
          value["browserFallbackStatus"] === "unavailable"
        ? value["browserFallbackStatus"]
        : undefined;
  if (
    !isWebSourceFormat(format) ||
    lineCount === undefined ||
    !renderMode ||
    !fallbackStatus ||
    !sha256(value["webSourceContentSha256"]) ||
    !sha256(value["webSourceBodySha256"]) ||
    !validFallback(value, format, renderMode, fallbackStatus)
  ) {
    return undefined;
  }
  return {
    researchWebSourceContentSha256: value["webSourceContentSha256"],
    researchWebSourceBodySha256: value["webSourceBodySha256"],
    researchWebSourceFormat: format,
    researchWebSourceLineCount: lineCount,
    researchWebSourceRenderMode: renderMode,
    researchBrowserFallbackStatus: fallbackStatus,
    ...(fallbackStatus === "unavailable"
      ? {
          researchBrowserFallbackDiagnostic: value[
            "browserFallbackDiagnostic"
          ] as NonNullable<
            ResearchSourceToolEventTraceView["researchBrowserFallbackDiagnostic"]
          >,
        }
      : {}),
    ...(fallbackStatus === "used"
      ? {
          researchWebFetchBrowserSessionOperation: value[
            "webFetchBrowserSessionOperation"
          ] as number,
          researchWebFetchBrowserSessionIdSha256: value[
            "webFetchBrowserSessionIdSha256"
          ] as string,
          researchWebFetchBrowserExecutableSha256: value[
            "webFetchBrowserExecutableSha256"
          ] as string,
          researchWebFetchBrowserVersionSha256: value[
            "webFetchBrowserVersionSha256"
          ] as string,
          researchWebFetchBrowserLimitsSha256: value[
            "webFetchBrowserLimitsSha256"
          ] as string,
          researchWebFetchBrowserNetworkDestinationsSha256: value[
            "webFetchBrowserNetworkDestinationsSha256"
          ] as string,
        }
      : {}),
  };
}

function validFallback(
  value: Record<string, unknown>,
  format: NonNullable<
    ResearchSourceToolEventTraceView["researchWebSourceFormat"]
  >,
  renderMode: NonNullable<
    ResearchSourceToolEventTraceView["researchWebSourceRenderMode"]
  >,
  status: NonNullable<
    ResearchSourceToolEventTraceView["researchBrowserFallbackStatus"]
  >,
): boolean {
  if (status === "used") {
    return (
      format === "html" &&
      renderMode === "browser_fallback" &&
      value["browserFallbackDiagnostic"] === undefined &&
      integer(value["webFetchBrowserSessionOperation"], 1, 64) !== undefined &&
      WEB_FETCH_BROWSER_FIELDS.slice(1).every((field) => sha256(value[field]))
    );
  }
  if (WEB_FETCH_BROWSER_FIELDS.some((field) => value[field] !== undefined)) {
    return false;
  }
  if (status === "unavailable") {
    return (
      format === "html" &&
      renderMode === "static" &&
      (value["browserFallbackDiagnostic"] === "browser_unavailable" ||
        value["browserFallbackDiagnostic"] === "browser_render_not_useful" ||
        value["browserFallbackDiagnostic"] === "fallback_limit_reached" ||
        value["browserFallbackDiagnostic"] === "login_required" ||
        value["browserFallbackDiagnostic"] === "challenge_detected")
    );
  }
  return (
    renderMode === "static" && value["browserFallbackDiagnostic"] === undefined
  );
}

function isWebSourceFormat(
  value: unknown,
): value is NonNullable<
  ResearchSourceToolEventTraceView["researchWebSourceFormat"]
> {
  return ["html", "markdown", "json", "text", "pdf"].includes(String(value));
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
