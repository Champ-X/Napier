import { canonicalJson, sha256 } from "./ed25519.js";
import type {
  ResearchSourceCapture,
  ResearchSourceToolDetails,
} from "./research-source-model.js";

export interface ResearchSourceEvidenceRecord {
  id: string;
  capture: ResearchSourceCapture;
  origin: string;
  textSha256: string;
}

export function researchSourceDetails(
  action: "capture" | "capture_fetch" | "cite",
  counts: Pick<
    ResearchSourceToolDetails,
    "sourceCount" | "citationCount" | "sourceSetSha256"
  >,
  source: ResearchSourceEvidenceRecord,
): ResearchSourceToolDetails {
  return {
    kind: "napier.research-source",
    schemaVersion: 1,
    action,
    sourceKind: source.capture.kind,
    sourceId: source.id,
    sourceContentSha256: source.capture.capturedContentSha256,
    sourceUrlSha256: sha256(source.capture.url),
    sourceOriginSha256: sha256(source.origin),
    sourceTitleSha256: sha256(source.capture.title),
    sourceTextSha256: source.textSha256,
    sourceLineCount: source.capture.lines.length,
    sourceTextChars: source.capture.textChars,
    sourceTruncated: source.capture.truncated,
    ...counts,
    ...(source.capture.kind === "browser"
      ? {
          browserSessionOperation: source.capture.browser.sessionOperation,
          browserSessionIdSha256: source.capture.browser.sessionIdSha256,
          browserExecutableSha256: source.capture.browser.executableSha256,
          browserVersionSha256: source.capture.browser.versionSha256,
          browserLimitsSha256: source.capture.browser.limitsSha256,
          browserNetworkDestinationsSha256:
            source.capture.browser.network.destinationsSha256,
        }
      : {
          webSourceContentSha256: source.capture.webFetch.sourceContentSha256,
          webSourceBodySha256: source.capture.webFetch.sourceBodySha256,
          webSourceFormat: source.capture.webFetch.sourceFormat,
          webSourceLineCount: source.capture.webFetch.sourceLineCount,
          webSourceRenderMode: source.capture.webFetch.renderMode,
          browserFallbackStatus: source.capture.webFetch.browserFallbackStatus,
          ...(source.capture.webFetch.browserFallbackDiagnostic
            ? {
                browserFallbackDiagnostic:
                  source.capture.webFetch.browserFallbackDiagnostic,
              }
            : {}),
          ...(source.capture.webFetch.browserFallback
            ? {
                webFetchBrowserSessionOperation:
                  source.capture.webFetch.browserFallback.sessionOperation,
                webFetchBrowserSessionIdSha256:
                  source.capture.webFetch.browserFallback.sessionIdSha256,
                webFetchBrowserExecutableSha256:
                  source.capture.webFetch.browserFallback
                    .browserExecutableSha256,
                webFetchBrowserVersionSha256:
                  source.capture.webFetch.browserFallback.browserVersionSha256,
                webFetchBrowserLimitsSha256:
                  source.capture.webFetch.browserFallback.limitsSha256,
                webFetchBrowserNetworkDestinationsSha256:
                  source.capture.webFetch.browserFallback.network
                    .destinationsSha256,
              }
            : {}),
        }),
  };
}

export function researchRunCounts(
  sources: Iterable<Pick<ResearchSourceEvidenceRecord, "id" | "capture">>,
  citationCount: number,
): Pick<
  ResearchSourceToolDetails,
  "sourceCount" | "citationCount" | "sourceSetSha256"
> {
  const projected = [...sources].map((source) => ({
    id: source.id,
    kind: source.capture.kind,
    contentSha256: source.capture.capturedContentSha256,
  }));
  return {
    sourceCount: projected.length,
    citationCount,
    sourceSetSha256: sha256(canonicalJson(projected)),
  };
}
