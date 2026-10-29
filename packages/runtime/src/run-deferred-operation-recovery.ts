import type { RunEvent, RunRecord } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { liveToolEffectAuthoritiesFromEvents } from "./sqlite-tool-effect-authority.js";
import { recoveryRunLeaseBindingSha256 } from "./tool-effect-indeterminate-event.js";
import { independentRecoveryBoundaryScope } from "./workspace-operation-recovery-scope.js";

export interface DeferredOperationHint {
  runId: string;
  bindingSha256: string;
}

/** A scheduling hint, never proof or an executor/replay grant. Unknown owners stay unknown. */
export function deferredOperationHint(run: RunRecord & { leaseTokenSha256?: string }, events: RunEvent[]): DeferredOperationHint | undefined {
  if ((run.status !== "queued" && run.status !== "running") || !nativeOwnerExited(run.lease?.ownerId)) return undefined;
  const authorities = liveToolEffectAuthoritiesFromEvents(events);
  if (!authorities.length || authorities.some((authority) => !authority.current || !authority.boundaryEvent)) return undefined;
  const boundaries = authorities.map((authority) => authority.boundaryEvent!).sort((a, b) => a.seq - b.seq);
  if (!independentRecoveryBoundaryScope(events, boundaries)) return undefined;
  return { runId: run.id, bindingSha256: sha256(canonicalJson({
    runId: run.id, threadId: run.threadId, lease: recoveryRunLeaseBindingSha256(run),
    boundaries,
    preparations: events.filter((event) => ["workspace.patch.prepared", "workspace.file.move.prepared"].includes(event.type)),
  })) };
}

/** Bounded work per sweep; the durable Run and journal rediscover hints on restart. */
export class DeferredOperationReinspection {
  readonly #pending = new Map<string, { hint: DeferredOperationHint; nextAttemptMs: number; attempts: number }>();

  remember(hints: readonly DeferredOperationHint[], nowMs: number): void {
    for (const hint of hints) {
      if (this.#pending.get(hint.runId)?.hint.bindingSha256 === hint.bindingSha256) continue;
      this.#pending.set(hint.runId, { hint, nextAttemptMs: nowMs + 1_000, attempts: 0 });
    }
  }

  due(nowMs: number): DeferredOperationHint[] {
    return [...this.#pending.values()].filter((entry) => entry.nextAttemptMs <= nowMs)
      .sort((a, b) => a.nextAttemptMs - b.nextAttemptMs || a.hint.runId.localeCompare(b.hint.runId))
      .slice(0, 8).map((entry) => entry.hint);
  }

  settle(attempted: readonly DeferredOperationHint[], deferred: readonly DeferredOperationHint[], nowMs: number): void {
    const retained = new Set(deferred.map((hint) => `${hint.runId}:${hint.bindingSha256}`));
    for (const hint of attempted) {
      const entry = this.#pending.get(hint.runId);
      if (entry?.hint.bindingSha256 !== hint.bindingSha256) continue;
      if (!retained.has(`${hint.runId}:${hint.bindingSha256}`)) this.#pending.delete(hint.runId);
      else {
        entry.attempts = Math.min(entry.attempts + 1, 5);
        entry.nextAttemptMs = nowMs + Math.min(30_000, 1_000 * 2 ** entry.attempts);
      }
    }
  }
}

function nativeOwnerExited(ownerId: string | undefined): boolean {
  const match = /^process:(\d+):/u.exec(ownerId ?? "");
  const pid = Number(match?.[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
}
