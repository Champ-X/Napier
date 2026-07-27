import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

import type { AgentMilestoneMutation, LocalStore } from "./store.js";

const milestoneItemSchema = Type.String({
  minLength: 1,
  maxLength: 500,
});

const agentMilestoneSchema = Type.Object(
  {
    phase: Type.Union([
      Type.Literal("planning"),
      Type.Literal("execution"),
      Type.Literal("verification"),
      Type.Literal("delivery"),
    ]),
    title: Type.String({ minLength: 1, maxLength: 80 }),
    summary: Type.String({ minLength: 1, maxLength: 4_000 }),
    completedItems: Type.Array(milestoneItemSchema, {
      maxItems: 12,
      description:
        "Concrete work completed since the previous milestone. Use an empty array when none is complete yet.",
    }),
    openLoops: Type.Array(milestoneItemSchema, {
      maxItems: 12,
      description:
        "Unfinished work, blockers, or verification still required. Use an empty array only when the phase is genuinely closed.",
    }),
  },
  { additionalProperties: false },
);

export interface CreateAgentMilestoneToolOptions {
  store: LocalStore;
  threadId: string;
  runId: string;
  onRecorded?: (mutation: AgentMilestoneMutation) => Promise<void> | void;
}

export function createAgentMilestoneTool(
  options: CreateAgentMilestoneToolOptions,
): AgentTool<
  typeof agentMilestoneSchema,
  {
    milestoneId: string;
    phase: string;
    sequence: number;
    evidenceEventCount: number;
    contentSha256: string;
  }
> {
  return {
    name: "record_run_milestone",
    label: "Record run milestone",
    description:
      "Record an immutable, durable progress snapshot after a meaningful phase boundary. Include concrete completed work and every open loop. The runtime automatically binds all same-Run Ledger events since the previous milestone as hash evidence. Do not call after every minor action.",
    parameters: agentMilestoneSchema,
    executionMode: "sequential",
    async execute(_toolCallId, input) {
      const mutation = await options.store.recordAgentMilestone({
        threadId: options.threadId,
        runId: options.runId,
        phase: input.phase,
        title: input.title,
        summary: input.summary,
        completedItems: input.completedItems,
        openLoops: input.openLoops,
      });
      try {
        await options.onRecorded?.(mutation);
      } catch {
        // A disconnected stream must not erase a durable milestone.
      }
      return {
        content: [
          {
            type: "text",
            text: `Milestone ${mutation.milestone.id} is durable with ${mutation.milestone.evidence.eventCount} bound Ledger events.`,
          },
        ],
        details: {
          milestoneId: mutation.milestone.id,
          phase: mutation.milestone.phase,
          sequence: mutation.milestone.sequence,
          evidenceEventCount: mutation.milestone.evidence.eventCount,
          contentSha256: mutation.milestone.contentSha256,
        },
      };
    },
  };
}
