import type { ThreadDetail } from "@napier/contracts";
import { expect } from "vitest";

/** Keep parent outward delivery and native child evidence distinct and ordered. */
export function assertDelegatedChildLifecycle(detail: ThreadDetail, parentRunId: string): void {
    const delegated = detail.subagents[0]!;
    const childLifecycle = detail.events.filter((event) => event.runId === delegated.childRunId &&
      ["subagent.child.checkpoint_committed", "subagent.child.invocation_reserved", "model.response", "run.completed"].includes(event.type));
    expect(childLifecycle.map((event) => event.type)).toEqual([
      "subagent.child.checkpoint_committed", "subagent.child.invocation_reserved", "model.response",
      "subagent.child.checkpoint_committed", "run.completed",
    ]);
    const supervisorModelEvents = detail.events.filter((event) => event.type.startsWith("subagent.model."));
    expect(supervisorModelEvents.map((event) => event.type)).toEqual(["subagent.model.invocation", "subagent.model.response"]);
    for (const event of supervisorModelEvents) expect(event).toMatchObject({ runId: parentRunId, payload: {
      taskId: delegated.id, owner: { parentRunId: parentRunId, childRunId: delegated.childRunId, executionId: delegated.executionId },
    } });
    expect(childLifecycle[1]!.seq).toBeLessThan(supervisorModelEvents[0]!.seq);
    expect(supervisorModelEvents[0]!.seq).toBeLessThan(childLifecycle[2]!.seq);
    expect(childLifecycle[2]!.seq).toBeLessThan(supervisorModelEvents[1]!.seq);
    expect(supervisorModelEvents[1]!.seq).toBeLessThan(childLifecycle[3]!.seq);
    expect(childLifecycle[4]!.seq).toBeLessThan(detail.events.find((event) => event.type === "subagent.completed")!.seq);
}
