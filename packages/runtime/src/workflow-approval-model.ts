import type {
  ExecutionPlanWorkflowApprovalNode,
  JsonValue,
  OperatorDecision,
} from "@napier/contracts";

export type WorkflowApprovalResolution =
  | {
      status: "approved";
      output: JsonValue;
    }
  | {
      status: "rejected";
    }
  | {
      status: "invalid";
    };

export function resolveWorkflowApproval(
  node: ExecutionPlanWorkflowApprovalNode,
  decision: OperatorDecision,
): WorkflowApprovalResolution {
  if (
    !workflowApprovalDecisionContractMatches(node, decision) ||
    !decision.answerSha256
  ) {
    return { status: "invalid" };
  }
  if (
    decision.selectedOptionIds?.length === 1 &&
    decision.selectedOptionIds[0] === "option_1"
  ) {
    return {
      status: "approved",
      output: {
        approved: true,
        decisionId: decision.id,
        selectedOptionId: "option_1",
        answerSha256: decision.answerSha256,
        customText: decision.customText ?? "",
      },
    };
  }
  if (
    decision.selectedOptionIds?.length === 1 &&
    decision.selectedOptionIds[0] === "option_2"
  ) {
    return { status: "rejected" };
  }
  return { status: "invalid" };
}

export function workflowApprovalDecisionContractMatches(
  node: ExecutionPlanWorkflowApprovalNode,
  decision: OperatorDecision,
): boolean {
  return (
    decision.header === node.header &&
    decision.question === node.question &&
    !decision.multiSelect &&
    decision.options.length === 2 &&
    decision.options[0]?.id === "option_1" &&
    decision.options[0].label === node.approve.label &&
    decision.options[0].description === node.approve.description &&
    decision.options[1]?.id === "option_2" &&
    decision.options[1].label === node.reject.label &&
    decision.options[1].description === node.reject.description
  );
}

export function workflowApprovalAnsweredBeforeExpiry(
  decision: OperatorDecision,
  expiresAt: string,
): boolean {
  return (
    decision.answeredAt !== undefined &&
    Date.parse(decision.answeredAt) <= Date.parse(expiresAt)
  );
}
