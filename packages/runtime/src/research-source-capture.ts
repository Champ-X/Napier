import {
  MAX_BROWSER_SESSION_OPERATIONS,
  type BrowserPageSourceCapture,
} from "./browser-session-model.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  MAX_PROXY_REQUESTS,
  MAX_PROXY_TRANSFER_BYTES,
} from "./fixed-ip-http-proxy.js";
import { validatePublicHttpUrl } from "./public-network.js";

const SHA256 = /^[a-f0-9]{64}$/u;

export function validateResearchBrowserCapture(
  capture: BrowserPageSourceCapture,
  maxChars: number,
): URL {
  const url = validatePublicHttpUrl(capture.url);
  const text = capture.lines.join("\n");
  const network = capture.network;
  if (
    capture.url.length > 4_096 ||
    capture.title.length > 512 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(capture.title) ||
    capture.lines.length < 1 ||
    capture.lines.length > 400 ||
    capture.lines.some(
      (line) =>
        !line ||
        line.length > 1_000 ||
        /[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(line),
    ) ||
    !Number.isSafeInteger(capture.textChars) ||
    capture.textChars !== text.length ||
    capture.textChars > maxChars ||
    typeof capture.truncated !== "boolean" ||
    captureContentSha256(capture) !== capture.capturedContentSha256 ||
    !Number.isSafeInteger(capture.sessionOperation) ||
    capture.sessionOperation < 1 ||
    capture.sessionOperation > MAX_BROWSER_SESSION_OPERATIONS ||
    !SHA256.test(capture.sessionIdSha256) ||
    !SHA256.test(capture.browserExecutableSha256) ||
    !SHA256.test(capture.browserVersionSha256) ||
    !SHA256.test(capture.limitsSha256) ||
    !validNetworkCount(network.requestCount, MAX_PROXY_REQUESTS) ||
    !validNetworkCount(network.connectCount, MAX_PROXY_REQUESTS) ||
    !validNetworkCount(network.rejectedCount, MAX_PROXY_REQUESTS) ||
    !validNetworkCount(network.destinationCount, MAX_PROXY_REQUESTS) ||
    !validNetworkCount(network.transferredBytes, MAX_PROXY_TRANSFER_BYTES) ||
    network.connectCount > network.requestCount ||
    network.rejectedCount > network.requestCount ||
    network.destinationCount > network.requestCount ||
    !SHA256.test(network.destinationsSha256)
  ) {
    throw new Error("Browser Source capture binding is invalid");
  }
  return url;
}

function captureContentSha256(capture: BrowserPageSourceCapture): string {
  return sha256(
    canonicalJson({
      url: capture.url,
      title: capture.title,
      lines: capture.lines,
      truncated: capture.truncated,
    }),
  );
}

function validNetworkCount(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}
