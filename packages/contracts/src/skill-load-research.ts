import { canonical, exact, hex, integer, object, sha256 } from "./skill-load-validation.js";

type Sha = string;
type ReportArtifactRegistration = "registered" | "no_run_bound_plan" | "no_matching_artifact" | "artifact_not_expected" | "artifact_registration_failed";
type EvidenceCommon<Action extends string> = {
  kind: "napier.research-source-evidence";
  schemaVersion: 1;
  action: Action;
  sourceCount: number;
  citationCount: number;
  sourceSetSha256: Sha;
  inputContentSha256: Sha;
  continuityCapsuleContentSha256?: Sha;
};
type SourceCommon = {
  sourceId: string;
  sourceContentSha256: Sha;
  sourceUrlSha256: Sha;
  sourceOriginSha256: Sha;
  sourceTitleSha256: Sha;
  sourceTextSha256: Sha;
  sourceLineCount: number;
  sourceTextChars: number;
  sourceTruncated: boolean;
};
type BrowserProvenance = {
  sourceKind: "browser";
  browserSessionOperation: number;
  browserSessionIdSha256: Sha;
  browserActiveTabIdSha256: Sha;
  browserTabCount: number;
  browserTabSetSha256: Sha;
  browserExecutableSha256: Sha;
  browserVersionSha256: Sha;
  browserLimitsSha256: Sha;
  browserNetworkDestinationsSha256: Sha;
};
type WebBase = {
  sourceKind: "web_fetch";
  webSourceContentSha256: Sha;
  webSourceBodySha256: Sha;
  webSourceFormat: "html" | "markdown" | "json" | "text" | "pdf";
  webSourceLineCount: number;
};
type WebStatic = WebBase & {
  webSourceRenderMode: "static";
  browserFallbackStatus: "not_needed";
};
type WebUnavailable = WebBase & {
  webSourceFormat: "html";
  webSourceRenderMode: "static";
  browserFallbackStatus: "unavailable";
  browserFallbackDiagnostic: "browser_unavailable" | "browser_render_not_useful" | "fallback_limit_reached" | "login_required" | "challenge_detected";
};
type WebFallback = WebBase & {
  webSourceFormat: "html";
  webSourceRenderMode: "browser_fallback";
  browserFallbackStatus: "used";
  webFetchBrowserSessionOperation: number;
  webFetchBrowserSessionIdSha256: Sha;
  webFetchBrowserActiveTabIdSha256: Sha;
  webFetchBrowserTabCount: number;
  webFetchBrowserTabSetSha256: Sha;
  webFetchBrowserExecutableSha256: Sha;
  webFetchBrowserVersionSha256: Sha;
  webFetchBrowserLimitsSha256: Sha;
  webFetchBrowserNetworkDestinationsSha256: Sha;
};
type WebProvenance = WebStatic | WebUnavailable | WebFallback;
type Citation = {
  citationId: string;
  citationTokenSha256: Sha;
  citationStartLine: number;
  citationEndLine: number;
  citationQuoteSha256: Sha;
  citationClaimSha256: Sha;
};
type BrowserCaptureEvidence = EvidenceCommon<"capture"> & SourceCommon & BrowserProvenance;
type WebCaptureEvidence = EvidenceCommon<"capture_fetch"> & SourceCommon & WebProvenance;
type BrowserCitationEvidence = EvidenceCommon<"cite"> & SourceCommon & BrowserProvenance & Citation;
type WebCitationEvidence = EvidenceCommon<"cite"> & SourceCommon & WebProvenance & Citation;
export type SourceEvidence = BrowserCaptureEvidence | WebCaptureEvidence | BrowserCitationEvidence | WebCitationEvidence;
export type ResearchSourceEvidenceV1 =
  | EvidenceCommon<"list">
  | BrowserCaptureEvidence
  | WebCaptureEvidence
  | BrowserCitationEvidence
  | WebCitationEvidence
  | (EvidenceCommon<"verify_report"> & {
      reportPathSha256: Sha;
      reportFileSha256: Sha;
      reportFileBytes: number;
      reportCitationCount: number;
      reportCitationSetSha256: Sha;
      reportArtifactRegistration?: ReportArtifactRegistration;
    });

