import {
  BROWSER_LIMITS_SHA256,
  type BrowserFindObservation,
  type BrowserSessionDetails,
  type BrowserSessionFileEvidence,
  type BrowserSessionRequest,
  type BrowserScrollObservation,
} from "./browser-session-model.js";
import type { BrowserWorkspaceFile } from "./browser-workspace-files.js";
import { sha256 } from "./ed25519.js";
import type { FixedIpProxySnapshot } from "./fixed-ip-http-proxy.js";

export interface BrowserSessionPageState {
  url: string;
  origin: string;
  title: string;
  snapshot?: string;
  snapshotTruncated?: boolean;
}

export function createBrowserSessionDetails(input: {
  action: BrowserSessionRequest["action"];
  reused: boolean;
  operation: number;
  sessionIdSha256: string;
  executableSha256: string;
  browserVersionSha256: string;
  state: BrowserSessionPageState;
  crossOriginAuthorized: boolean;
  blockedRequestCount: number;
  network: FixedIpProxySnapshot;
  file?: BrowserWorkspaceFile;
  suggestedFilenameSha256?: string;
  screenshot?: Buffer;
  find?: BrowserFindObservation;
  scroll?: BrowserScrollObservation;
}): BrowserSessionDetails {
  return {
    kind: "napier.browser-session-operation",
    schemaVersion: 1,
    action: input.action,
    sessionMode: "run_persistent",
    sessionReused: input.reused,
    sessionOperation: input.operation,
    sessionIdSha256: input.sessionIdSha256,
    browserExecutableSha256: input.executableSha256,
    browserVersionSha256: input.browserVersionSha256,
    limitsSha256: BROWSER_LIMITS_SHA256,
    currentUrlSha256: sha256(input.state.url),
    currentOriginSha256: sha256(input.state.origin),
    titleSha256: sha256(input.state.title),
    ...(input.state.snapshot !== undefined
      ? {
          snapshotSha256: sha256(input.state.snapshot),
          snapshotChars: input.state.snapshot.length,
          snapshotTruncated: input.state.snapshotTruncated === true,
        }
      : {}),
    ...(input.find
      ? {
          findQuerySha256: input.find.querySha256,
          findQueryChars: input.find.queryChars,
          findMatchCount: input.find.matchCount,
          findMatchesSha256: input.find.matchesSha256,
          findScannedChars: input.find.scannedChars,
          findTruncated: input.find.truncated,
        }
      : {}),
    ...(input.scroll
      ? {
          scrollDeltaY: input.scroll.deltaY,
          scrollPositionY: input.scroll.positionY,
          scrollViewportHeight: input.scroll.viewportHeight,
          scrollDocumentHeight: input.scroll.documentHeight,
          scrollAtStart: input.scroll.atStart,
          scrollAtEnd: input.scroll.atEnd,
          viewportTextSha256: input.scroll.viewportTextSha256,
          viewportTextChars: input.scroll.viewportTextChars,
          viewportTextTruncated: input.scroll.viewportTextTruncated,
        }
      : {}),
    ...(input.screenshot
      ? {
          screenshotSha256: sha256(input.screenshot),
          screenshotBytes: input.screenshot.byteLength,
        }
      : {}),
    ...(input.file ? { file: fileEvidence(input.file) } : {}),
    ...(input.suggestedFilenameSha256
      ? { suggestedFilenameSha256: input.suggestedFilenameSha256 }
      : {}),
    blockedRequestCount: input.blockedRequestCount,
    network: structuredClone(input.network),
    crossOriginAuthorized: input.crossOriginAuthorized,
  };
}

function fileEvidence(file: BrowserWorkspaceFile): BrowserSessionFileEvidence {
  return {
    pathSha256: file.pathSha256,
    fileSha256: file.fileSha256,
    fileBytes: file.fileBytes,
  };
}
