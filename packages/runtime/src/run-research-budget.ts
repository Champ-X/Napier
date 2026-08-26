import type {
  JsonObject,
  RunEvent,
  RunLimits,
  RunRecord,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { EventSink } from "./event-sink.js";
import type { LocalStore } from "./store.js";

export interface RunResearchBudgetSnapshot {
  researchTurnCount: number;
  researchElapsedMs: number;
  maxResearchTurns: number;
  maxResearchElapsedMs: number;
}

const RESEARCH_TOOLS = new Set([
  "web_search",
  "web_fetch",
  "web_fetch_save",
  "research_source",
]);

export class RunResearchBudget {
  private readonly researchTurns = new Set<number>();
  private researchElapsedMs = 0;
  private active: { turnIndex: number; startedAtMs: number } | undefined;
  private exhausted:
    | { reason: "turns" | "elapsed"; observed: RunResearchBudgetSnapshot }
    | undefined;

  constructor(
    private readonly context: {
      store: LocalStore;
      run: Pick<RunRecord, "id" | "threadId" | "startedAt">;
      limits: RunLimits;
      onEvent?: EventSink;
    },
  ) {}

  async preflight(
    toolName: string,
    turnIndex: number,
    nowMs = Date.now(),
  ): Promise<{ block: true; reason: string } | undefined> {
    if (!isResearchTool(toolName)) return undefined;
    if (this.exhausted) return blockResult(this.exhausted.reason);
    const snapshot = this.snapshot(nowMs);
    const sameTurn = this.active?.turnIndex === turnIndex;
    const reason =
      !sameTurn && snapshot.researchTurnCount >= snapshot.maxResearchTurns
        ? "turns"
        : snapshot.researchElapsedMs >= snapshot.maxResearchElapsedMs
          ? "elapsed"
          : undefined;
    if (reason) {
      this.exhausted = { reason, observed: snapshot };
      await this.record(toolName, turnIndex, reason, snapshot);
      return blockResult(reason);
    }
    if (!sameTurn) {
      this.researchTurns.add(turnIndex);
      this.active = { turnIndex, startedAtMs: nowMs };
    }
    return undefined;
  }

  completeTurn(turnIndex: number, completedAt: string): void {
    if (this.active?.turnIndex !== turnIndex) return;
    this.researchElapsedMs += Math.max(
      0,
      Date.parse(completedAt) - this.active.startedAtMs,
    );
    this.active = undefined;
  }

  snapshot(nowMs = Date.now()): RunResearchBudgetSnapshot {
    const activeElapsedMs = this.active
      ? Math.max(0, nowMs - this.active.startedAtMs)
      : 0;
    return {
      researchTurnCount: this.researchTurns.size,
      researchElapsedMs: this.researchElapsedMs + activeElapsedMs,
      maxResearchTurns: Math.max(
        1,
        Math.floor(this.context.limits.maxTurns * 0.25),
      ),
      maxResearchElapsedMs: Math.max(
        1,
        Math.floor(this.context.limits.timeoutMs * 0.25),
      ),
    };
  }

  private async record(
    toolName: string,
    turnIndex: number,
    reason: "turns" | "elapsed",
    observed: RunResearchBudgetSnapshot,
  ): Promise<void> {
    const content = {
      kind: "napier.run-research-budget" as const,
      schemaVersion: 1 as const,
      status: "exhausted" as const,
      reason,
      turnIndex,
      observed,
      toolNameSha256: sha256(toolName),
    };
    const event = await this.context.store.appendEvent({
      threadId: this.context.run.threadId,
      runId: this.context.run.id,
      type: "run.research.budget_exhausted",
      category: "lifecycle",
      visibility: "user",
      payload: {
        ...content,
        contentSha256: sha256(canonicalJson(content)),
      } as unknown as JsonObject,
    });
    await emit(this.context.onEvent, event);
  }
}

export function isResearchTool(toolName: string): boolean {
  return RESEARCH_TOOLS.has(toolName);
}

function blockResult(reason: "turns" | "elapsed") {
  return {
    block: true as const,
    reason: `Research budget exhausted: ${reason}. Reuse existing sources and converge on the deliverable.`,
  };
}

async function emit(
  sink: EventSink | undefined,
  event: RunEvent,
): Promise<void> {
  if (!sink) return;
  try {
    await sink(event);
  } catch {
    // Durable research-budget evidence survives a disconnected stream.
  }
}