const SOURCE_ID = /^source_[a-z0-9]{8,80}$/u;
const CITATION_ID = /^citation_[a-z0-9]{8,80}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;
const COMMON = ["kind", "schemaVersion", "action", "sourceCount", "citationCount", "sourceSetSha256"];
const SOURCE = ["sourceKind", "sourceId", "sourceContentSha256", "sourceUrlSha256", "sourceOriginSha256", "sourceTitleSha256", "sourceTextSha256", "sourceLineCount", "sourceTextChars", "sourceTruncated"];
const BROWSER = ["browserSessionOperation", "browserSessionIdSha256", "browserActiveTabId", "browserTabCount", "browserTabSetSha256", "browserExecutableSha256", "browserVersionSha256", "browserLimitsSha256", "browserNetworkDestinationsSha256"];
const WEB = ["webSourceContentSha256", "webSourceBodySha256", "webSourceFormat", "webSourceLineCount"];
const FALLBACK = ["webSourceRenderMode", "browserFallbackStatus", "browserFallbackDiagnostic", "webFetchBrowserSessionOperation", "webFetchBrowserSessionIdSha256", "webFetchBrowserActiveTabId", "webFetchBrowserTabCount", "webFetchBrowserTabSetSha256", "webFetchBrowserExecutableSha256", "webFetchBrowserVersionSha256", "webFetchBrowserLimitsSha256", "webFetchBrowserNetworkDestinationsSha256"];
const CITE = ["citationId", "citationTokenSha256", "citationStartLine", "citationEndLine", "citationQuoteSha256", "citationClaimSha256"];
const REPORT = ["reportPathSha256", "reportFileSha256", "reportFileBytes", "reportCitationCount", "reportCitationSetSha256", "reportArtifactRegistration"];
const NORMALIZED_COMMON = [...COMMON, "inputContentSha256"];
const NORMALIZED_BROWSER = ["browserSessionOperation", "browserSessionIdSha256", "browserActiveTabIdSha256", "browserTabCount", "browserTabSetSha256", "browserExecutableSha256", "browserVersionSha256", "browserLimitsSha256", "browserNetworkDestinationsSha256"];
const NORMALIZED_FALLBACK = ["webSourceRenderMode", "browserFallbackStatus", "browserFallbackDiagnostic", "webFetchBrowserSessionOperation", "webFetchBrowserSessionIdSha256", "webFetchBrowserActiveTabIdSha256", "webFetchBrowserTabCount", "webFetchBrowserTabSetSha256", "webFetchBrowserExecutableSha256", "webFetchBrowserVersionSha256", "webFetchBrowserLimitsSha256", "webFetchBrowserNetworkDestinationsSha256"];
const REGISTRATIONS = new Set(["registered", "no_run_bound_plan", "no_matching_artifact", "artifact_not_expected", "artifact_registration_failed"]);
const DIAGNOSTICS = new Set(["browser_unavailable", "browser_render_not_useful", "fallback_limit_reached", "login_required", "challenge_detected"]);

type EvidenceAction = ResearchSourceEvidenceV1["action"];
type Provenance = {
  keys: string[];
  normalized: BrowserProvenance | WebProvenance;
};

function capsule(value: unknown): value is Record<string, unknown> {
  return object(value) && exact(value, ["kind", "schemaVersion", "sourceRunId", "sourceCount", "citationCount", "sourceSetSha256", "capsuleSha256", "capsuleBytes", "storage", "contentSha256"]) && value.kind === "napier.research-source-capsule-receipt" && value.schemaVersion === 1 && typeof value.sourceRunId === "string" && RUN_ID.test(value.sourceRunId) && integer(value.sourceCount, 0, 16) && integer(value.citationCount, 0, 64) && hex(value.sourceSetSha256) && hex(value.capsuleSha256) && integer(value.capsuleBytes, 1, 2097152) && value.storage === "local_only" && hex(value.contentSha256);
}

