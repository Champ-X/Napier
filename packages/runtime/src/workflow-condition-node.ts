import type {
  ExecutionPlanWorkflowNode,
  ExecutionPlanWorkflowNodeResult,
} from "@napier/contracts";

import { createId } from "./ids.js";
import type { LocalStore } from "./store.js";
import type { WorkflowExecutionContext } from "./workflow-context.js";
import type { ExecutionPlanWorkflowConditionEvaluation } from "./workflow-condition-model.js";
import { ExecutionPlanWorkflowLedger } from "./workflow-ledger.js";
import { skippedWorkflowNodeResult } from "./workflow-runtime-model.js";

export class ExecutionPlanWorkflowConditionNodeExecutor {
  constructor(
    private readonly store: LocalStore,
    private readonly ledger: ExecutionPlanWorkflowLedger,
  ) {}

  async skip(
    context: WorkflowExecutionContext,
    node: ExecutionPlanWorkflowNode,
    inputSha256: string,
    evaluation: ExecutionPlanWorkflowConditionEvaluation,
  ): Promise<ExecutionPlanWorkflowNodeResult> {
    if (evaluation.matched || !node.when || node.skipOutput === undefined) {
      throw new Error("Workflow conditional skip is invalid");
    }
    const current = this.store.getPlan(context.plan.id);
    const step = current.steps.find((candidate) => candidate.id === node.id);
    if (step?.status !== "ready") {
      throw new Error("Workflow conditional node is not dependency-ready");
    }
    context.plan = await this.store.transitionPlanStep(
      context.plan.id,
      node.id,
      {
        action: "skip",
        evidence: `Workflow condition ${evaluation.subjectSha256} did not match its Manifest value.`,
      },
    );
    await this.ledger.appendPlanStepEvent(
      context,
      context.plan,
      node.id,
      "skipped",
      createId("runctl"),
    );
    await this.ledger.appendNodeSkippedEvent(
      context,
      node,
      inputSha256,
      evaluation.subjectSha256,
      false,
    );
    return skippedWorkflowNodeResult(node, inputSha256, node.skipOutput);
  }
}
