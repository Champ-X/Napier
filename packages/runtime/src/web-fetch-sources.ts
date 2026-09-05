import { PublicHttpClient } from "./public-http-client.js";
import { SharedAbortableFlightPool } from "./shared-abortable-flight-pool.js";
import { executeWebFetchSource } from "./web-fetch-execution.js";
import { createWebFetchResearchCapture } from "./web-fetch-research-capture.js";
import { webFetchCancelled } from "./web-fetch-failure.js";
import {
  MAX_WEB_FETCH_BROWSER_FALLBACKS_PER_RUN,
  MAX_WEB_FETCH_SOURCES_PER_RUN,
  type WebFetchBrowserFallbackProvider,
  type WebFetchExecutor,
  type WebFetchExecutionOptions,
  type WebFetchMaterializationIdentity,
  type WebFetchResearchCapture,
  type WebFetchResearchCaptureProvider,
  type WebFetchRequest,
  type WebFetchRetainedSource,
  type WebFetchResult,
  type WebFetchSource,
} from "./web-fetch-model.js";
import {
  materializeWebFetchSource,
  registerRetainedWebFetchSource,
  retainedWebFetchMaterialization,
  retainedWebFetchSource,
  sameWebFetchMaterialization,
  snapshotWebFetchMaterializationIdentity,
  webFetchResultFromRetained,
  webFetchMaterializationFlightKey,
} from "./web-fetch-materialization.js";
import {
  emptyRunSources,
  type RunWebFetchSources,
  resolveWebFetchSource,
  routeStoredWebFetchRequest,
  throwIfWebFetchAborted as throwIfAborted,
  waitForWebFetchTurn as waitForTurn,
  webFetchOwnerKey as ownerKey,
  webFetchTargetKey as fetchTargetKey,
} from "./web-fetch-source-routes.js";
import { webFetchSourceDetails } from "./web-fetch-source-view.js";
import type { WebFetchStateCapsuleReceipt } from "./web-fetch-capsule-model.js";
import type { WebFetchCapsuleStore } from "./web-fetch-capsule-store.js";
import {
  cloneWebFetchState,
  WebFetchContinuity,
} from "./web-fetch-continuity.js";
import {
  WebFetchUrlArtifactRegistrar,
  type WebFetchSourceManagerStore,
} from "./web-fetch-url-artifact.js";
import { validateWebFetchSource } from "./web-fetch-source-validation.js";
import type { ToolOperationObserver } from "./tool-operation-journal.js";

export interface RunWebFetchSourceManagerOptions {
  http?: Pick<PublicHttpClient, "request">;
  browserFallback?: WebFetchBrowserFallbackProvider;
  now?: () => Date;
  capsules?: Pick<
    WebFetchCapsuleStore,
    "putState" | "readManifest" | "readSource"
  >;
  store?: WebFetchSourceManagerStore;
}

type WebFetchStateCapsules = Map<string, WebFetchStateCapsuleReceipt>;