function rawBase(value: Record<string, unknown>): boolean {
  return value.kind === "napier.research-source" && value.schemaVersion === 1 && integer(value.sourceCount, 0, 16) && integer(value.citationCount, 0, 64) && (Number(value.sourceCount) > 0 || value.citationCount === 0) && hex(value.sourceSetSha256) && (value.stateCapsule === undefined || capsule(value.stateCapsule));
}

function sourceBase(value: Record<string, unknown>): boolean {
  return Number(value.sourceCount) >= 1 && typeof value.sourceId === "string" && SOURCE_ID.test(value.sourceId) && ["sourceContentSha256", "sourceUrlSha256", "sourceOriginSha256", "sourceTitleSha256", "sourceTextSha256"].every((key) => hex(value[key])) && integer(value.sourceLineCount, 1, 400) && integer(value.sourceTextChars, 1, 24000) && Number(value.sourceTextChars) >= Number(value.sourceLineCount) * 2 - 1 && typeof value.sourceTruncated === "boolean";
}

function provenance(value: Record<string, unknown>): Provenance | undefined {
  if (value.sourceKind === "browser") return browserProvenance(value);
  if (!validWebBase(value)) return undefined;
  return webProvenance(value);
}

function browserProvenance(value: Record<string, unknown>): Provenance | undefined {
  if (
    !integer(value.browserSessionOperation, 1, 64) ||
    !integer(value.browserTabCount, 1, 4) ||
    typeof value.browserActiveTabId !== "string" ||
    !/^tab_[1-9][0-9]{0,3}$/u.test(value.browserActiveTabId) ||
    BROWSER.slice(1)
      .filter((key) => key !== "browserActiveTabId" && key !== "browserTabCount")
      .some((key) => !hex(value[key]))
  )
    return;
  return {
    keys: BROWSER,
    normalized: {
      sourceKind: "browser",
      browserSessionOperation: Number(value.browserSessionOperation),
      browserSessionIdSha256: String(value.browserSessionIdSha256),
      browserActiveTabIdSha256: sha256(value.browserActiveTabId),
      browserTabCount: Number(value.browserTabCount),
      browserTabSetSha256: String(value.browserTabSetSha256),
      browserExecutableSha256: String(value.browserExecutableSha256),
      browserVersionSha256: String(value.browserVersionSha256),
      browserLimitsSha256: String(value.browserLimitsSha256),
      browserNetworkDestinationsSha256: String(value.browserNetworkDestinationsSha256),
    },
  };
}

function validWebBase(value: Record<string, unknown>): boolean {
  return value.sourceKind === "web_fetch" && hex(value.webSourceContentSha256) && hex(value.webSourceBodySha256) && ["html", "markdown", "json", "text", "pdf"].includes(String(value.webSourceFormat)) && integer(value.webSourceLineCount, 1, 20000) && Number(value.webSourceLineCount) >= Number(value.sourceLineCount);
}

function webProvenance(value: Record<string, unknown>): Provenance | undefined {
  const normalized = {
    sourceKind: "web_fetch" as const,
    webSourceContentSha256: value.webSourceContentSha256 as string,
    webSourceBodySha256: value.webSourceBodySha256 as string,
    webSourceFormat: value.webSourceFormat as WebBase["webSourceFormat"],
    webSourceLineCount: value.webSourceLineCount as number,
  };
  if (FALLBACK.every((key) => value[key] === undefined))
    return {
      keys: [...WEB],
      normalized: {
        ...normalized,
        webSourceRenderMode: "static",
        browserFallbackStatus: "not_needed",
      },
    };
  const mode = value.webSourceRenderMode,
    status = value.browserFallbackStatus;
  const keys = [...WEB, "webSourceRenderMode", "browserFallbackStatus"];
  if (mode === "static" && status === "not_needed" && value.browserFallbackDiagnostic === undefined && FALLBACK.slice(3).every((key) => value[key] === undefined))
    return {
      keys,
      normalized: {
        ...normalized,
        webSourceRenderMode: "static",
        browserFallbackStatus: "not_needed",
      },
    };
  if (mode === "static" && status === "unavailable" && value.webSourceFormat === "html" && DIAGNOSTICS.has(String(value.browserFallbackDiagnostic)) && FALLBACK.slice(3).every((key) => value[key] === undefined))
    return {
      keys: [...keys, "browserFallbackDiagnostic"],
      normalized: {
        ...normalized,
        webSourceFormat: "html",
        webSourceRenderMode: "static",
        browserFallbackStatus: "unavailable",
        browserFallbackDiagnostic: value.browserFallbackDiagnostic as WebUnavailable["browserFallbackDiagnostic"],
      },
    };
  return browserFallbackProvenance(value, keys, normalized);
}

