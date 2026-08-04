export interface ResearchSourceToolEventTraceView {
  researchSourceAction?:
    | "capture"
    | "capture_fetch"
    | "cite"
    | "verify_report"
    | "list";
  researchSourceKind?: "browser" | "web_fetch";
  researchSourceId?: string;
  researchCitationId?: string;
  researchCitationTokenSha256?: string;
  researchSourceContentSha256?: string;
  researchSourceUrlSha256?: string;
  researchSourceOriginSha256?: string;
  researchSourceTitleSha256?: string;
  researchSourceTextSha256?: string;
  researchSourceLineCount?: number;
  researchSourceTextChars?: number;
  researchSourceTruncated?: boolean;
  researchCitationStartLine?: number;
  researchCitationEndLine?: number;
  researchCitationQuoteSha256?: string;
  researchCitationClaimSha256?: string;
  researchReportPathSha256?: string;
  researchReportFileSha256?: string;
  researchReportFileBytes?: number;
  researchReportCitationCount?: number;
  researchReportCitationSetSha256?: string;
  researchSourceCount?: number;
  researchCitationCount?: number;
  researchSourceSetSha256?: string;
  researchBrowserSessionOperation?: number;
  researchBrowserSessionIdSha256?: string;
  researchBrowserExecutableSha256?: string;
  researchBrowserVersionSha256?: string;
  researchBrowserLimitsSha256?: string;
  researchBrowserNetworkDestinationsSha256?: string;
  researchWebSourceContentSha256?: string;
  researchWebSourceBodySha256?: string;
  researchWebSourceFormat?: "html" | "markdown" | "json" | "text" | "pdf";
  researchWebSourceLineCount?: number;
  researchWebSourceRenderMode?: "static" | "browser_fallback";
  researchBrowserFallbackStatus?: "not_needed" | "used" | "unavailable";
  researchBrowserFallbackDiagnostic?:
    | "browser_unavailable"
    | "browser_render_not_useful"
    | "fallback_limit_reached";
  researchWebFetchBrowserSessionOperation?: number;
  researchWebFetchBrowserSessionIdSha256?: string;
  researchWebFetchBrowserExecutableSha256?: string;
  researchWebFetchBrowserVersionSha256?: string;
  researchWebFetchBrowserLimitsSha256?: string;
  researchWebFetchBrowserNetworkDestinationsSha256?: string;
}
