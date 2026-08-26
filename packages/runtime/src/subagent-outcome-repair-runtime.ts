import { Agent } from "@earendil-works/pi-agent-core";
import {
  type Api,
  contentText,
  type Model,
  type MutableModels,
  type Usage as PiUsage,
} from "@earendil-works/pi-ai";
import type {
  RegisteredRunEventTypeForCategory,
  SubagentLimits,
  SubagentTask,
  Usage,
} from "@napier/contracts";

import { sha256 } from "./ed25519.js";
import type { LocalStore } from "./store.js";
import {
  createSubagentOutcomeRepairRequest,
  MAX_SUBAGENT_OUTCOME_REPAIR_ATTEMPTS,
  type SubagentOutcomeRepairRequest,
} from "./subagent-outcome-repair.js";

export interface SubagentOutcomeRepairRuntimeResult {
  task: SubagentTask;
  usage: Usage;
  request: SubagentOutcomeRepairRequest;
  resultText: string;
  error?: string;
}

export async function runSubagentOutcomeRepair(input: {
  store: LocalStore;
  models: MutableModels;
  model: Model<Api>;
  runId: string;
  limits: SubagentLimits;
  task: SubagentTask;
  predecessorResult: string;
  diagnostic: string;
  usage: Usage;
  activateAgent(abort: () => void): void;
  emit(
    type: RegisteredRunEventTypeForCategory<"subagent">,
    task: SubagentTask,
    payload: unknown,
  ): Promise<void>;
}): Promise<SubagentOutcomeRepairRuntimeResult> {
  const request = createSubagentOutcomeRepairRequest({
    taskId: input.task.id,
    role: input.task.role,
    model: input.task.model,
    taskPrompt: input.task.prompt,
    predecessorResult: input.predecessorResult,
    diagnostic: input.diagnostic,
    attempt: 1,
    maxAttempts: MAX_SUBAGENT_OUTCOME_REPAIR_ATTEMPTS,
  });
  await input.emit(
    "subagent.outcome.repair.requested",
    input.task,
    request.payload,
  );
  let currentTask = input.task;
  let currentUsage = input.usage;
  let resultText = "";
  let messageError = "";
  let toolCallCount = 0;
  const repairAgent = new Agent({
    initialState: {
      systemPrompt: request.instructions,
      model: input.model,
      thinkingLevel: "off",
      tools: [],
      messages: [],
    },
    streamFn: input.models.streamSimple.bind(input.models),
    sessionId: `${input.runId}:${input.task.id}:outcome-repair:1`,
    toolExecution: "parallel",
    afterToolCall: async () => ({ terminate: true }),
  });
  repairAgent.subscribe(async (event) => {
    if (event.type !== "message_end" || event.message.role !== "assistant") {
      return;
    }
    resultText = contentText(event.message.content);
    messageError = event.message.errorMessage ?? "";
    toolCallCount = event.message.content.filter(
      (block) => block.type === "toolCall",
    ).length;
    currentUsage = addUsage(currentUsage, event.message.usage);
    currentTask = await input.store.recordSubagentProgress(input.task.id, {
      turnDelta: 1,
      stepDelta: 1,
      usage: currentUsage,
    });
    await input.emit("subagent.step", currentTask, {
      taskId: input.task.id,
      messageIndex: currentTask.stepCount,
      kind: "outcome_repair",
      attempt: request.payload.attempt,
      textSha256: sha256(resultText),
      textBytes: Buffer.byteLength(resultText, "utf8"),
      contentRedacted: true,
      toolCallCount,
    });
  });
  input.activateAgent(() => repairAgent.abort());

  let invocationError = "";
  try {
    await repairAgent.prompt(request.prompt);
  } catch (error) {
    invocationError = error instanceof Error ? error.message : String(error);
  }
  const error =
    invocationError ||
    messageError ||
    (toolCallCount > 0
      ? "Subagent outcome repair returned a tool call"
      : currentTask.turnCount > input.limits.maxTurns
        ? `Subagent turn budget exhausted (${input.limits.maxTurns})`
        : "");
  return {
    task: currentTask,
    usage: currentUsage,
    request,
    resultText,
    ...(error ? { error } : {}),
  };
}

function addUsage(current: Usage, update: PiUsage): Usage {
  return {
    inputTokens: current.inputTokens + update.input,
    outputTokens: current.outputTokens + update.output,
    cacheReadTokens: current.cacheReadTokens + update.cacheRead,
    cacheWriteTokens: current.cacheWriteTokens + update.cacheWrite,
    costUsd: current.costUsd + update.cost.total,
  };
}