function browserFallbackProvenance(value: Record<string, unknown>, keys: string[], normalized: WebBase): Provenance | undefined {
  if (
    value.webSourceRenderMode !== "browser_fallback" ||
    value.browserFallbackStatus !== "used" ||
    value.webSourceFormat !== "html" ||
    value.browserFallbackDiagnostic !== undefined ||
    !integer(value.webFetchBrowserSessionOperation, 1, 64) ||
    !integer(value.webFetchBrowserTabCount, 1, 4) ||
    typeof value.webFetchBrowserActiveTabId !== "string" ||
    !/^tab_[1-9][0-9]{0,3}$/u.test(value.webFetchBrowserActiveTabId) ||
    FALLBACK.slice(4)
      .filter((key) => key !== "webFetchBrowserActiveTabId" && key !== "webFetchBrowserTabCount")
      .some((key) => !hex(value[key]))
  )
    return;
  return {
    keys: [...keys, ...FALLBACK.slice(3)],
    normalized: {
      ...normalized,
      webSourceFormat: "html",
      webSourceRenderMode: "browser_fallback",
      browserFallbackStatus: "used",
      webFetchBrowserSessionOperation: Number(value.webFetchBrowserSessionOperation),
      webFetchBrowserSessionIdSha256: String(value.webFetchBrowserSessionIdSha256),
      webFetchBrowserActiveTabIdSha256: sha256(value.webFetchBrowserActiveTabId),
      webFetchBrowserTabCount: Number(value.webFetchBrowserTabCount),
      webFetchBrowserTabSetSha256: String(value.webFetchBrowserTabSetSha256),
      webFetchBrowserExecutableSha256: String(value.webFetchBrowserExecutableSha256),
      webFetchBrowserVersionSha256: String(value.webFetchBrowserVersionSha256),
      webFetchBrowserLimitsSha256: String(value.webFetchBrowserLimitsSha256),
      webFetchBrowserNetworkDestinationsSha256: String(value.webFetchBrowserNetworkDestinationsSha256),
    },
  };
}

export function parseResearchSourceEvidenceV1(value: unknown): ResearchSourceEvidenceV1 | undefined {
  if (!object(value)) return;
  const input = value;
  if (input.kind === "napier.research-source-evidence") return normalizedEvidence(input);
  if (!rawBase(input)) return;
  const optional = input.stateCapsule === undefined ? [] : ["stateCapsule"];
  const base = {
    kind: "napier.research-source-evidence" as const,
    schemaVersion: 1 as const,
    action: input.action as EvidenceAction,
    sourceCount: Number(input.sourceCount),
    citationCount: Number(input.citationCount),
    sourceSetSha256: String(input.sourceSetSha256),
    inputContentSha256: sha256(canonical(input)),
    ...(input.stateCapsule
      ? {
          continuityCapsuleContentSha256: String((input.stateCapsule as Record<string, unknown>).capsuleSha256),
        }
      : {}),
  };
  if (input.action === "list") return exact(input, COMMON, optional) ? (base as ResearchSourceEvidenceV1) : undefined;
  if (input.action === "verify_report") return parseReport(input, base, optional);
  return parseSource(input, base, optional);
}

