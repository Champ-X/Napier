import type { RunEvent, RunRecord } from "@napier/contracts";

import type { WebFetchStateCapsuleReceipt } from "./web-fetch-capsule-model.js";
import type { WebFetchCapsuleStore } from "./web-fetch-capsule-store.js";
import { validateWebFetchStateCapsuleReceipt } from "./web-fetch-capsule.js";
import { canonicalJson } from "./ed25519.js";
import { sourceContinuityPredecessor } from "./source-continuity-lineage.js";
import type { WebFetchSource } from "./web-fetch-model.js";
import { isWebFetchStateToolName } from "./web-fetch-state-tool.js";

export interface WebFetchState {
  sources: Map<string, WebFetchSource>;
  browserFallbackCount: number;
}

type RecoveryStore = {
  listRuns(threadId: string): RunRecord[];
  listEvents(threadId: string): Promise<RunEvent[]>;
  getThread(threadId: string): {
    importProvenance?: import("@napier/contracts").ThreadImportProvenance;
  };
};
type CapsulePort = Pick<
  WebFetchCapsuleStore,
  "putState" | "readManifest" | "readSource"
>;

export class WebFetchContinuity {
  private readonly restorations = new Map<
    string,
    Promise<
      { state: WebFetchState; receipt: WebFetchStateCapsuleReceipt } | undefined
    >
  >();

  constructor(
    private readonly capsules?: CapsulePort,
    private readonly store?: RecoveryStore,
  ) {}

  persist(owner: { threadId: string; runId: string }, state: WebFetchState) {
    return this.capsules?.putState({
      sourceThreadId: owner.threadId,
      sourceRunId: owner.runId,
      sources: state.sources.values(),
      browserFallbackCount: state.browserFallbackCount,
    });
  }

  forget(owner: { threadId: string; runId: string }): void {
    this.restorations.delete(ownerKey(owner));
  }

  restore(owner: { threadId: string; runId: string }, explicitRunId?: string) {
    const key = ownerKey(owner);
    const existing = this.restorations.get(key);
    if (existing) return existing;
    const restoration = this.restoreOnce(owner, explicitRunId);
    this.restorations.set(key, restoration);
    return restoration;
  }

  private async restoreOnce(
    owner: {
      threadId: string;
      runId: string;
    },
    explicitRunId?: string,
  ): Promise<
    { state: WebFetchState; receipt: WebFetchStateCapsuleReceipt } | undefined
  > {
    if (!this.capsules || !this.store) return undefined;
    const parent = sourceContinuityPredecessor(this.store, owner, {
      ...(explicitRunId ? { explicitRunId } : {}),
    });
    if (!parent) return undefined;
    const events = (await this.store.listEvents(owner.threadId)).filter(
      (event) =>
        event.runId === parent.id &&
        (event.type === "context.web_fetch_sources" ||
          (event.type === "tool.completed" &&
            isWebFetchStateToolName(record(event.payload)?.["toolName"]))),
    );
    const receipts = events.flatMap((event) => {
      const payload = record(event.payload);
      const details = record(payload?.["details"]);
      const candidate =
        event.type === "context.web_fetch_sources"
          ? payload
          : details?.["stateCapsule"];
      if (!candidate) return [];
      const receipt = validateWebFetchStateCapsuleReceipt(candidate);
      if (
        event.type === "tool.completed" &&
        (details?.["sourceCount"] !== receipt.sourceCount ||
          details["sourceSetSha256"] !== receipt.sourceSetSha256)
      ) {
        throw new Error(
          "Web Fetch continuity receipt conflicts with Tool evidence",
        );
      }
      return [receipt];
    });
    const receipt = receipts.at(-1);
    if (!receipt || receipt.sourceRunId !== parent.id) return undefined;
    const manifest = await this.capsules.readManifest(
      receipt.manifestCapsuleSha256,
    );
    if (
      manifest.sourceThreadId !== owner.threadId ||
      manifest.sourceRunId !== parent.id ||
      manifest.sources.length !== receipt.sourceCount ||
      manifest.sourceSetSha256 !== receipt.sourceSetSha256 ||
      manifest.contentSha256 !== receipt.manifestCapsuleSha256 ||
      Buffer.byteLength(canonicalJson(manifest), "utf8") !==
        receipt.manifestCapsuleBytes
    ) {
      throw new Error("Web Fetch continuity manifest does not match Ledger");
    }
    const sources = new Map<string, WebFetchSource>();
    for (const binding of manifest.sources) {
      const sourceCapsule = await this.capsules.readSource(
        binding.capsuleSha256,
      );
      if (
        sourceCapsule.source.id !== binding.id ||
        sourceCapsule.source.contentSha256 !== binding.contentSha256 ||
        sourceCapsule.contentSha256 !== binding.capsuleSha256
      ) {
        throw new Error("Web Fetch continuity Source does not match manifest");
      }
      sources.set(binding.id, structuredClone(sourceCapsule.source));
    }
    const state = {
      sources,
      browserFallbackCount: manifest.browserFallbackCount,
    };
    const childReceipt = await this.persist(owner, state);
    return childReceipt ? { state, receipt: childReceipt } : undefined;
  }
}

export function cloneWebFetchState(state: WebFetchState): WebFetchState {
  return {
    sources: new Map(
      [...state.sources].map(([id, source]) => [id, structuredClone(source)]),
    ),
    browserFallbackCount: state.browserFallbackCount,
  };
}

function ownerKey(owner: { threadId: string; runId: string }): string {
  return `${owner.threadId}\u0000${owner.runId}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
