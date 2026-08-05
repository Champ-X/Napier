import path from "node:path";

import {
  type BrowserTakeoverActionReceipt,
  type BrowserTakeoverSnapshot,
  type ExecuteBrowserTakeoverActionRequest,
} from "@napier/contracts/browser-takeover";

import {
  MAX_BROWSER_SCROLL_PIXELS,
  MAX_BROWSER_WAIT_MS,
  type BrowserSessionDetails,
} from "./browser-session-model.js";
import { validateBrowserTakeoverTabResult } from "./browser-takeover-tabs.js";
import {
  browserVisualActionEvidence,
  validBrowserVisualTakeoverAction,
} from "./browser-takeover-visual.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId, nowIso } from "./ids.js";
import { validatePublicHttpUrl } from "./public-network.js";

export interface BrowserTakeoverSnapshotBinding {
  pauseStateSha256: string;
  sessionIdSha256: string;
  sessionOperation: number;
  snapshotSha256: string;
  activeTabIdSha256: string;
  tabCount: number;
  tabSetSha256: string;
  tabIdSha256s: string[];
}

export function browserTakeoverSnapshotBinding(
  snapshot: BrowserTakeoverSnapshot,
): BrowserTakeoverSnapshotBinding {
  return {
    pauseStateSha256: snapshot.pauseStateSha256,
    sessionIdSha256: snapshot.sessionIdSha256,
    sessionOperation: snapshot.sessionOperation,
    snapshotSha256: snapshot.snapshotSha256,
    activeTabIdSha256: sha256(snapshot.activeTabId),
    tabCount: snapshot.tabCount,
    tabSetSha256: snapshot.tabSetSha256,
    tabIdSha256s: snapshot.tabs.map((tab) => sha256(tab.tabId)),
  };
}

