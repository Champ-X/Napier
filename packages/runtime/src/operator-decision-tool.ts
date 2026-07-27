import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

import type { OperatorDecisionMutation, LocalStore } from "./store.js";

const operatorDecisionSchema = Type.Object(
  {
    header: Type.String({
      minLength: 1,
      maxLength: 12,
      description:
        "A short 1-12 character label for the decision, such as Scope or Deploy.",
    }),
    question: Type.String({
      minLength: 1,
      maxLength: 4096,
      description:
        "The specific operator-owned question that blocks further work.",
    }),
    options: Type.Array(
      Type.Object(
        {
          label: Type.String({
            minLength: 1,
            maxLength: 80,
            description: "A concise option label.",
          }),
          description: Type.String({
            minLength: 1,
            maxLength: 400,
            description: "The concrete implication of selecting this option.",
          }),
        },
        { additionalProperties: false },
      ),
      {
        minItems: 2,
        maxItems: 4,
        description: "Two to four distinct choices.",
      },
    ),
    multiSelect: Type.Boolean({
      description:
        "Whether the operator may select more than one predefined option.",
    }),
  },
  { additionalProperties: false },
);

export interface CreateOperatorDecisionToolOptions {
  store: LocalStore;
  threadId: string;
  runId: string;
  onRequested?: (mutation: OperatorDecisionMutation) => Promise<void> | void;
}

export function createOperatorDecisionTool(
  options: CreateOperatorDecisionToolOptions,
): AgentTool<
  typeof operatorDecisionSchema,
  {
    operatorDecisionId: string;
    status: "pending";
    contentSha256: string;
  }
> {
  return {
    name: "request_operator_decision",
    label: "Request operator decision",
    description:
      "Pause the current task on one genuinely operator-owned choice. Use only when repository evidence, the request, and sensible defaults cannot resolve the decision. This must be the only tool call in the assistant turn. The Run ends after the durable request is recorded; the answer resumes work in a linked continuation Run.",
    parameters: operatorDecisionSchema,
    executionMode: "sequential",
    async execute(_toolCallId, input) {
      const mutation = await options.store.requestOperatorDecision({
        threadId: options.threadId,
        runId: options.runId,
        header: input.header,
        question: input.question,
        options: input.options,
        multiSelect: input.multiSelect,
      });
      try {
        await options.onRequested?.(mutation);
      } catch {
        // A disconnected event stream must not erase a durable decision.
      }
      return {
        content: [
          {
            type: "text",
            text: `Operator decision ${mutation.decision.id} is durable. Stop now and wait for the operator answer.`,
          },
        ],
        details: {
          operatorDecisionId: mutation.decision.id,
          status: "pending",
          contentSha256: mutation.decision.contentSha256,
        },
        terminate: true,
      };
    },
  };
}
