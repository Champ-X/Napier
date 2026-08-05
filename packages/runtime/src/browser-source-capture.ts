import type { Page } from "playwright-core";

import {
  type BrowserPageSourceProbe,
  createBrowserPageDiagnosis,
  probeBrowserPageDiagnosis,
} from "./browser-page-diagnosis.js";
import {
  BROWSER_ACTION_TIMEOUT_MS,
  type BrowserPageSourceCapture,
} from "./browser-session-model.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { FixedIpProxySnapshot } from "./fixed-ip-http-proxy.js";
import { validatePublicHttpUrl } from "./public-network.js";
import type { BrowserSessionTabEvidence } from "./browser-session-tabs.js";

export async function captureBrowserPageSource(input: {
  page: Page;
  maxChars: number;
  signal?: AbortSignal;
  sessionOperation: number;
  sessionIdSha256: string;
  tabs: BrowserSessionTabEvidence;
  browserExecutableSha256: string;
  browserVersionSha256: string;
  limitsSha256: string;
  network: FixedIpProxySnapshot;
}): Promise<BrowserPageSourceCapture> {
  const beforeUrl = input.page.url();
  validatePublicHttpUrl(beforeUrl);
  const extracted = (await input.page.locator("html").evaluate(
    probeBrowserPageDiagnosis,
    { kind: "source" as const, href: beforeUrl, limit: input.maxChars },
    {
      timeout: BROWSER_ACTION_TIMEOUT_MS,
      ...(input.signal ? { signal: input.signal } : {}),
    },
  )) as BrowserPageSourceProbe;
  const afterUrl = input.page.url();
  if (
    extracted.url !== beforeUrl ||
    afterUrl !== beforeUrl ||
    !extracted.text.trim()
  ) {
    throw new Error("Browser page changed or became empty during capture");
  }
  const normalized = normalizeSourceLines(
    extracted.text,
    extracted.semanticControls,
    input.maxChars,
  );
  const title = normalizeDisplayText(extracted.title).slice(0, 512);
  return {
    url: extracted.url,
    title,
    pageDiagnosis: createBrowserPageDiagnosis(extracted),
    semanticAppControlCount: normalized.semanticAppControlCount,
    lines: normalized.lines,
    textChars: normalized.lines.join("\n").length,
    truncated: normalized.truncated,
    capturedContentSha256: sha256(
      canonicalJson({
        url: extracted.url,
        title,
        lines: normalized.lines,
        truncated: normalized.truncated,
      }),
    ),
    sessionOperation: input.sessionOperation,
    sessionIdSha256: input.sessionIdSha256,
    activeTabId: input.tabs.activeTabId,
    tabCount: input.tabs.tabCount,
    tabSetSha256: input.tabs.tabSetSha256,
    browserExecutableSha256: input.browserExecutableSha256,
    browserVersionSha256: input.browserVersionSha256,
    limitsSha256: input.limitsSha256,
    network: structuredClone(input.network),
  };
}

function normalizeDisplayText(input: string): string {
  return input
    .replace(/[\u0000-\u001f\u007f-\u009f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeSourceLines(
  input: string,
  semanticControls: ReadonlyArray<{ line: string; appMount: boolean }>,
  maxChars: number,
): {
  lines: string[];
  semanticAppControlCount: number;
  truncated: boolean;
} {
  const lines: string[] = [];
  let chars = 0;
  let truncated = input.length > maxChars;
  let semanticAppControlCount = 0;
  const candidates = [
    ...input
      .slice(0, maxChars)
      .split(/\r?\n/u)
      .map((line) => ({
        line,
        semantic: false,
        appMount: false,
      })),
    ...semanticControls.map((control) => ({
      line: control.appMount
        ? control.line.replace(/^Control:/u, "App control:")
        : control.line,
      semantic: true,
      appMount: control.appMount,
    })),
  ];
  for (const candidate of candidates) {
    const rawLine = candidate.line;
    const line = normalizeDisplayText(rawLine);
    if (!line) continue;
    const bounded = line.slice(0, 1_000);
    if (bounded.length < line.length) truncated = true;
    const remaining = maxChars - chars - (lines.length > 0 ? 1 : 0);
    if (remaining <= 0 || lines.length >= 400) {
      truncated = true;
      break;
    }
    if (candidate.semantic && bounded.length > remaining) {
      truncated = true;
      continue;
    }
    lines.push(bounded.slice(0, remaining));
    chars += Math.min(bounded.length, remaining);
    if (candidate.appMount) semanticAppControlCount += 1;
    if (bounded.length > remaining) {
      truncated = true;
      break;
    }
  }
  if (lines.length === 0) {
    throw new Error("Browser source capture has no visible text");
  }
  return { lines, semanticAppControlCount, truncated };
}