export function createBrowserTakeoverActionReceipt(
  owner: { threadId: string; runId: string },
  request: ExecuteBrowserTakeoverActionRequest,
  status: BrowserTakeoverActionReceipt["status"],
  options: {
    requested?: BrowserTakeoverActionReceipt;
    details?: BrowserSessionDetails;
  } = {},
): BrowserTakeoverActionReceipt {
  const requestedAt = options.requested?.requestedAt ?? nowIso();
  const content = {
    kind: "napier.browser-takeover-action" as const,
    schemaVersion: 3 as const,
    id:
      options.requested?.id ??
      (createId("browser_takeover") as `browser_takeover_${string}`),
    ...owner,
    action: request.action,
    status,
    requestSha256:
      options.requested?.requestSha256 ?? sha256(canonicalJson(request)),
    pauseStateSha256: request.expectedPauseStateSha256,
    sourceSessionIdSha256: request.expectedSessionIdSha256,
    sourceSessionOperation: request.expectedSessionOperation,
    sourceSnapshotSha256: request.expectedSnapshotSha256,
    sourceActiveTabId: request.expectedActiveTabId,
    sourceTabCount: request.expectedTabCount,
    sourceTabSetSha256: request.expectedTabSetSha256,
    ...actionEvidence(request),
    crossOriginAuthorized:
      "allowCrossOrigin" in request && request.allowCrossOrigin === true,
    requestedAt,
    ...(status === "requested" ? {} : { settledAt: nowIso() }),
    ...detailsEvidence(options.details),
    ...(status === "failed"
      ? { failureCode: "browser_action_failed" as const }
      : {}),
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export function validateBrowserTakeoverActionRequest(
  request: ExecuteBrowserTakeoverActionRequest,
): void {
  if (
    !isSha256(request.expectedPauseStateSha256) ||
    !isSha256(request.expectedSessionIdSha256) ||
    !isSha256(request.expectedSnapshotSha256) ||
    !isTabId(request.expectedActiveTabId) ||
    !Number.isSafeInteger(request.expectedTabCount) ||
    request.expectedTabCount < 1 ||
    request.expectedTabCount > 4 ||
    !isSha256(request.expectedTabSetSha256) ||
    !Number.isSafeInteger(request.expectedSessionOperation) ||
    request.expectedSessionOperation < 0 ||
    !validAction(request)
  ) {
    throw new Error("Browser takeover request is invalid");
  }
}

export function validateBrowserTakeoverActionResult(
  request: ExecuteBrowserTakeoverActionRequest,
  details: BrowserSessionDetails,
  snapshot: BrowserTakeoverSnapshotBinding,
): void {
  if (
    details.action !== request.action ||
    details.sessionIdSha256 !== request.expectedSessionIdSha256 ||
    details.sessionOperation !== request.expectedSessionOperation + 1 ||
    !validOutputEvidence(request, details)
  ) {
    throw new Error("Browser takeover action evidence is invalid");
  }
  validateBrowserTakeoverTabResult(request, details, {
    activeTabId: request.expectedActiveTabId,
    tabCount: snapshot.tabCount,
    tabSetSha256: snapshot.tabSetSha256,
    tabIdSha256s: snapshot.tabIdSha256s,
  });
}

function detailsEvidence(details: BrowserSessionDetails | undefined) {
  if (!details) return {};
  return {
    sessionIdSha256: details.sessionIdSha256,
    sessionOperation: details.sessionOperation,
    activeTabId: details.activeTabId,
    tabCount: details.tabCount,
    tabSetSha256: details.tabSetSha256,
    currentUrlSha256: details.currentUrlSha256,
    currentOriginSha256: details.currentOriginSha256,
    titleSha256: details.titleSha256,
    ...(details.file
      ? {
          outputPathSha256: details.file.pathSha256,
          outputFileSha256: details.file.fileSha256,
          outputFileBytes: details.file.fileBytes,
        }
      : {}),
    ...(details.suggestedFilenameSha256
      ? { suggestedFilenameSha256: details.suggestedFilenameSha256 }
      : {}),
    ...(details.snapshotSha256
      ? {
          snapshotSha256: details.snapshotSha256,
          snapshotChars: details.snapshotChars,
          snapshotTruncated: details.snapshotTruncated,
        }
      : {}),
  };
}

function actionEvidence(request: ExecuteBrowserTakeoverActionRequest) {
  if (request.action === "download" || request.action === "save_screenshot") {
    return {
      outputPathSha256: sha256(request.path),
      ...(request.action === "download"
        ? { targetRefSha256: sha256(request.ref) }
        : {}),
      ...(browserVisualActionEvidence(request) ?? {}),
    };
  }
  const visual = browserVisualActionEvidence(request);
  if (visual) return visual;
  if (request.action === "click") {
    return { targetRefSha256: sha256(request.ref) };
  }
  if (request.action === "type") {
    return {
      targetRefSha256: sha256(request.ref),
      textSha256: sha256(request.text),
      textBytes: Buffer.byteLength(request.text, "utf8"),
    };
  }
  if (request.action === "select") {
    return {
      targetRefSha256: sha256(request.ref),
      valueSetSha256: sha256(canonicalJson(request.values)),
      valueCount: request.values.length,
    };
  }
  if (request.action === "scroll") {
    return {
      direction: request.direction,
      ...(request.pixels !== undefined ? { pixels: request.pixels } : {}),
    };
  }
  if (request.action === "wait") {
    return request.durationMs === undefined
      ? {}
      : { durationMs: request.durationMs };
  }
  if (request.action === "tab_new") {
    const url = validatePublicHttpUrl(request.url);
    return {
      targetUrlSha256: sha256(url.href),
      targetOriginSha256: sha256(url.origin),
    };
  }
  if (request.action === "tab_switch" || request.action === "tab_close") {
    return { targetTabIdSha256: sha256(request.tabId) };
  }
  return {};
}

function validOutputEvidence(
  request: ExecuteBrowserTakeoverActionRequest,
  details: BrowserSessionDetails,
): boolean {
  if (request.action !== "download" && request.action !== "save_screenshot") {
    return details.file === undefined;
  }
  return (
    details.file?.pathSha256 === sha256(request.path) &&
    /^[a-f0-9]{64}$/u.test(details.file.fileSha256) &&
    Number.isSafeInteger(details.file.fileBytes) &&
    details.file.fileBytes > 0 &&
    (request.action !== "save_screenshot" ||
      (details.file.fileSha256 === request.expectedLiveImageSha256 &&
        details.suggestedFilenameSha256 === undefined)) &&
    (request.action !== "download" ||
      /^[a-f0-9]{64}$/u.test(details.suggestedFilenameSha256 ?? ""))
  );
}

function validAction(request: ExecuteBrowserTakeoverActionRequest): boolean {
  return validTargetAction(request) && validNonTargetAction(request);
}

function validTargetAction(
  request: ExecuteBrowserTakeoverActionRequest,
): boolean {
  if (
    request.action !== "click" &&
    request.action !== "type" &&
    request.action !== "select" &&
    request.action !== "download"
  ) {
    return true;
  }
  if (!/^[a-z0-9]{1,40}$/u.test(request.ref)) return false;
  if (request.action === "download") {
    return validWorkspaceOutputPath(request.path);
  }
  if (request.action === "type") {
    return Buffer.byteLength(request.text, "utf8") <= 8_000;
  }
  if (request.action === "select") {
    return (
      request.values.length >= 1 &&
      request.values.length <= 20 &&
      request.values.every((value) => Buffer.byteLength(value, "utf8") <= 512)
    );
  }
  return true;
}

function validNonTargetAction(
  request: ExecuteBrowserTakeoverActionRequest,
): boolean {
  const visual = validBrowserVisualTakeoverAction(request);
  if (visual !== undefined) {
    return (
      visual &&
      (request.action !== "save_screenshot" ||
        (validWorkspaceOutputPath(request.path) &&
          request.path.toLowerCase().endsWith(".png")))
    );
  }
  if (request.action === "scroll") {
    return (
      (request.direction === "up" || request.direction === "down") &&
      (request.pixels === undefined ||
        (Number.isSafeInteger(request.pixels) &&
          request.pixels >= 1 &&
          request.pixels <= MAX_BROWSER_SCROLL_PIXELS))
    );
  }
  if (request.action === "wait") {
    return (
      request.durationMs === undefined ||
      (Number.isSafeInteger(request.durationMs) &&
        request.durationMs >= 1 &&
        request.durationMs <= MAX_BROWSER_WAIT_MS)
    );
  }
  if (request.action === "tab_new") {
    try {
      return (
        request.url.length <= 4_096 &&
        Boolean(validatePublicHttpUrl(request.url))
      );
    } catch {
      return false;
    }
  }
  if (request.action === "tab_switch" || request.action === "tab_close") {
    return isTabId(request.tabId);
  }
  return true;
}

function validWorkspaceOutputPath(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 500 &&
    !path.isAbsolute(value) &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    path.normalize(value) === value &&
    value !== "." &&
    value !== ".." &&
    !value.startsWith(`..${path.sep}`)
  );
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function isTabId(value: string): boolean {
  return /^tab_[1-9][0-9]{0,3}$/u.test(value);
}
