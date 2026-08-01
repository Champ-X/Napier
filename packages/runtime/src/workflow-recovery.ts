import type {
  ExecutionPlanWorkflowNode,
  ExecutionPlanWorkflowNodeResult,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import type { LocalStore } from "./store.js";
import type {
  WorkflowExecutionContext,
  WorkflowNodeFailure,
} from "./workflow-context.js";
import { evaluateExecutionPlanWorkflowCondition } from "./workflow-condition-model.js";
import {
  ExecutionPlanWorkflowLedger,
  isWorkflowRecord,
  workflowNodeEventMetadataMatches,
  WORKFLOW_EVENT_SCHEMA_VERSION,
  WORKFLOW_NODE_FAILED_EVENT,
} from "./workflow-ledger.js";
import {
  completedWorkflowNodeResult,
  skippedWorkflowNodeResult,
} from "./workflow-runtime-model.js";
import {
  buildWorkflowExecutionNodeInput,
  workflowExecutionNodeBindingContextSha256,
} from "./workflow-node-input.js";
import { workflowSchemaSha256 } from "./workflow-schemas.js";

export interface WorkflowRecoveryOperations {
  blockNode(
    context: WorkflowExecutionContext,
    node: ExecutionPlanWorkflowNode,
    failure: WorkflowNodeFailure,
  ): Promise<ExecutionPlanWorkflowNodeResult>;
  completePlanStep(
    context: WorkflowExecutionContext,
    nodeId: string,
    runId: string,
    outputSha256: string,
  ): Promise<void>;
}

export class ExecutionPlanWorkflowRecovery {
  constructor(
    private readonly store: LocalStore,
    private readonly ledger: ExecutionPlanWorkflowLedger,
    private readonly operations: WorkflowRecoveryOperations,
  ) {}

  async recoverCompletedAndInterruptedNodes(
    context: WorkflowExecutionContext,
  ): Promise<void> {
    const orderedNodeIds = context.plan.phaseWaves.flatMap(
      (wave) => wave.stepIds,
    );
    const nodeById = new Map(
      context.manifest.nodes.map((node) => [node.id, node]),
    );
    let madeProgress = true;
    while (madeProgress) {
      madeProgress = false;
      context.plan = this.store.getPlan(context.plan.id);
      for (const nodeId of orderedNodeIds) {
        if (context.nodeResults.has(nodeId)) continue;
        const node = nodeById.get(nodeId)!;
        let step = context.plan.steps.find(
          (candidate) => candidate.id === nodeId,
        )!;
        if (step.status === "skipped") {
          if (
            Object.values(node.inputBindings).some(
              (binding) =>
                binding.source === "node" &&
                !context.outputs.has(binding.nodeId),
            )
          ) {
            continue;
          }
          if (!node.when || node.skipOutput === undefined) {
            throw new Error(
              "Workflow Plan contains an unauthorized skipped node",
            );
          }
          const input = buildWorkflowExecutionNodeInput(context, node);
          const inputSha256 = sha256(canonicalJson(input));
          const evaluation = evaluateExecutionPlanWorkflowCondition(
            node.when,
            input,
            node.id,
          );
          if (evaluation.matched) {
            throw new Error("Workflow skipped condition no longer matches");
          }
          await this.ledger.verifyOrRecoverNodeSkippedEvent(
            context,
            node,
            inputSha256,
            evaluation.subjectSha256,
            context.reusedNodes.some(
              (reused) =>
                reused.nodeId === node.id && reused.sourceStatus === "skipped",
            ),
          );
          await this.ledger.ensurePlanStepEvent(
            context,
            context.plan,
            node.id,
            "skipped",
            createId("runctl"),
          );
          context.outputs.set(node.id, structuredClone(node.skipOutput));
          context.nodeResults.set(
            node.id,
            skippedWorkflowNodeResult(node, inputSha256, node.skipOutput),
          );
          madeProgress = true;
          continue;
        }
        if (node.type === "approval" && step.status === "running") {
          continue;
        }
        if (
          step.status !== "completed" &&
          step.status !== "running" &&
          !(
            step.status === "blocked" &&
            (node.type === "tool" ||
              node.type === "deterministic" ||
              node.type === "map" ||
              node.type === "loop" ||
              node.type === "reduce") &&
            step.runId !== undefined
          )
        ) {
          continue;
        }
        if (
          Object.values(node.inputBindings).some(
            (binding) =>
              binding.source === "node" && !context.outputs.has(binding.nodeId),
          )
        ) {
          continue;
        }
        const input = buildWorkflowExecutionNodeInput(context, node);
        const inputSha256 = sha256(canonicalJson(input));
        if (
          node.when &&
          !evaluateExecutionPlanWorkflowCondition(node.when, input, node.id)
            .matched
        ) {
          throw new Error("Executed Workflow node condition no longer matches");
        }
        if (!step.runId) {
          throw new Error("Workflow Plan step is missing its Run binding");
        }
        const run = this.store
          .listRuns(context.threadId)
          .find((candidate) => candidate.id === step.runId);
        if (!run) throw new Error("Workflow node Run is missing");
        await this.ledger.ensureNodeStartedEvent(
          context,
          node,
          run.id,
          inputSha256,
        );
        let knownRecoverableOutput;
        if (
          (node.type === "tool" ||
            node.type === "deterministic" ||
            node.type === "map" ||
            node.type === "loop" ||
            node.type === "reduce") &&
          run.status !== "running" &&
          run.status !== "queued" &&
          (node.type === "tool"
            ? await this.ledger.hasNodeToolCompletionEvent(
                context,
                node,
                run.id,
              )
            : node.type === "deterministic"
              ? await this.ledger.hasNodeDeterministicCompletionEvent(
                  context,
                  node,
                  run.id,
                )
              : node.type === "map"
                ? await this.ledger.hasNodeMapCompletionEvent(
                    context,
                    node,
                    run.id,
                  )
                : node.type === "loop"
                  ? await this.ledger.hasNodeLoopCompletionEvent(
                      context,
                      node,
                      run.id,
                    )
                  : await this.ledger.hasNodeReduceCompletionEvent(
                      context,
                      node,
                      run.id,
                    ))
        ) {
          knownRecoverableOutput = await this.ledger.nodeOutput(
            context,
            node,
            run.id,
            inputSha256,
            input,
          );
        }
        if (step.status === "blocked") {
          if (knownRecoverableOutput === undefined) continue;
          context.plan = await this.store.recoverCompletedWorkflowPlanStep(
            context.plan.id,
            node.id,
            run.id,
            `Workflow output ${sha256(canonicalJson(knownRecoverableOutput))} passed its runtime schema before Run settlement was interrupted.`,
          );
          step = context.plan.steps.find(
            (candidate) => candidate.id === nodeId,
          )!;
        }
        if (step.status === "running") {
          if (run.status === "running" || run.status === "queued") {
            throw new Error("Workflow node Run is still active");
          }
          if (run.status !== "completed") {
            if (knownRecoverableOutput === undefined) {
              const blocked = await this.operations.blockNode(context, node, {
                runId: run.id,
                inputSha256,
                errorCode: `run_${run.status}`,
                diagnosticSha256: sha256(run.error ?? run.status),
                attempt: await this.ledger.attemptForRun(
                  context.threadId,
                  context.plan.id,
                  node.id,
                  run.id,
                ),
              });
              context.nodeResults.set(node.id, blocked);
              madeProgress = true;
              continue;
            }
          }
        }
        if (
          run.status !== "completed" &&
          !(node.type === "approval" && run.status === "interrupted") &&
          knownRecoverableOutput === undefined
        ) {
          throw new Error("Completed Workflow step has a non-completed Run");
        }
        let output;
        try {
          output =
            knownRecoverableOutput ??
            (await this.ledger.nodeOutput(
              context,
              node,
              run.id,
              inputSha256,
              input,
            ));
        } catch (error) {
          if (step.status !== "running") throw error;
          const blocked = await this.operations.blockNode(context, node, {
            runId: run.id,
            inputSha256,
            errorCode: "output_invalid",
            diagnosticSha256: sha256(errorMessage(error)),
            attempt: await this.ledger.attemptForRun(
              context.threadId,
              context.plan.id,
              node.id,
              run.id,
            ),
          });
          context.nodeResults.set(node.id, blocked);
          madeProgress = true;
          continue;
        }
        const outputSha256 = sha256(canonicalJson(output));
        await this.ledger.verifyOrRecoverNodeCompletedEvent(
          context,
          node,
          run.id,
          inputSha256,
          outputSha256,
        );
        if (step.status === "running") {
          await this.operations.completePlanStep(
            context,
            node.id,
            run.id,
            outputSha256,
          );
        } else {
          await this.ledger.ensurePlanStepEvent(
            context,
            context.plan,
            node.id,
            "completed",
            run.id,
          );
        }
        const result = completedWorkflowNodeResult(
          node,
          await this.ledger.attemptForRun(
            context.threadId,
            context.plan.id,
            node.id,
            run.id,
          ),
          run.id,
          inputSha256,
          output,
        );
        context.outputs.set(node.id, structuredClone(output));
        context.nodeResults.set(node.id, result);
        madeProgress = true;
      }
    }
  }

  async reopenInterruptedPureNodes(
    context: WorkflowExecutionContext,
  ): Promise<void> {
    context.plan = this.store.getPlan(context.plan.id);
    for (const node of context.manifest.nodes) {
      if (
        node.type !== "deterministic" &&
        node.type !== "loop" &&
        node.type !== "reduce"
      ) {
        continue;
      }
      const result = context.nodeResults.get(node.id);
      const step = context.plan.steps.find(
        (candidate) => candidate.id === node.id,
      );
      if (
        !result ||
        result.status !== "blocked" ||
        result.errorCode !== "run_interrupted" ||
        result.attempt >= node.maxAttempts ||
        step?.status !== "blocked" ||
        !step.runId
      ) {
        continue;
      }
      const run = this.store
        .listRuns(context.threadId)
        .find((candidate) => candidate.id === step.runId);
      if (run?.source === "workflow_simulation") continue;
      if (!run || run.source !== "workflow" || run.status !== "interrupted") {
        throw new Error("Interrupted pure Workflow Run binding is invalid");
      }
      const before = context.plan;
      context.plan = await this.store.transitionPlanStep(
        context.plan.id,
        node.id,
        { action: "reopen" },
      );
      if (context.plan.revision !== before.revision) {
        await this.ledger.appendPlanStepEvent(
          context,
          context.plan,
          node.id,
          "reopened",
          createId("runctl"),
        );
        context.nodeResults.delete(node.id);
      }
    }
  }

  async reopenRetryableNodes(context: WorkflowExecutionContext): Promise<void> {
    context.plan = this.store.getPlan(context.plan.id);
    for (const node of context.manifest.nodes) {
      const step = context.plan.steps.find(
        (candidate) => candidate.id === node.id,
      )!;
      if (step.status !== "blocked") continue;
      const run = step.runId
        ? this.store
            .listRuns(context.threadId)
            .find((candidate) => candidate.id === step.runId)
        : undefined;
      if (
        run?.source === "workflow_reuse" ||
        run?.source === "workflow_simulation"
      ) {
        continue;
      }
      const attempts =
        (await this.ledger.nextAttempt(
          context.threadId,
          context.plan.id,
          node.id,
        )) - 1;
      if (attempts >= node.maxAttempts) continue;
      const before = context.plan;
      context.plan = await this.store.transitionPlanStep(
        context.plan.id,
        node.id,
        { action: "reopen" },
      );
      if (context.plan.revision !== before.revision) {
        await this.ledger.appendPlanStepEvent(
          context,
          context.plan,
          node.id,
          "reopened",
          createId("runctl"),
        );
        context.nodeResults.delete(node.id);
      }
    }
  }

  async recoverBlockedNodeResults(
    context: WorkflowExecutionContext,
  ): Promise<void> {
    context.plan = this.store.getPlan(context.plan.id);
    const events = await this.store.listEvents(context.threadId);
    for (const node of context.manifest.nodes) {
      const step = context.plan.steps.find(
        (candidate) => candidate.id === node.id,
      )!;
      if (step.status !== "blocked" || context.nodeResults.has(node.id)) {
        continue;
      }
      let expectedInputSha256: string;
      try {
        const nodeInput = buildWorkflowExecutionNodeInput(context, node);
        expectedInputSha256 = sha256(canonicalJson(nodeInput));
      } catch {
        expectedInputSha256 = workflowExecutionNodeBindingContextSha256(
          context,
          node,
        );
      }
      const failed = [...events]
        .reverse()
        .find(
          (event) =>
            event.type === WORKFLOW_NODE_FAILED_EVENT &&
            isWorkflowRecord(event.payload) &&
            event.payload["planId"] === context.plan.id &&
            event.payload["nodeId"] === node.id,
        );
      if (failed && isWorkflowRecord(failed.payload)) {
        const attempt = failed.payload["attempt"];
        const inputSha256 = failed.payload["inputSha256"];
        const inputSchemaSha256 = failed.payload["inputSchemaSha256"];
        const outputSchemaSha256 = failed.payload["outputSchemaSha256"];
        const errorCode = failed.payload["errorCode"];
        const diagnosticSha256 = failed.payload["diagnosticSha256"];
        if (
          failed.payload["schemaVersion"] !== WORKFLOW_EVENT_SCHEMA_VERSION ||
          failed.payload["manifestSha256"] !== context.manifest.contentSha256 ||
          !Number.isSafeInteger(attempt) ||
          Number(attempt) < 1 ||
          Number(attempt) > node.maxAttempts ||
          !hash(inputSha256) ||
          inputSha256 !== expectedInputSha256 ||
          inputSchemaSha256 !== workflowSchemaSha256(node.inputSchema) ||
          outputSchemaSha256 !== workflowSchemaSha256(node.outputSchema) ||
          !workflowNodeEventMetadataMatches(node, failed.payload) ||
          !safeToken(errorCode) ||
          !hash(diagnosticSha256)
        ) {
          throw new Error("Workflow node failure evidence mismatch");
        }
        if (step.runId) {
          const failedRun = this.store
            .listRuns(context.threadId)
            .find((candidate) => candidate.id === step.runId);
          if (!failedRun) throw new Error("Workflow node Run is missing");
          await this.ledger.ensureNodeStartedEvent(
            context,
            node,
            failedRun.id,
            expectedInputSha256,
          );
          if (
            failed.runId !== step.runId ||
            Number(attempt) !==
              (await this.ledger.attemptForRun(
                context.threadId,
                context.plan.id,
                node.id,
                step.runId,
              ))
          ) {
            throw new Error("Workflow node failure Run evidence mismatch");
          }
        }
        context.nodeResults.set(node.id, {
          nodeId: node.id,
          attempt: Number(attempt),
          status: errorCode === "cancelled" ? "cancelled" : "blocked",
          ...(step.runId ? { runId: step.runId } : {}),
          inputSha256,
          inputSchemaSha256,
          outputSchemaSha256,
          errorCode,
          diagnosticSha256,
        });
        continue;
      }
      const run = step.runId
        ? this.store
            .listRuns(context.threadId)
            .find((candidate) => candidate.id === step.runId)
        : undefined;
      if (step.runId && !run) {
        throw new Error("Workflow node Run is missing");
      }
      if (run) {
        await this.ledger.ensureNodeStartedEvent(
          context,
          node,
          run.id,
          expectedInputSha256,
        );
      }
      const attempt = run
        ? await this.ledger.attemptForRun(
            context.threadId,
            context.plan.id,
            node.id,
            run.id,
          )
        : Math.min(
            node.maxAttempts,
            await this.ledger.nextAttempt(
              context.threadId,
              context.plan.id,
              node.id,
            ),
          );
      const recoveredFailure =
        run?.status === "interrupted"
          ? {
              errorCode: "run_interrupted",
              diagnosticSha256: sha256(run.error ?? "interrupted"),
            }
          : failureFromPlanEvidence(step.blocker, step.evidence, run?.status);
      await this.ledger.ensurePlanStepEvent(
        context,
        context.plan,
        node.id,
        "blocked",
        run?.id ?? createId("runctl"),
      );
      const result = await this.operations.blockNode(context, node, {
        ...(run ? { runId: run.id } : {}),
        inputSha256: expectedInputSha256,
        attempt,
        ...recoveredFailure,
      });
      context.nodeResults.set(node.id, result);
    }
  }
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function safeToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(value);
}

function failureFromPlanEvidence(
  blocker: string | undefined,
  evidence: string,
  runStatus: string | undefined,
): { errorCode: string; diagnosticSha256: string } {
  const errorCode = blocker?.match(
    /^Workflow node failed \(([a-z][a-z0-9_]{0,63})\)\.$/u,
  )?.[1];
  const diagnosticSha256 = evidence.match(
    /^Diagnostic SHA-256: ([a-f0-9]{64})$/u,
  )?.[1];
  if (errorCode && diagnosticSha256) {
    return { errorCode, diagnosticSha256 };
  }
  return {
    errorCode:
      runStatus && safeToken(`run_${runStatus}`)
        ? `run_${runStatus}`
        : "recovery_evidence_gap",
    diagnosticSha256: sha256(
      canonicalJson({
        blocker: blocker ?? "",
        evidence,
        runStatus: runStatus ?? "",
      }),
    ),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
