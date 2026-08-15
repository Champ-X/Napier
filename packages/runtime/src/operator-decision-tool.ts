import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

import type { OperatorDecisionMutation, LocalStore } from "./store.js";

const operatorDecisionSchema = Type.Object(
  {
    header: Type.String({
      minLength: 1,
      maxLength: 12,
    }),
    question: Type.String({
      minLength: 1,
      maxLength: 4096,
    }),
    options: Type.Array(
      Type.Object(
        {
          label: Type.String({
            minLength: 1,
            maxLength: 80,
          }),
          description: Type.String({
            minLength: 1,
            maxLength: 400,
          }),
        },
        { additionalProperties: false },
      ),
      {
        minItems: 2,
        maxItems: 4,
      },
    ),
    multiSelect: Type.Boolean(),
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
      "Pause only for an operator-owned choice that evidence, the request, and defaults cannot resolve. Never pre-confirm Browser interactions; call Browser directly for Napier's exact action-bound confirmation. Provide a 1-12 character header, one question, 2-4 labeled options with implications, and multiSelect. This must be the turn's only call; it ends the Run until a linked continuation.",
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
