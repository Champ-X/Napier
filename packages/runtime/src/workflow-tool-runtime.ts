import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  ExecutionPlanWorkflowToolNode,
  JsonValue,
  RunRecord,
} from "@napier/contracts";
import type { ToolInvocationProtocolV2 } from "@napier/contracts/tool-protocol";
import { Check } from "typebox/value";

import type { EventSink } from "./event-sink.js";
import {
  bindBuiltInToolCompatibilityPolicy,
  hasBoundAgentToolCompatibilityPolicy,
} from "./agent-tool-effects.js";
import { agentToolResultText } from "./agent-tool-result-text.js";
import { toJsonValue } from "./agent-runtime-utils.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId, createProcessLeaseOwnerId } from "./ids.js";
import { gitStageMutationManagerFor } from "./git-stage.js";
import { assessToolCall } from "./policy.js";
import { createStatelessAgentTools } from "./stateless-agent-tools.js";
import {
  createOwnedToolRecordV2,
  type OwnedToolRecordV2,
} from "./owned-tool-protocol.js";
import type { LocalStore } from "./store.js";
import { ToolConcurrencyGate } from "./tool-concurrency-gate.js";
import {
  executeAdmittedToolCall,
  ToolExecutionRetryLineageError,
} from "./tool-execution-admission-service.js";
import { assertWorkflowValue } from "./workflow-schemas.js";
import { ExecutionPlanWorkflowLedger } from "./workflow-ledger.js";
import { WORKFLOW_NODE_EXECUTION } from "./workflow-node-execution.js";
import {
  workflowToolCallId,
  workflowToolInputLedgerProjection,
  workflowToolOutputLedgerProjection,
} from "./workflow-tool-execution-evidence.js";
import type { WorkflowRuntimeEnvironment } from "./workflow-runtime-ports.js";

const RUN_LEASE_TTL_MS = 60_000;
const RUN_LEASE_HEARTBEAT_MS = 20_000;

export interface ExecuteExecutionPlanWorkflowToolOptions {
  threadId: string;
  planId: string;
  agentId: string;
  agentRevision: number;
  node: ExecutionPlanWorkflowToolNode;
  input: JsonValue;
  inputSha256: string;
  attempt: number;
  signal: AbortSignal;
  wasTimedOut?(): boolean;
  onEvent?: EventSink;
  onRunCreated(run: RunRecord): Promise<void>;
}

export interface ExecutionPlanWorkflowToolOutcome {
  run: RunRecord;
  output: JsonValue;
}

export function resolveOwnedWorkflowToolEffect(
  tool: AgentTool,
  input: unknown,
):
  | {
      effect: "read" | "write";
      protocol: OwnedToolRecordV2;
      invocation: ToolInvocationProtocolV2;
    }
  | undefined {
  const protocol = createOwnedToolRecordV2(tool);
  const invocation = protocol.invocation(input);
  const trusted =
    invocation.compatibilityMode === "native" ||
    hasBoundAgentToolCompatibilityPolicy(tool);
  if (!trusted) return undefined;
  return {
    protocol,
    invocation,
    effect: invocation.sideEffect === "none" ? "read" : "write",
  };
}

export class ExecutionPlanWorkflowToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly run?: RunRecord,
  ) {
    super(message);
    this.name = "ExecutionPlanWorkflowToolError";
  }
}

export class ExecutionPlanWorkflowToolRuntime {
  private readonly workerId = createProcessLeaseOwnerId("workflowtool");
  private readonly concurrencyGate: ToolConcurrencyGate;

  constructor(
    private readonly store: LocalStore,
    private readonly environment: WorkflowRuntimeEnvironment,
    private readonly ledger: ExecutionPlanWorkflowLedger,
  ) {
    this.concurrencyGate = new ToolConcurrencyGate({
      durable: {
        backend: store.toolConcurrencyLeaseBackend(),
        ownerId: this.workerId,
      },
    });
  }