function normalizedEvidence(input: Record<string, unknown>): ResearchSourceEvidenceV1 | undefined {
  if (!normalizedBase(input)) return;
  const optional = input.continuityCapsuleContentSha256 === undefined ? [] : ["continuityCapsuleContentSha256"];
  if (input.action === "list") return exact(input, NORMALIZED_COMMON, optional) ? ({ ...input } as ResearchSourceEvidenceV1) : undefined;
  if (input.action === "verify_report") return validNormalizedReport(input, optional) ? ({ ...input } as ResearchSourceEvidenceV1) : undefined;
  return normalizedSource(input, optional);
}

function normalizedBase(input: Record<string, unknown>): boolean {
  return input.kind === "napier.research-source-evidence" && input.schemaVersion === 1 && ["list", "capture", "capture_fetch", "cite", "verify_report"].includes(String(input.action)) && integer(input.sourceCount, 0, 16) && integer(input.citationCount, 0, 64) && (Number(input.sourceCount) > 0 || input.citationCount === 0) && hex(input.sourceSetSha256) && hex(input.inputContentSha256) && (input.continuityCapsuleContentSha256 === undefined || hex(input.continuityCapsuleContentSha256));
}

function validNormalizedReport(input: Record<string, unknown>, optional: string[]): boolean {
  return exact(input, [...NORMALIZED_COMMON, ...REPORT.slice(0, 5)], [...optional, "reportArtifactRegistration"]) && Number(input.sourceCount) >= 1 && Number(input.citationCount) >= 1 && hex(input.reportPathSha256) && hex(input.reportFileSha256) && integer(input.reportFileBytes, 1, 262144) && integer(input.reportCitationCount, 1, 64) && Number(input.reportCitationCount) <= Number(input.citationCount) && hex(input.reportCitationSetSha256) && (input.reportArtifactRegistration === undefined || REGISTRATIONS.has(String(input.reportArtifactRegistration)));
}

function normalizedSource(input: Record<string, unknown>, optional: string[]): ResearchSourceEvidenceV1 | undefined {
  if (!["capture", "capture_fetch", "cite"].includes(String(input.action)) || !sourceBase(input)) return;
  const provenanceKeys = normalizedProvenance(input);
  const cite = input.action === "cite";
  if (!provenanceKeys || (input.action === "capture" && input.sourceKind !== "browser") || (input.action === "capture_fetch" && input.sourceKind !== "web_fetch") || !exact(input, [...NORMALIZED_COMMON, ...SOURCE, ...provenanceKeys, ...(cite ? CITE : [])], optional) || (cite && !validCitation(input))) return;
  return { ...input } as ResearchSourceEvidenceV1;
}

function normalizedProvenance(input: Record<string, unknown>): string[] | undefined {
  if (input.sourceKind === "browser") return validNormalizedBrowser(input) ? NORMALIZED_BROWSER : undefined;
  if (!validWebBase(input)) return;
  const base = [...WEB, "webSourceRenderMode", "browserFallbackStatus"];
  if (input.webSourceRenderMode === "static" && input.browserFallbackStatus === "not_needed" && input.browserFallbackDiagnostic === undefined && NORMALIZED_FALLBACK.slice(3).every((key) => input[key] === undefined)) return base;
  if (input.webSourceRenderMode === "static" && input.browserFallbackStatus === "unavailable" && input.webSourceFormat === "html" && DIAGNOSTICS.has(String(input.browserFallbackDiagnostic)) && NORMALIZED_FALLBACK.slice(3).every((key) => input[key] === undefined)) return [...base, "browserFallbackDiagnostic"];
  return validNormalizedFallback(input) ? [...base, ...NORMALIZED_FALLBACK.slice(3)] : undefined;
}

function validNormalizedBrowser(input: Record<string, unknown>): boolean {
  return integer(input.browserSessionOperation, 1, 64) && integer(input.browserTabCount, 1, 4) && ["browserSessionIdSha256", "browserActiveTabIdSha256", "browserTabSetSha256", "browserExecutableSha256", "browserVersionSha256", "browserLimitsSha256", "browserNetworkDestinationsSha256"].every((key) => hex(input[key]));
}

