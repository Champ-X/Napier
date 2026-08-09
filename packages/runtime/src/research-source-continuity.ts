import { parseResearchSourceEvidenceV1 } from "@napier/contracts/skill-load";

import type { BrowserSessionOwner } from "./browser-session-model.js";
import {
  type ResearchSourceCitationRecord,
  type ResearchSourceEvidenceRecord,
} from "./research-source-evidence.js";
import type { ResearchSourceCapsuleStore } from "./research-source-capsule-store.js";
import {
  type ResearchSourceCapsuleReceipt,
  validateResearchSourceCapsuleReceipt,
} from "./research-source-capsule.js";
import type { LocalStore } from "./store.js";
import { sourceContinuityPredecessor } from "./source-continuity-lineage.js";

export interface ResearchSourceState {
  sources: Map<string, ResearchSourceEvidenceRecord>;
  citations: ResearchSourceCitationRecord[];
}

type RecoveryStore = Pick<LocalStore, "listRuns" | "listEvents" | "getThread">;
export type ResearchSourceCapsulePort = Pick<
  ResearchSourceCapsuleStore,
  "put" | "read"
>;

export class ResearchSourceContinuity {
  private readonly restorations = new Map<
    string,
    Promise<
      | { state: ResearchSourceState; receipt: ResearchSourceCapsuleReceipt }
      | undefined
    >
  >();

  constructor(
    private readonly capsules?: ResearchSourceCapsulePort,
    private readonly store?: RecoveryStore,
  ) {}

  async persist(owner: BrowserSessionOwner, state: ResearchSourceState) {
    if (!this.capsules) return undefined;
    return this.capsules.put({
      sourceThreadId: owner.threadId,
      sourceRunId: owner.runId,
      sources: state.sources.values(),
      citations: state.citations,
    });
  }

  forget(owner: BrowserSessionOwner): void {
    this.restorations.delete(ownerKey(owner));
  }

  async restore(
    owner: BrowserSessionOwner,
    explicitRunId?: string,
  ): Promise<
    | { state: ResearchSourceState; receipt: ResearchSourceCapsuleReceipt }
    | undefined
  > {
    const key = ownerKey(owner);
    const existing = this.restorations.get(key);
    if (existing) return existing;
    const restoration = this.restoreOnce(owner, explicitRunId);
    this.restorations.set(key, restoration);
    return restoration;
  }

  private async restoreOnce(
    owner: BrowserSessionOwner,
    explicitRunId?: string,
  ): Promise<
    | { state: ResearchSourceState; receipt: ResearchSourceCapsuleReceipt }
    | undefined
  > {
    if (!this.capsules || !this.store) return undefined;
    const parent = sourceContinuityPredecessor(this.store, owner, {
      ...(explicitRunId ? { explicitRunId } : {}),
    });
    if (!parent) return undefined;
    const events = (await this.store.listEvents(owner.threadId)).filter(
      (event) =>
        event.runId === parent.id &&
        (event.type === "context.research_sources" ||
          (event.type === "tool.completed" &&
            record(event.payload)?.["toolName"] === "research_source")),
    );
    const receipts = events.flatMap((event) => {
      const payload = record(event.payload);
      const details = record(payload?.["details"]);
      if (event.type === "context.research_sources") {
        return payload ? [validateResearchSourceCapsuleReceipt(payload)] : [];
      }
      const rawReceipt = details?.["stateCapsule"];
      if (rawReceipt) {
        const validated = validateResearchSourceCapsuleReceipt(rawReceipt);
        if (
          details?.["sourceCount"] !== validated.sourceCount ||
          details["citationCount"] !== validated.citationCount ||
          details["sourceSetSha256"] !== validated.sourceSetSha256
        ) {
          throw new Error(
            "Research Source continuity receipt conflicts with Tool evidence",
          );
        }
        return [validated];
      }
      const evidence = parseResearchSourceEvidenceV1(details);
      return evidence?.continuityCapsuleContentSha256
        ? [
            {
              sourceRunId: parent.id,
              sourceCount: evidence.sourceCount,
              citationCount: evidence.citationCount,
              sourceSetSha256: evidence.sourceSetSha256,
              capsuleSha256: evidence.continuityCapsuleContentSha256,
            },
          ]
        : [];
    });
    const receipt = receipts.at(-1);
    if (!receipt) return undefined;
    if (receipt.sourceRunId !== parent.id) {
      throw new Error("Research Source continuity receipt is invalid");
    }
    const capsule = await this.capsules.read(receipt.capsuleSha256);
    if (
      capsule.sourceThreadId !== owner.threadId ||
      capsule.sourceRunId !== parent.id ||
      capsule.sources.length !== receipt.sourceCount ||
      capsule.citations.length !== receipt.citationCount ||
      capsule.sourceSetSha256 !== receipt.sourceSetSha256 ||
      capsule.contentSha256 !== receipt.capsuleSha256
    ) {
      throw new Error(
        "Research Source continuity capsule does not match Ledger",
      );
    }
    const state = {
      sources: new Map(
        capsule.sources.map((source) => [source.id, structuredClone(source)]),
      ),
      citations: capsule.citations.map((citation) => structuredClone(citation)),
    };
    const childReceipt = await this.persist(owner, state);
    if (!childReceipt) return undefined;
    return { state, receipt: childReceipt };
  }
}

export function cloneResearchSourceState(
  state: ResearchSourceState,
): ResearchSourceState {
  return {
    sources: new Map(
      [...state.sources].map(([id, source]) => [id, structuredClone(source)]),
    ),
    citations: state.citations.map((citation) => structuredClone(citation)),
  };
}

function ownerKey(owner: BrowserSessionOwner): string {
  return `${owner.threadId}\u0000${owner.runId}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
