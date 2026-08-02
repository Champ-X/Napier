import type {
  ExecutionPlanWorkflowToolNode,
  JsonValue,
  RunRecord,
} from "@napier/contracts";
import { Check } from "typebox/value";

import type { AgentRuntime } from "./agent-runtime.js";
import type { EventSink } from "./event-sink.js";
import {
  agentToolInputLedgerProjection,
  agentToolOutputLedgerProjection,
} from "./agent-tool-ledger.js";
import { builtInToolEffect } from "./agent-tool-effects.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import { gitStageMutationManagerFor } from "./git-stage.js";
import { assessToolCall } from "./policy.js";
import { createStatelessAgentTools } from "./stateless-agent-tools.js";
import type { LocalStore } from "./store.js";
import { assertWorkflowValue } from "./workflow-schemas.js";
import { ExecutionPlanWorkflowLedger } from "./workflow-ledger.js";
import { WORKFLOW_NODE_EXECUTION } from "./workflow-node-execution.js";

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
  private readonly workerId = createId("workflowtool");

  constructor(
    private readonly store: LocalStore,
    private readonly agentRuntime: AgentRuntime,
    private readonly ledger: ExecutionPlanWorkflowLedger,
  ) {}

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

      const tool = createStatelessAgentTools({
        store: this.store,
        profile,
        threadId: options.threadId,
        runId: leased.run.id,
        sandbox: this.agentRuntime.verificationSandbox,
        ...(this.agentRuntime.workspaceFileMutations
          ? {
              workspaceFileMutations: this.agentRuntime.workspaceFileMutations,
            }
          : {}),
        gitStageMutations: gitStageMutationManagerFor(
          this.store,
          this.agentRuntime.verificationSandbox,
        ),
        gitStageScopeId: options.planId,
      }).find((candidate) => candidate.name === options.node.tool);
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
      const effect = builtInToolEffect(options.node.tool, jsonArgs);
      if (!effect || effect !== options.node.effect) {
        await this.blockTool(options, leased.run, "effect_mismatch");
        throw new ExecutionPlanWorkflowToolError(
          "effect_mismatch",
          "Workflow tool effect does not match the Manifest",
          leased.run,
        );
      }
      const decision = assessToolCall(
        profile.toolPolicy,
        options.node.tool,
        jsonArgs,
        this.store.workspaceRoot,
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
      toolCallId = createId("toolcall");
      const inputProjection = workflowToolInputLedgerProjection(
        options.node.tool,
        jsonArgs,
      );
      await this.ledger.append(
        {
          threadId: options.threadId,
          runId: leased.run.id,
          type: "tool.started",
          category: "tool",
          visibility: "user",
          payload: {
            ...inputProjection,
            callId: toolCallId,
            toolName: options.node.tool,
            status: "started",
            effect,
            workflowPlanId: options.planId,
            workflowNodeId: options.node.id,
            workflowAttempt: options.attempt,
          },
        },
        options.onEvent,
      );
      toolStarted = true;
      const result = await tool.execute(
        toolCallId,
        args as never,
        executionController.signal,
      );
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
      const outputSha256 = sha256(canonicalJson(output));
      const outputText = resultText(result);
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
      await this.ledger.append(
        {
          threadId: options.threadId,
          runId: leased.run.id,
          type: "run.completed",
          category: "lifecycle",
          visibility: "debug",
          payload: { status: "completed" },
        },
        options.onEvent,
      );
      const run = await this.store.finishRun(leased.run.id, "completed", {
        leaseToken: leased.token,
      });
      settled = true;
      return { run, output };
    } catch (error) {
      if (settled) throw error;
      const timedOut = options.wasTimedOut?.() === true;
      const cancelled = options.signal.aborted && !timedOut;
      const code =
        error instanceof ExecutionPlanWorkflowToolError
          ? error.code
          : leaseLost
            ? "lease_lost"
            : timedOut
              ? "timeout"
              : cancelled
                ? "cancelled"
                : "tool_failed";
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
      await this.ledger
        .append(
          {
            threadId: options.threadId,
            runId: leased.run.id,
            type: cancelled ? "run.cancelled" : "run.failed",
            category: "lifecycle",
            visibility: "user",
            payload: {
              status: cancelled ? "cancelled" : "failed",
              errorCode: code,
              diagnosticSha256,
            },
          },
          options.onEvent,
        )
        .catch(() => undefined);
      await this.store
        .finishRun(leased.run.id, cancelled ? "cancelled" : "failed", {
          error: `Workflow tool ${code}`,
          leaseToken: leased.token,
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

function resultText(result: unknown): string {
  if (
    !result ||
    typeof result !== "object" ||
    !("content" in result) ||
    !Array.isArray(result.content)
  ) {
    return String(result ?? "");
  }
  return result.content
    .filter((item): item is { type: "text"; text: string } =>
      Boolean(
        item &&
        typeof item === "object" &&
        item.type === "text" &&
        typeof item.text === "string",
      ),
    )
    .map((item) => item.text)
    .join("\n");
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function workflowToolOutputLedgerProjection(
  toolName: string,
  output: string,
  result: unknown,
): Record<string, JsonValue> {
  const projection = agentToolOutputLedgerProjection(toolName, output, result);
  if (
    projection["outputRedacted"] === true &&
    typeof projection["outputSha256"] === "string" &&
    typeof projection["outputBytes"] === "number"
  ) {
    return {
      ...projection,
      toolOutputRedacted: true,
      toolOutputBytes: projection["outputBytes"],
      toolOutputSha256: projection["outputSha256"],
    };
  }
  if (typeof projection["output"] !== "string") return projection;
  const { output: _output, ...rest } = projection;
  return {
    ...rest,
    toolOutputRedacted: true,
    toolOutputBytes: Buffer.byteLength(output, "utf8"),
    toolOutputSha256: sha256(output),
  };
}

function workflowToolInputLedgerProjection(
  toolName: string,
  input: JsonValue,
): Record<string, JsonValue> {
  const projection = agentToolInputLedgerProjection(toolName, input);
  if (!Object.hasOwn(projection, "input")) return projection;
  const { input: _input, ...rest } = projection;
  const encoded = canonicalJson(input);
  return {
    ...rest,
    inputRedacted: true,
    inputBytes: Buffer.byteLength(encoded, "utf8"),
    inputSha256: sha256(canonicalJson({ toolName, input })),
  };
}