function validNormalizedFallback(input: Record<string, unknown>): boolean {
  return input.webSourceRenderMode === "browser_fallback" && input.browserFallbackStatus === "used" && input.webSourceFormat === "html" && input.browserFallbackDiagnostic === undefined && integer(input.webFetchBrowserSessionOperation, 1, 64) && integer(input.webFetchBrowserTabCount, 1, 4) && ["webFetchBrowserSessionIdSha256", "webFetchBrowserActiveTabIdSha256", "webFetchBrowserTabSetSha256", "webFetchBrowserExecutableSha256", "webFetchBrowserVersionSha256", "webFetchBrowserLimitsSha256", "webFetchBrowserNetworkDestinationsSha256"].every((key) => hex(input[key]));
}

function parseReport(input: Record<string, unknown>, base: EvidenceCommon<EvidenceAction>, optional: string[]): ResearchSourceEvidenceV1 | undefined {
  const opt = [...optional, "reportArtifactRegistration"];
  if (!validReport(input, opt)) return;
  return {
    ...base,
    action: "verify_report",
    reportPathSha256: input.reportPathSha256,
    reportFileSha256: input.reportFileSha256,
    reportFileBytes: input.reportFileBytes,
    reportCitationCount: input.reportCitationCount,
    reportCitationSetSha256: input.reportCitationSetSha256,
    ...(input.reportArtifactRegistration ? { reportArtifactRegistration: input.reportArtifactRegistration } : {}),
  } as ResearchSourceEvidenceV1;
}

function validReport(input: Record<string, unknown>, optional: string[]): boolean {
  return exact(input, [...COMMON, ...REPORT.slice(0, 5)], optional) && Number(input.sourceCount) >= 1 && Number(input.citationCount) >= 1 && hex(input.reportPathSha256) && hex(input.reportFileSha256) && integer(input.reportFileBytes, 1, 262144) && integer(input.reportCitationCount, 1, 64) && Number(input.reportCitationCount) <= Number(input.citationCount) && hex(input.reportCitationSetSha256) && (input.reportArtifactRegistration === undefined || REGISTRATIONS.has(String(input.reportArtifactRegistration)));
}

function parseSource(input: Record<string, unknown>, base: EvidenceCommon<EvidenceAction>, optional: string[]): ResearchSourceEvidenceV1 | undefined {
  if (!["capture", "capture_fetch", "cite"].includes(String(input.action)) || !sourceBase(input)) return;
  const prov = provenance(input);
  if (!prov || (input.action === "capture" && input.sourceKind !== "browser") || (input.action === "capture_fetch" && input.sourceKind !== "web_fetch")) return;
  const cite = input.action === "cite";
  if (!exact(input, [...COMMON, ...SOURCE, ...prov.keys, ...(cite ? CITE : [])], optional) || (cite && !validCitation(input))) return;
  return {
    ...base,
    action: input.action,
    sourceId: String(input.sourceId),
    sourceContentSha256: String(input.sourceContentSha256),
    sourceUrlSha256: String(input.sourceUrlSha256),
    sourceOriginSha256: String(input.sourceOriginSha256),
    sourceTitleSha256: String(input.sourceTitleSha256),
    sourceTextSha256: String(input.sourceTextSha256),
    sourceLineCount: Number(input.sourceLineCount),
    sourceTextChars: Number(input.sourceTextChars),
    sourceTruncated: Boolean(input.sourceTruncated),
    ...prov.normalized,
    ...(cite ? Object.fromEntries(CITE.map((key) => [key, input[key]])) : {}),
  } as ResearchSourceEvidenceV1;
}

function validCitation(input: Record<string, unknown>): boolean {
  return integer(input.citationStartLine, 1, 400) && integer(input.citationEndLine, 1, 400) && Number(input.citationStartLine) <= Number(input.citationEndLine) && Number(input.citationEndLine) <= Number(input.sourceLineCount) && Number(input.citationEndLine) - Number(input.citationStartLine) + 1 <= 40 && Number(input.citationCount) >= 1 && typeof input.citationId === "string" && CITATION_ID.test(input.citationId) && ["citationTokenSha256", "citationQuoteSha256", "citationClaimSha256"].every((key) => hex(input[key]));
}