  async execute(
    options: ExecuteExecutionPlanWorkflowToolOptions,
  ): Promise<ExecutionPlanWorkflowToolOutcome> {
    options.signal.throwIfAborted();
    const profile = this.store.getAgentRevision(
      options.agentId,
      options.agentRevision,
    ).profile;
    const leased = await this.store.createLeasedRun(
      {
        threadId: options.threadId,
        agentId: options.agentId,
        agentRevision: options.agentRevision,
        model: profile.model,
        source: "workflow",
        [WORKFLOW_NODE_EXECUTION]: { planId: options.planId },
      },
      {
        ownerId: this.workerId,
        ttlMs: RUN_LEASE_TTL_MS,
      },
    );
    let settled = false;
    let toolStarted = false;
    let toolCallId: string | undefined;
    let leaseLost = false;
    const executionController = new AbortController();
    const forwardAbort = (): void => executionController.abort();
    options.signal.addEventListener("abort", forwardAbort, { once: true });
    if (options.signal.aborted) executionController.abort();
    const heartbeat = setInterval(() => {
      void this.store
        .renewRunLease(leased.run.id, leased.token, RUN_LEASE_TTL_MS)
        .catch(() => {
          leaseLost = true;
          executionController.abort();
        });
    }, RUN_LEASE_HEARTBEAT_MS);
    try {
      executionController.signal.throwIfAborted();
      await options.onRunCreated(leased.run);
      await this.ledger.append(
        {
          threadId: options.threadId,
          runId: leased.run.id,
          type: "run.started",
          category: "lifecycle",
          visibility: "debug",
          payload: {
            agentId: options.agentId,
            agentRevision: options.agentRevision,
            model: `${profile.model.provider}/${profile.model.id}`,
            source: "workflow",
            workflowNodeType: "tool",
            workflowToolName: options.node.tool,
            configurationSha256: leased.run.configuration?.contentSha256 ?? "",
          },
        },
        options.onEvent,
      );

      const tools = createStatelessAgentTools({
        store: this.store,
        profile,
        threadId: options.threadId,
        runId: leased.run.id,
        sandbox: this.environment.verificationSandbox,
        ...(this.environment.workspaceFileMutations
          ? {
              workspaceFileMutations: this.environment.workspaceFileMutations,
            }
          : {}),
        gitStageMutations: gitStageMutationManagerFor(
          this.store,
          this.environment.verificationSandbox,
        ),
        gitStageScopeId: options.planId,
        gitCommitScopeId: options.planId,
        gitBranchScopeId: options.planId,
        gitBranchSwitchScopeId: options.planId,
        gitReviewScopeId: options.planId,
      }).map(bindBuiltInToolCompatibilityPolicy);
      const tool = tools.find(
        (candidate) => candidate.name === options.node.tool,
      );
      if (!tool) {
        const errorCode = profile.enabledTools.includes(options.node.tool)
          ? "policy_denied"
          : "tool_unavailable";
        await this.blockTool(options, leased.run, errorCode);
        throw new ExecutionPlanWorkflowToolError(
          errorCode,
          errorCode === "policy_denied"
            ? "Workflow tool policy denied execution"
            : "Workflow tool is not enabled or available",
          leased.run,
        );
      }

      let args: unknown = options.input;
      try {
        args = tool.prepareArguments
          ? tool.prepareArguments(options.input)
          : options.input;
      } catch {
        await this.blockTool(options, leased.run, "arguments_invalid");
        throw new ExecutionPlanWorkflowToolError(
          "arguments_invalid",
          "Workflow tool arguments are invalid",
          leased.run,
        );
      }
      let argumentsValid = false;
      try {
        argumentsValid = Check(tool.parameters, args);
      } catch {
        argumentsValid = false;
      }
      if (!argumentsValid) {
        await this.blockTool(options, leased.run, "arguments_invalid");
        throw new ExecutionPlanWorkflowToolError(
          "arguments_invalid",
          "Workflow tool arguments are invalid",
          leased.run,
        );
      }
      const jsonArgs = toJsonValue(args);
      const owned = resolveOwnedWorkflowToolEffect(tool, jsonArgs);
      if (!owned || owned.effect !== options.node.effect) {
        await this.blockTool(options, leased.run, "effect_mismatch");
        throw new ExecutionPlanWorkflowToolError(
          "effect_mismatch",
          "Workflow tool effect does not match the Manifest",
          leased.run,
        );
      }
      const { effect, protocol } = owned;
      const decision = assessToolCall(
        profile.toolPolicy,
        options.node.tool,
        jsonArgs,
        this.store.workspaceRoot,
        owned.invocation,
      );
      if (!decision.allowed) {
        await this.blockTool(options, leased.run, "policy_denied");
        throw new ExecutionPlanWorkflowToolError(
          "policy_denied",
          "Workflow tool policy denied execution",
          leased.run,
        );
      }

      executionController.signal.throwIfAborted();
      toolCallId = workflowToolCallId({
        threadId: options.threadId,
        planId: options.planId,
        nodeId: options.node.id,
        attempt: options.attempt,
        inputSha256: options.inputSha256,
      });
      const inputProjection = workflowToolInputLedgerProjection(
        options.node.tool,
        jsonArgs,
      );
      const admitted = await executeAdmittedToolCall({
        store: this.store,
        run: leased.run,
        callId: toolCallId,
        toolName: options.node.tool,
        args,
        protocol,
        concurrencyGate: this.concurrencyGate,
        signal: executionController.signal,
        retryLineage: {
          namespace: "workflow.tool-node",
          binding: {
            threadId: options.threadId,
            planId: options.planId,
            nodeId: options.node.id,
            inputSha256: options.inputSha256,
          },
          attempt: options.attempt,
          maxAttempts: options.node.maxAttempts,
        },
        admissionVisibility: "user",
        admissionPayload: {
          workflowPlanId: options.planId,
          workflowNodeId: options.node.id,
          workflowAttempt: options.attempt,
          workflowInputSha256: options.inputSha256,
        },
        startedPayload: {
          ...inputProjection,
          effect,
          workflowPlanId: options.planId,
          workflowNodeId: options.node.id,
          workflowAttempt: options.attempt,
          workflowInputSha256: options.inputSha256,
        },
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
        onStarted: () => {
          toolStarted = true;
        },
        execute: () =>
          tool.execute(toolCallId!, args as never, executionController.signal),
        settlement: (result) => {
          const output = toJsonValue(result.details);
          try {
            assertWorkflowValue(
              options.node.outputSchema,
              output,
              `Workflow tool output ${options.node.id}`,
            );
          } catch {
            throw new ExecutionPlanWorkflowToolError(
              "output_invalid",
              "Workflow tool output does not match its schema",
              leased.run,
            );
          }
          return { result, isError: false };
        },
      });
      const result = admitted.value;
      const output = toJsonValue(result.details);
      const outputSha256 = sha256(canonicalJson(output));
      const outputText = agentToolResultText(result);
      const outputProjection = workflowToolOutputLedgerProjection(
        options.node.tool,
        outputText,
        result,
      );
      await this.ledger.append(
        {
          threadId: options.threadId,
          runId: leased.run.id,
          type: "tool.completed",
          category: "tool",
          visibility: "user",
          payload: {
            ...outputProjection,
            callId: toolCallId,
            toolName: options.node.tool,
            status: "completed",
            effect,
            workflowPlanId: options.planId,
            workflowNodeId: options.node.id,
            workflowAttempt: options.attempt,
            workflowInputSha256: options.inputSha256,
            workflowOutput: output,
            workflowOutputSha256: outputSha256,
          },
        },
        options.onEvent,
      );
      const run = await this.store.finishRun(leased.run.id, "completed", {
        leaseToken: leased.token,
        terminalEvent: {
          visibility: "debug",
          payload: { status: "completed" },
        },
        onTerminalEvent: options.onEvent,
      });
      settled = true;
      return { run, output };
    } catch (error) {
      if (settled) throw error;
      const timedOut = options.wasTimedOut?.() === true;
      const cancelled = options.signal.aborted && !timedOut;
      const code =
        admittedToolErrorCode(error) ??
        (leaseLost
          ? "lease_lost"
          : timedOut
            ? "timeout"
            : cancelled
              ? "cancelled"
              : "tool_failed");
      const diagnosticSha256 = sha256(errorMessage(error));
      if (toolStarted && toolCallId) {
        await this.ledger
          .append(
            {
              threadId: options.threadId,
              runId: leased.run.id,
              type: "tool.failed",
              category: "tool",
              visibility: "user",
              payload: {
                callId: toolCallId,
                toolName: options.node.tool,
                status: "failed",
                effect: options.node.effect,
                workflowPlanId: options.planId,
                workflowNodeId: options.node.id,
                workflowAttempt: options.attempt,
                workflowInputSha256: options.inputSha256,
                errorCode: code,
                diagnosticSha256,
              },
            },
            options.onEvent,
          )
          .catch(() => undefined);
      }
      await this.store
        .finishRun(leased.run.id, cancelled ? "cancelled" : "failed", {
          error: `Workflow tool ${code}`,
          leaseToken: leased.token,
          terminalEvent: {
            visibility: "user",
            payload: {
              status: cancelled ? "cancelled" : "failed",
              errorCode: code,
              diagnosticSha256,
            },
          },
          onTerminalEvent: options.onEvent,
        })
        .catch(() => undefined);
      if (error instanceof ExecutionPlanWorkflowToolError) throw error;
      throw new ExecutionPlanWorkflowToolError(
        code,
        "Workflow tool execution failed",
        leased.run,
      );
    } finally {
      clearInterval(heartbeat);
      options.signal.removeEventListener("abort", forwardAbort);
    }
  }

  private async blockTool(
    options: ExecuteExecutionPlanWorkflowToolOptions,
    run: RunRecord,
    errorCode: string,
  ): Promise<void> {
    await this.ledger.append(
      {
        threadId: options.threadId,
        runId: run.id,
        type: "tool.blocked",
        category: "tool",
        visibility: "user",
        payload: {
          callId: createId("toolcall"),
          toolName: options.node.tool,
          status: "blocked",
          effect: options.node.effect,
          workflowPlanId: options.planId,
          workflowNodeId: options.node.id,
          workflowAttempt: options.attempt,
          workflowInputSha256: options.inputSha256,
          errorCode,
        },
      },
      options.onEvent,
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function admittedToolErrorCode(error: unknown): string | undefined {
  if (error instanceof ExecutionPlanWorkflowToolError) return error.code;
  return error instanceof ToolExecutionRetryLineageError
    ? "retry_unsafe"
    : undefined;
}
