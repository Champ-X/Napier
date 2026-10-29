import {
  contentText, type Api, type AssistantMessage, type Model, type MutableModels, type Usage as PiUsage,
} from "@earendil-works/pi-ai";
import type { RegisteredRunEventTypeForCategory, SubagentLimits, SubagentTask, Usage } from "@napier/contracts";
import { sha256 } from "./ed25519.js";
import type { ModelRouteStreamPort } from "./model-route-types.js";
import { createSubagentModelSession, type SubagentModelSession } from "./subagent-model-session.js";
import type { LocalStore } from "./store.js";

export interface SubagentRepairPorts {
  store: LocalStore;
  models: MutableModels;
  model: Model<Api>;
  runId: string;
  limits: SubagentLimits;
  task: SubagentTask;
  usage: Usage;
  modelSession?: SubagentModelSession;
  modelRoute?: ModelRouteStreamPort;
  signal?: AbortSignal;
  activateAgent(abort: () => void): void;
  emit(type: RegisteredRunEventTypeForCategory<"subagent">, task: SubagentTask, payload: unknown): Promise<void>;
}

export function prepareSubagentRepair(input: SubagentRepairPorts) {
  const controller = new AbortController();
  input.activateAgent(() => controller.abort(new Error("Subagent repair cancelled")));
  const signal = input.signal ? AbortSignal.any([controller.signal, input.signal]) : controller.signal;
  const modelSession = input.modelSession ?? createSubagentModelSession({
    store: input.store, models: input.models, task: input.task, limits: input.limits, signal,
    ...(input.modelRoute ? { modelRoute: input.modelRoute } : {}),
  });
  return {
    modelSession, signal,
    assertActive() { modelSession.lifetime.assertActive(); signal.throwIfAborted(); },
  };
}

/** One response, no Agent/tool loop. Accounting observes the response even when
 * validation rejects its tool calls or cancellation arrives during persistence. */
export async function runSingleResponseRepair(input: SubagentRepairPorts & {
  session: ReturnType<typeof prepareSubagentRepair>;
  phase: "typed_repair" | "outcome_repair";
  instructions: string;
  prompt: string;
}): Promise<{ task: SubagentTask; usage: Usage; resultText: string; error?: string }> {
  let task = input.task;
  let usage = input.usage;
  let resultText = "";
  let message: AssistantMessage | undefined;
  let failure = "";
  try {
    input.session.assertActive();
    if (task.turnCount >= input.limits.maxTurns) throw new Error(`Subagent turn budget exhausted (${input.limits.maxTurns})`);
    const source = await input.session.modelSession.open(input.phase, input.model, {
      systemPrompt: input.instructions,
      tools: [],
      messages: [{ role: "user", content: input.prompt, timestamp: Date.now() }],
    }, {
      signal: input.session.signal,
      sessionId: `${input.runId}:${task.id}:${task.executionId ?? "local"}:${input.phase}:1`,
      // Agent's thinkingLevel="off" maps to an omitted SDK reasoning option.
      maxRetries: 0,
    });
    for await (const event of source) {
      if (event.type === "done" || event.type === "error") {
        message = event.type === "done" ? event.message : event.error;
        break;
      }
    }
    message ??= await source.result();
  } catch (error) { failure = errorMessage(error); }
  if (message) {
    resultText = contentText(message.content);
    usage = addUsage(usage, message.usage);
    task = await input.store.recordSubagentProgress(task.id, { turnDelta: 1, stepDelta: 1, usage });
    const toolCallCount = message.content.filter((block) => block.type === "toolCall").length;
    await input.emit("subagent.step", task, {
      taskId: task.id, messageIndex: task.stepCount,
      kind: input.phase === "typed_repair" ? "typed_output_repair" : "outcome_repair", attempt: 1,
      textSha256: sha256(resultText), textBytes: Buffer.byteLength(resultText, "utf8"), contentRedacted: true, toolCallCount,
    });
    failure ||= toolCallCount > 0 ? "Subagent repair returned a tool call"
      : message.errorMessage || (["error", "aborted"].includes(message.stopReason) ? "Subagent repair model response failed" : "");
  }
  input.session.assertActive();
  return { task, usage, resultText, ...(failure ? { error: failure } : {}) };
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
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
