import { Agent } from "@earendil-works/pi-agent-core";
import {
  type Api,
  contentText,
  type Model,
  type MutableModels,
  type Usage as PiUsage,
} from "@earendil-works/pi-ai";
import type {
  JsonValue,
  RegisteredRunEventTypeForCategory,
  SubagentLimits,
  SubagentTask,
  Usage,
  WorkflowValueSchema,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { LocalStore } from "./store.js";
import {
  createSubagentTypedOutputRepairPrompt,
  parseSubagentTypedOutput,
  subagentOutputSchemaSha256,
} from "./subagent-output-schema.js";

export interface SubagentTypedOutputResult {
  task: SubagentTask;
  usage: Usage;
  resultText: string;
  output: JsonValue;
}

export async function settleSubagentTypedOutput(input: {
  store: LocalStore;
  models: MutableModels;
  model: Model<Api>;
  runId: string;
  limits: SubagentLimits;
  task: SubagentTask;
  resultText: string;
  outputSchema: WorkflowValueSchema;
  usage: Usage;
  activateAgent(abort: () => void): void;
  emit(
    type: RegisteredRunEventTypeForCategory<"subagent">,
    task: SubagentTask,
    payload: unknown,
  ): Promise<void>;
}): Promise<SubagentTypedOutputResult> {
  try {
    return {
      task: input.task,
      usage: input.usage,
      resultText: input.resultText,
      output: parseSubagentTypedOutput(input.resultText, input.outputSchema),
    };
  } catch (initialError) {
    if (input.task.turnCount >= input.limits.maxTurns) throw initialError;
    return repairTypedOutput(input, initialError);
  }
}

async function repairTypedOutput(
  input: Parameters<typeof settleSubagentTypedOutput>[0],
  initialError: unknown,
): Promise<SubagentTypedOutputResult> {
  const diagnostic =
    initialError instanceof Error ? initialError.message : String(initialError);
  const schemaSha256 = subagentOutputSchemaSha256(input.outputSchema);
  const prompt = createSubagentTypedOutputRepairPrompt({
    prompt: input.task.prompt,
    resultText: input.resultText,
    diagnostic,
    schema: input.outputSchema,
  });
  const requestContent = {
    kind: "napier.subagent-typed-output-repair-request" as const,
    schemaVersion: 1 as const,
    taskId: input.task.id,
    attempt: 1,
    maxAttempts: 1,
    outputSchemaSha256: schemaSha256,
    predecessorResultSha256: sha256(input.resultText),
    diagnosticSha256: sha256(diagnostic),
    repairPromptSha256: sha256(prompt),
  };
  const request = {
    ...requestContent,
    contentSha256: sha256(canonicalJson(requestContent)),
  };
  await input.emit("subagent.output.repair.requested", input.task, request);
  let task = input.task;
  let usage = input.usage;
  let resultText = "";
  let messageError = "";
  const agent = new Agent({
    initialState: {
      systemPrompt: "You repair typed JSON output. Never use tools.",
      model: input.model,
      thinkingLevel: "off",
      tools: [],
      messages: [],
    },
    streamFn: input.models.streamSimple.bind(input.models),
    sessionId: `${input.runId}:${input.task.id}:typed-output-repair:1`,
    afterToolCall: async () => ({ terminate: true }),
  });
  agent.subscribe(async (event) => {
    if (event.type !== "message_end" || event.message.role !== "assistant") {
      return;
    }
    resultText = contentText(event.message.content);
    messageError = event.message.errorMessage ?? "";
    usage = addUsage(usage, event.message.usage);
    task = await input.store.recordSubagentProgress(task.id, {
      turnDelta: 1,
      stepDelta: 1,
      usage,
    });
    await input.emit("subagent.step", task, {
      taskId: task.id,
      messageIndex: task.stepCount,
      kind: "typed_output_repair",
      attempt: 1,
      textSha256: sha256(resultText),
      textBytes: Buffer.byteLength(resultText, "utf8"),
      contentRedacted: true,
    });
  });
  input.activateAgent(() => agent.abort());
  await agent.prompt(prompt);
  if (messageError) throw new Error(messageError);
  let output: JsonValue;
  try {
    output = parseSubagentTypedOutput(resultText, input.outputSchema);
  } catch (error) {
    await input.emit("subagent.output.repair.outcome", task, {
      taskId: task.id,
      status: "rejected",
      attempt: 1,
      maxAttempts: 1,
      requestContentSha256: request.contentSha256,
      outputSchemaSha256: schemaSha256,
      resultSha256: sha256(resultText),
      diagnosticSha256: sha256(
        error instanceof Error ? error.message : String(error),
      ),
    });
    throw error;
  }
  await input.emit("subagent.output.repair.outcome", task, {
    taskId: task.id,
    status: "accepted",
    attempt: 1,
    maxAttempts: 1,
    requestContentSha256: request.contentSha256,
    outputSchemaSha256: schemaSha256,
    resultSha256: sha256(resultText),
    outputSha256: sha256(canonicalJson(output)),
  });
  return { task, usage, resultText, output };
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