export class RunWebFetchSourceManager
  implements WebFetchExecutor, WebFetchResearchCaptureProvider
{
  private readonly runs = new Map<string, RunWebFetchSources>();
  private readonly tails = new Map<string, Promise<void>>();
  private readonly sourceReservations = new Map<string, number>();
  private readonly fetchFlights =
    new SharedAbortableFlightPool<WebFetchResult>();
  private readonly cancellations = new Map<string, AbortController>();
  private readonly http: Pick<PublicHttpClient, "request">;
  private readonly browserFallback: WebFetchBrowserFallbackProvider | undefined;
  private readonly now: () => Date;
  private readonly continuity: WebFetchContinuity;
  private readonly urlArtifacts: WebFetchUrlArtifactRegistrar;
  private readonly stateCapsules: WebFetchStateCapsules = new Map();

  constructor(options: RunWebFetchSourceManagerOptions = {}) {
    this.http = options.http ?? new PublicHttpClient();
    this.browserFallback = options.browserFallback;
    this.now = options.now ?? (() => new Date());
    this.continuity = new WebFetchContinuity(options.capsules, options.store);
    this.urlArtifacts = new WebFetchUrlArtifactRegistrar(options.store);
  }

  async execute(
    owner: { threadId: string; runId: string },
    request: WebFetchRequest,
    signal?: AbortSignal,
    options: WebFetchExecutionOptions = {},
    operations?: ToolOperationObserver,
    materialization?: WebFetchMaterializationIdentity,
  ): Promise<WebFetchResult> {
    const key = ownerKey(owner);
    const cancellation = this.runCancellation(key);
    const operationSignal = signal
      ? AbortSignal.any([signal, cancellation.signal])
      : cancellation.signal;
    try {
      if (request.action === "fetch") {
        return await this.sharedFetch(
          key,
          owner,
          request.url,
          operationSignal,
          options,
          operations,
          materialization,
        );
      }
      return await this.serialized(
        key,
        async () => {
          throwIfAborted(operationSignal);
          await this.restoreRecoveryState(key, owner);
          return routeStoredWebFetchRequest(
            this.runSources(key),
            this.stateCapsules.get(key),
            request,
          );
        },
        operationSignal,
      );
    } catch (error) {
      if (operationSignal.aborted) throw webFetchCancelled(error);
      throw error;
    }
  }

  async cancelRun(owner: { threadId: string; runId: string }): Promise<void> {
    const key = ownerKey(owner);
    this.cancellations.get(key)?.abort();
    await this.fetchFlights.cancelScope(key);
    await this.tails.get(key)?.catch(() => undefined);
    this.sourceReservations.delete(key);
    this.runs.delete(key);
    this.stateCapsules.delete(key);
    this.continuity.forget(owner);
    this.cancellations.delete(key);
  }

  async prepareRecovery(
    owner: { threadId: string; runId: string },
    explicitRunId?: string,
  ) {
    const key = ownerKey(owner);
    await this.serialized(
      key,
      () => this.restoreRecoveryState(key, owner, explicitRunId),
      new AbortController().signal,
    );
    return this.stateCapsules.get(key);
  }

  async captureWebSource(
    owner: { threadId: string; runId: string },
    request: {
      webSourceId: string;
      webSourceContentSha256: string;
      maxChars: number;
    },
    signal?: AbortSignal,
  ): Promise<WebFetchResearchCapture> {
    const key = ownerKey(owner);
    const cancellation = this.runCancellation(key);
    const operationSignal = signal
      ? AbortSignal.any([signal, cancellation.signal])
      : cancellation.signal;
    return this.serialized(
      key,
      async () => {
        throwIfAborted(operationSignal);
        await this.restoreRecoveryState(key, owner);
        const source = resolveWebFetchSource(this.runs.get(key), {
          sourceId: request.webSourceId,
          sourceContentSha256: request.webSourceContentSha256,
        });
        return createWebFetchResearchCapture(source, request.maxChars);
      },
      operationSignal,
    );
  }

  async retainWebSource(
    owner: { threadId: string; runId: string },
    input: WebFetchSource,
    signal?: AbortSignal,
  ): Promise<WebFetchRetainedSource> {
    const key = ownerKey(owner);
    const cancellation = this.runCancellation(key);
    const operationSignal = signal
      ? AbortSignal.any([signal, cancellation.signal])
      : cancellation.signal;
    const retained = await this.serialized(
      key,
      async () => {
        throwIfAborted(operationSignal);
        await this.restoreRecoveryState(key, owner);
        if (
          this.runSources(key).sources.size +
            (this.sourceReservations.get(key) ?? 0) >=
          MAX_WEB_FETCH_SOURCES_PER_RUN
        ) {
          throw new Error("Web fetch Source limit reached for this Run");
        }
        return this.commitSource(key, owner, input);
      },
      operationSignal,
    );
    return registerRetainedWebFetchSource(this.urlArtifacts, owner, retained);
  }

  private async sharedFetch(
    key: string,
    owner: { threadId: string; runId: string },
    url: string,
    signal: AbortSignal,
    options: WebFetchExecutionOptions,
    operations: ToolOperationObserver | undefined,
    materialization: WebFetchMaterializationIdentity | undefined,
  ): Promise<WebFetchResult> {
    throwIfAborted(signal);
    materialization = snapshotWebFetchMaterializationIdentity(materialization);
    const target = webFetchMaterializationFlightKey(
      fetchTargetKey(url, options),
      materialization,
    );
    const result = await this.fetchFlights.run(
      key,
      target,
      signal,
      (flightSignal) =>
        this.fetch(
          key,
          owner,
          url,
          AbortSignal.any([flightSignal, this.runCancellation(key).signal]),
          options,
          operations,
          materialization,
        ),
      materialization !== undefined || operations === undefined,
    );
    return structuredClone(result);
  }

  private async fetch(
    key: string,
    owner: { threadId: string; runId: string },
    url: string,
    signal: AbortSignal,
    options: WebFetchExecutionOptions,
    operations: ToolOperationObserver | undefined,
    materialization: WebFetchMaterializationIdentity | undefined,
  ): Promise<WebFetchResult> {
    const replay = materialization
      ? await this.existingMaterialization(key, owner, materialization, signal)
      : undefined;
    if (replay) {
      return webFetchResultFromRetained(
        await registerRetainedWebFetchSource(this.urlArtifacts, owner, replay),
      );
    }
    const browserFallbackCount = await this.reserveSource(key, owner, signal);
    try {
      const executed = await executeWebFetchSource({
        http: this.http,
        ...(this.browserFallback
          ? { browserFallback: this.browserFallback }
          : {}),
        browserFallbackCount,
        reserveBrowserFallback: () =>
          this.reserveBrowserFallback(key, owner, signal),
        owner,
        url,
        signal,
        options,
        now: this.now,
        ...(operations ? { operations } : {}),
      });
      const retained = await this.serialized(
        key,
        () =>
          this.commitSource(
            key,
            owner,
            materializeWebFetchSource(executed.source, materialization),
            executed.browserFallbackCount,
          ),
        signal,
      );
      return webFetchResultFromRetained(
        await registerRetainedWebFetchSource(
          this.urlArtifacts,
          owner,
          retained,
        ),
      );
    } finally {
      await this.releaseSource(key);
    }
  }

  private async commitSource(
    key: string,
    owner: { threadId: string; runId: string },
    input: WebFetchSource,
    browserFallbackCount?: number,
  ): Promise<WebFetchRetainedSource> {
    const run = this.runSources(key);
    const source = validateWebFetchSource(input);
    const existing = run.sources.get(source.id);
    if (existing) {
      if (!sameWebFetchMaterialization(existing, source)) {
        throw new Error(
          "Web fetch Source materialization conflicts with existing evidence",
        );
      }
      return retainedWebFetchSource(run, existing, this.stateCapsules.get(key));
    }
    if (run.sources.size >= MAX_WEB_FETCH_SOURCES_PER_RUN) {
      throw new Error("Web fetch Source limit reached for this Run");
    }
    const next = cloneWebFetchState(run);
    next.browserFallbackCount = Math.max(
      next.browserFallbackCount,
      browserFallbackCount ?? 0,
    );
    next.sources.set(source.id, source);
    const stateCapsule = await this.continuity.persist(owner, next);
    if (stateCapsule) this.stateCapsules.set(key, stateCapsule);
    this.runs.set(key, next);
    return {
      source: structuredClone(source),
      details: {
        ...webFetchSourceDetails("fetch", next, source),
        ...(stateCapsule ? { stateCapsule } : {}),
      },
    };
  }

  private async existingMaterialization(
    key: string,
    owner: { threadId: string; runId: string },
    identity: WebFetchMaterializationIdentity,
    signal: AbortSignal,
  ): Promise<WebFetchRetainedSource | undefined> {
    return this.serialized(
      key,
      async () => {
        throwIfAborted(signal);
        await this.restoreRecoveryState(key, owner);
        const run = this.runSources(key);
        return retainedWebFetchMaterialization(
          run,
          identity,
          this.stateCapsules.get(key),
        );
      },
      signal,
    );
  }

  private reserveSource(
    key: string,
    owner: { threadId: string; runId: string },
    signal: AbortSignal,
  ): Promise<number> {
    return this.serialized(
      key,
      async () => {
        throwIfAborted(signal);
        await this.restoreRecoveryState(key, owner);
        const run = this.runSources(key);
        const reservations = this.sourceReservations.get(key) ?? 0;
        if (run.sources.size + reservations >= MAX_WEB_FETCH_SOURCES_PER_RUN) {
          throw new Error("Web fetch Source limit reached for this Run");
        }
        this.sourceReservations.set(key, reservations + 1);
        return run.browserFallbackCount;
      },
      signal,
    );
  }

  private async releaseSource(key: string): Promise<void> {
    await this.serialized(
      key,
      async () => {
        const reservations = this.sourceReservations.get(key) ?? 0;
        if (reservations <= 1) this.sourceReservations.delete(key);
        else this.sourceReservations.set(key, reservations - 1);
      },
      new AbortController().signal,
    );
  }

  private reserveBrowserFallback(
    key: string,
    owner: { threadId: string; runId: string },
    signal: AbortSignal,
  ): Promise<number | undefined> {
    return this.serialized(
      key,
      async () => {
        throwIfAborted(signal);
        await this.restoreRecoveryState(key, owner);
        const run = this.runSources(key);
        if (
          run.browserFallbackCount >= MAX_WEB_FETCH_BROWSER_FALLBACKS_PER_RUN
        ) {
          return undefined;
        }
        const next = cloneWebFetchState(run);
        next.browserFallbackCount += 1;
        const stateCapsule = await this.continuity.persist(owner, next);
        if (stateCapsule) this.stateCapsules.set(key, stateCapsule);
        this.runs.set(key, next);
        return next.browserFallbackCount;
      },
      signal,
    );
  }

  private runSources(key: string): RunWebFetchSources {
    const existing = this.runs.get(key);
    if (existing) return existing;
    const created = emptyRunSources();
    this.runs.set(key, created);
    return created;
  }

  private async restoreRecoveryState(
    key: string,
    owner: { threadId: string; runId: string },
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
    signal: AbortSignal,
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
      throwIfAborted(signal);
      return await operation();
    } finally {
      release();
    }
  }
}
