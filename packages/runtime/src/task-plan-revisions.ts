import type { RunEvent } from "@napier/contracts";
import { parseTaskPlanSnapshot } from "./task-plan-snapshot.js";

export function projectTaskPlanRevisions(events: readonly RunEvent[]) {
  const plans = new Map<
    string,
    {
      snapshot: NonNullable<ReturnType<typeof parseTaskPlanSnapshot>>;
      eventId: string;
      seq: number;
      conflicted: boolean;
    }
  >();
  const sourceEventIds = new Set<string>();
  for (const event of events) {
    if (event.type !== "tool.completed") continue;
    const payload = event.payload as Record<string, unknown> | null;
    if (
      !payload ||
      ![
        "create_plan",
        "replan_plan",
        "update_plan_step",
        "update_plan_artifact",
      ].includes(String(payload.toolName))
    )
      continue;
    const details = payload.details as Record<string, unknown> | undefined;
    const snapshot = parseTaskPlanSnapshot(details?.planState);
    if (
      !snapshot ||
      snapshot.threadId !== event.threadId ||
      snapshot.planId !== details?.planId
    )
      continue;
    sourceEventIds.add(event.id);
    const prior = plans.get(snapshot.planId);
    if (prior && snapshot.revision < prior.snapshot.revision) continue;
    const conflicted = Boolean(
      prior &&
      snapshot.revision === prior.snapshot.revision &&
      (prior.conflicted ||
        snapshot.contentSha256 !== prior.snapshot.contentSha256),
    );
    plans.set(snapshot.planId, {
      snapshot,
      eventId: event.id,
      seq: event.seq,
      conflicted,
    });
  }
  return {
    sourceEventIds,
    totalCount: plans.size,
    plans: [...plans.values()]
      .sort((a, b) => a.seq - b.seq)
      .slice(-4)
      .map(({ snapshot, eventId, seq, conflicted }) => ({
        planId: snapshot.planId,
        revision: snapshot.revision,
        eventId,
        seq,
        state: conflicted ? ("conflicting" as const) : ("observed" as const),
        snapshot: conflicted ? null : snapshot,
      })),
  };
}
