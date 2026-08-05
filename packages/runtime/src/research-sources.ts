import type { BrowserSessionOwner } from "./browser-session-model.js";
import { sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import {
  researchRunCounts,
  researchSourceDetails,
  type ResearchSourceCitationRecord,
  type ResearchSourceEvidenceRecord,
} from "./research-source-evidence.js";
import type { ResearchSourceCapsuleReceipt } from "./research-source-capsule.js";
import {
  cloneResearchSourceState,
  ResearchSourceContinuity,
  type ResearchSourceCapsulePort,
} from "./research-source-continuity.js";
import {
  formatResearchSourceCapture,
  formatResearchSourceCitation,
  formatResearchSourceList,
} from "./research-source-format.js";
import { verifyResearchReport } from "./research-report-verification.js";
import {
  browserResearchCapture,
  validateResearchBrowserCapture,
  validateResearchWebFetchCapture,
  webFetchResearchSourceCapture,
} from "./research-source-capture.js";
import type {
  BrowserSourceCaptureProvider,
  ResearchSourceCapture,
  ResearchSourceRequest,
  ResearchSourceResult,
  ResearchSourceToolDetails,
} from "./research-source-model.js";
import type { WebFetchResearchCaptureProvider } from "./web-fetch-model.js";
import type { LocalStore } from "./store.js";

export type {
  BrowserSourceCaptureProvider,
  ResearchSourceRequest,
  ResearchSourceResult,
  ResearchSourceToolDetails,
} from "./research-source-model.js";
export { ResearchSourceCapsuleStore } from "./research-source-capsule-store.js";

export const MAX_RESEARCH_SOURCES_PER_RUN = 16;
export const MAX_RESEARCH_CITATIONS_PER_RUN = 64;
export const MIN_RESEARCH_SOURCE_CHARS = 1_000;
export const MAX_RESEARCH_SOURCE_CHARS = 24_000;
export const DEFAULT_RESEARCH_SOURCE_CHARS = 12_000;

const SHA256 = /^[a-f0-9]{64}$/u;
const SOURCE_ID = /^source_[a-z0-9]{8,80}$/u;

type StoredResearchSource = ResearchSourceEvidenceRecord;

type StoredCitation = ResearchSourceCitationRecord;

interface RunResearchSources {
  sources: Map<string, StoredResearchSource>;
  citations: StoredCitation[];
}

export class RunResearchSourceManager {
  private readonly runs = new Map<string, RunResearchSources>();
  private readonly tails = new Map<string, Promise<void>>();
  private readonly cancellations = new Map<string, AbortController>();
  private readonly stateCapsules = new Map<
    string,
    ResearchSourceCapsuleReceipt
  >();
  private readonly continuity: ResearchSourceContinuity;

  constructor(
    private readonly browser: BrowserSourceCaptureProvider,
    private readonly workspaceRoot?: string,
    private readonly webFetch?: WebFetchResearchCaptureProvider,
    capsules?: ResearchSourceCapsulePort,
    recoveryStore?: Pick<LocalStore, "listRuns" | "listEvents" | "getThread">,
  ) {
    this.continuity = new ResearchSourceContinuity(capsules, recoveryStore);
  }

  async execute(
    owner: BrowserSessionOwner,
    request: ResearchSourceRequest,
    signal?: AbortSignal,
  ): Promise<ResearchSourceResult> {
    const key = ownerKey(owner);
    const cancellation = this.runCancellation(key);
    const operationSignal = signal
      ? AbortSignal.any([signal, cancellation.signal])
      : cancellation.signal;
    try {
      return await this.serialized(
        key,
        async () => {
          assertNotAborted(operationSignal);
          await this.restoreRecoveryState(key, owner);
          if (request.action === "capture") {
            return this.captureBrowser(
              key,
              owner,
              request.maxChars,
              operationSignal,
            );
          }
          if (request.action === "capture_fetch") {
            return this.captureFetch(key, owner, request, operationSignal);
          }
          if (request.action === "cite") {
            return this.cite(key, owner, request);
          }
          if (request.action === "verify_report") {
            return this.verifyReport(key, request, operationSignal);
          }
          return this.list(key);
        },
        operationSignal,
      );
    } catch (error) {
      if (operationSignal.aborted) {
        throw new Error("Research Source operation was cancelled");
      }
      throw error;
    }
  }

  async prepareRecovery(
    owner: BrowserSessionOwner,
    explicitRunId?: string,
  ): Promise<ResearchSourceCapsuleReceipt | undefined> {
    const key = ownerKey(owner);
    await this.serialized(key, () =>
      this.restoreRecoveryState(key, owner, explicitRunId),
    );
    return this.stateCapsules.get(key);
  }

  async cancelRun(owner: BrowserSessionOwner): Promise<void> {
    const key = ownerKey(owner);
    this.cancellations.get(key)?.abort();
    await this.tails.get(key)?.catch(() => undefined);
    this.runs.delete(key);
    this.stateCapsules.delete(key);
    this.continuity.forget(owner);
    this.cancellations.delete(key);
  }

  private async captureBrowser(
    key: string,
    owner: BrowserSessionOwner,
    requestedMaxChars: number | undefined,
    signal?: AbortSignal,
  ): Promise<ResearchSourceResult> {
    const run = this.runSources(key);
    if (run.sources.size >= MAX_RESEARCH_SOURCES_PER_RUN) {
      throw new Error("Research Source limit reached for this Run");
    }
    const maxChars = normalizeCaptureLimit(requestedMaxChars);
    const browserCapture = await this.browser.capturePage(
      owner,
      maxChars,
      signal,
    );
    assertNotAborted(signal);
    const url = validateResearchBrowserCapture(browserCapture, maxChars);
    return this.storeCapture(
      key,
      owner,
      "capture",
      browserResearchCapture(browserCapture),
      url,
    );
  }

  private async captureFetch(
    key: string,
    owner: BrowserSessionOwner,
    request: Extract<ResearchSourceRequest, { action: "capture_fetch" }>,
    signal?: AbortSignal,
  ): Promise<ResearchSourceResult> {
    if (!this.webFetch) {
      throw new Error("Web Fetch Research Source capture is unavailable");
    }
    const maxChars = normalizeCaptureLimit(request.maxChars);
    const fetched = await this.webFetch.captureWebSource(
      owner,
      {
        webSourceId: request.webSourceId,
        webSourceContentSha256: request.webSourceContentSha256,
        maxChars,
      },
      signal,
    );
    assertNotAborted(signal);
    const capture = webFetchResearchSourceCapture(fetched);
    const url = validateResearchWebFetchCapture(capture, maxChars);
    return this.storeCapture(key, owner, "capture_fetch", capture, url);
  }

  private async storeCapture(
    key: string,
    owner: BrowserSessionOwner,
    action: "capture" | "capture_fetch",
    capture: ResearchSourceCapture,
    url: URL,
  ): Promise<ResearchSourceResult> {
    const run = this.runSources(key);
    if (run.sources.size >= MAX_RESEARCH_SOURCES_PER_RUN) {
      throw new Error("Research Source limit reached for this Run");
    }
    const source: StoredResearchSource = {
      id: createId("source"),
      capture: structuredClone(capture),
      origin: url.origin,
      textSha256: sha256(capture.lines.join("\n")),
    };
    const next = cloneResearchSourceState(run);
    next.sources.set(source.id, source);
    const stateCapsule = await this.continuity.persist(owner, next);
    if (stateCapsule) this.stateCapsules.set(key, stateCapsule);
    this.runs.set(key, next);
    return {
      output: formatResearchSourceCapture(source),
      details: {
        ...researchSourceDetails(action, runCounts(next), source),
        ...(stateCapsule ? { stateCapsule } : {}),
      },
    };
  }

  private async cite(
    key: string,
    owner: BrowserSessionOwner,
    request: Extract<ResearchSourceRequest, { action: "cite" }>,
  ): Promise<ResearchSourceResult> {
    const run = this.runs.get(key);
    if (!run) throw new Error("Research Source not found for this Run");
    if (run.citations.length >= MAX_RESEARCH_CITATIONS_PER_RUN) {
      throw new Error("Research citation limit reached for this Run");
    }
    if (!SOURCE_ID.test(request.sourceId)) {
      throw new Error("Research Source ID is invalid");
    }
    const source = run.sources.get(request.sourceId);
    if (!source) throw new Error("Research Source not found for this Run");
    if (
      !SHA256.test(request.sourceContentSha256) ||
      request.sourceContentSha256 !== source.capture.capturedContentSha256
    ) {
      throw new Error("Research Source capture hash is stale or invalid");
    }
    const claim = normalizeClaim(request.claim);
    const { startLine, endLine } = normalizeRange(
      request.startLine,
      request.endLine,
      source.capture.lines.length,
    );
    const quote = source.capture.lines.slice(startLine - 1, endLine).join("\n");
    const citationId = createId("citation");
    const token = `[citation:${citationId}]`;
    const citation: StoredCitation = {
      id: citationId,
      sourceId: source.id,
      startLine,
      endLine,
      claim,
      quoteSha256: sha256(quote),
      claimSha256: sha256(claim),
      token,
    };
    const next = cloneResearchSourceState(run);
    next.citations.push(citation);
    const stateCapsule = await this.continuity.persist(owner, next);
    if (stateCapsule) this.stateCapsules.set(key, stateCapsule);
    this.runs.set(key, next);
    return {
      output: formatResearchSourceCitation(source, citation, claim, quote),
      details: {
        ...researchSourceDetails("cite", runCounts(next), source),
        citationId,
        citationTokenSha256: sha256(token),
        citationStartLine: startLine,
        citationEndLine: endLine,
        citationQuoteSha256: citation.quoteSha256,
        citationClaimSha256: citation.claimSha256,
        ...(stateCapsule ? { stateCapsule } : {}),
      },
    };
  }

  private list(key: string): ResearchSourceResult {
    const run = this.runs.get(key) ?? emptyRunSources();
    const stateCapsule = this.stateCapsules.get(key);
    return {
      output: formatResearchSourceList(run),
      details: {
        kind: "napier.research-source",
        schemaVersion: 1,
        action: "list",
        ...runCounts(run),
        ...(stateCapsule ? { stateCapsule } : {}),
      },
    };
  }

  private async verifyReport(
    key: string,
    request: Extract<ResearchSourceRequest, { action: "verify_report" }>,
    signal?: AbortSignal,
  ): Promise<ResearchSourceResult> {
    const run = this.runs.get(key);
    if (!run || run.citations.length === 0) {
      throw new Error("Research citations not found for this Run");
    }
    if (!this.workspaceRoot) {
      throw new Error("Research report workspace is unavailable");
    }
    const verification = await verifyResearchReport({
      workspaceRoot: this.workspaceRoot,
      path: request.path,
      expectedSha256: request.expectedSha256,
      citations: run.citations,
      ...(signal ? { signal } : {}),
    });
    const stateCapsule = this.stateCapsules.get(key);
    return {
      output: [
        `Research report verified: ${verification.path}`,
        `File SHA-256: ${verification.fileSha256}`,
        `Citations: ${verification.citationCount}`,
      ].join("\n"),
      details: {
        kind: "napier.research-source",
        schemaVersion: 1,
        action: "verify_report",
        ...runCounts(run),
        reportPathSha256: verification.pathSha256,
        reportFileSha256: verification.fileSha256,
        reportFileBytes: verification.fileBytes,
        reportCitationCount: verification.citationCount,
        reportCitationSetSha256: verification.citationSetSha256,
        ...(stateCapsule ? { stateCapsule } : {}),
      },
    };
  }

  private runSources(key: string): RunResearchSources {
    const existing = this.runs.get(key);
    if (existing) return existing;
    const created = emptyRunSources();
    this.runs.set(key, created);
    return created;
  }

  private async restoreRecoveryState(
    key: string,
    owner: BrowserSessionOwner,
    explicitRunId?: string,
  ): Promise<void> {
    if (this.runs.has(key)) return;
    const restored = await this.continuity.restore(owner, explicitRunId);
    if (restored) {
      this.runs.set(key, restored.state);
      this.stateCapsules.set(key, restored.receipt);
    }
  }

  private runCancellation(key: string): AbortController {
    const existing = this.cancellations.get(key);
    if (existing) return existing;
    const created = new AbortController();
    this.cancellations.set(key, created);
    return created;
  }

  private async serialized<T>(
    key: string,
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.tails.set(key, tail);
    void tail.finally(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    try {
      await waitForTurn(previous, signal);
      return await operation();
    } finally {
      release();
    }
  }
}

function runCounts(
  run: RunResearchSources,
): Pick<
  ResearchSourceToolDetails,
  "sourceCount" | "citationCount" | "sourceSetSha256"
> {
  return researchRunCounts(run.sources.values(), run.citations.length);
}

function normalizeCaptureLimit(value: number | undefined): number {
  const selected = value ?? DEFAULT_RESEARCH_SOURCE_CHARS;
  if (
    !Number.isSafeInteger(selected) ||
    selected < MIN_RESEARCH_SOURCE_CHARS ||
    selected > MAX_RESEARCH_SOURCE_CHARS
  ) {
    throw new Error("Research Source capture character limit is invalid");
  }
  return selected;
}

function normalizeClaim(value: string): string {
  const claim = value.trim();
  if (
    !claim ||
    claim.length > 1_000 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(claim)
  ) {
    throw new Error("Research citation claim is invalid");
  }
  return claim;
}

function normalizeRange(
  startLine: number,
  endLine: number,
  lineCount: number,
): { startLine: number; endLine: number } {
  if (
    !Number.isSafeInteger(startLine) ||
    !Number.isSafeInteger(endLine) ||
    startLine < 1 ||
    endLine < startLine ||
    endLine > lineCount ||
    endLine - startLine + 1 > 40
  ) {
    throw new Error("Research citation line range is invalid");
  }
  return { startLine, endLine };
}

function emptyRunSources(): RunResearchSources {
  return { sources: new Map(), citations: [] };
}

function ownerKey(owner: BrowserSessionOwner): string {
  if (!owner.threadId || !owner.runId) {
    throw new Error("Research Source owner is invalid");
  }
  return `${owner.threadId}\u0000${owner.runId}`;
}

async function waitForTurn(
  previous: Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) {
    await previous.catch(() => undefined);
    return;
  }
  assertNotAborted(signal);
  let abort!: () => void;
  try {
    await Promise.race([
      previous.catch(() => undefined),
      new Promise<never>((_, reject) => {
        abort = () =>
          reject(new Error("Research Source operation was cancelled"));
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted)
    throw new Error("Research Source operation was cancelled");
}
