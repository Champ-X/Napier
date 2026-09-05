import type { BrowserSessionDetails } from "../src/index.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";

export function browserOperationDetails(
  action: BrowserSessionDetails["action"],
  operation: number,
): BrowserSessionDetails {
  return {
    kind: "napier.browser-session-operation",
    schemaVersion: 2,
    action,
    sessionMode: "run_persistent",
    sessionReused: operation > 1,
    sessionOperation: operation,
    sessionIdSha256: "a".repeat(64),
    activeTabId: "tab_1",
    tabCount: 1,
    tabSetSha256: sha256(canonicalJson(["tab_1"])),
    browserExecutableSha256: "b".repeat(64),
    browserVersionSha256: "c".repeat(64),
    limitsSha256: "d".repeat(64),
    currentUrlSha256: "e".repeat(64),
    currentOriginSha256: "f".repeat(64),
    titleSha256: "1".repeat(64),
    ...(action === "screenshot"
      ? {
          screenshotSha256: "2".repeat(64),
          screenshotBytes: 17,
        }
      : {}),
    blockedRequestCount: 0,
    network: {
      requestCount: operation,
      connectCount: 1,
      rejectedCount: 0,
      transferredBytes: 100,
      destinationCount: 1,
      destinationsSha256: "3".repeat(64),
    },
    crossOriginAuthorized: false,
  };
}
