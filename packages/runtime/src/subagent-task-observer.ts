import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { contentText } from "@earendil-works/pi-ai";
import type {
  RegisteredRunEventTypeForCategory,
  SubagentLimits,
  SubagentTask,
  Usage,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { LocalStore } from "./store.js";
import type { SubagentProgress } from "./subagent-child-execution.js";
import {
  subagentModelDenial,
  SubagentModelTurnDeniedError,
} from "./subagent-model-turn-denial.js";
import {
  addSubagentUsage,
  MAX_SUBAGENT_STEP_CHARS,
  subagentToolResultText,
  truncateSubagentText,
} from "./subagent-task-evidence.js";

type Emit = (
  type: RegisteredRunEventTypeForCategory<"subagent">,
  task: SubagentTask,
  payload: unknown,
) => Promise<void>;

export class SubagentTaskObserver {
  task: SubagentTask;
  finalText = "";
  lastError = "";
  lastFailure: Error | undefined;
  usage: Usage;
  stepIndex = 0;
  turnCapped = false;

  constructor(
    private readonly store: LocalStore,
    task: SubagentTask,
    usage: Usage,
    private readonly limits: SubagentLimits,
    private readonly emit: Emit,
    private readonly recordProgress?: (delta: SubagentProgress) => Promise<SubagentTask>,
  ) {
    this.task = task;
    this.usage = usage;
  }

  assertTurnAvailable(): void {
    if (this.task.turnCount < this.limits.maxTurns && !this.turnCapped) return;
    this.turnCapped = true;
    throw new SubagentModelTurnDeniedError(this.limits.maxTurns);
  }

  async observe(event: AgentEvent): Promise<void> {
    if (event.type === "message_end" && event.message.role === "assistant") {
      await this.observeAssistant(event.message);
    }
    if (event.type === "tool_execution_end") {
      await this.observeTool(event);
    }
  }

  private async observeAssistant(
    message: Extract<AgentEvent, { type: "message_end" }>["message"] & {
      role: "assistant";
    },
  ): Promise<void> {
    const denial = subagentModelDenial(message);
    if (denial) {
      this.lastError = message.errorMessage ?? "Subagent model turn was denied";
      this.lastFailure = denial;
      this.turnCapped = denial instanceof SubagentModelTurnDeniedError;
      return;
    }
    this.task = await this.progress({
      turnDelta: 1,
    });
    if (
      this.task.turnCount >= this.limits.maxTurns &&
      message.stopReason === "toolUse"
    ) {
      this.turnCapped = true;
    }
    const text = contentText(message.content);
    if (text) this.finalText = text;
    if (message.errorMessage) this.lastError = message.errorMessage;
    if (!this.recordProgress) this.usage = addSubagentUsage(this.usage, message.usage);
    this.stepIndex += 1;
    this.task = await this.progress({
      stepDelta: 1,
      ...(!this.recordProgress ? { usage: this.usage } : {}),
    });
    this.usage = this.task.usage;
    const candidateOutput =
      message.stopReason !== "toolUse" || this.task.role === "coder";
    await this.emit("subagent.step", this.task, {
      taskId: this.task.id,
      messageIndex: this.stepIndex,
      kind: "assistant",
      ...(candidateOutput
        ? {
            textSha256: sha256(text),
            textBytes: Buffer.byteLength(text, "utf8"),
            contentRedacted: true,
          }
        : { text: truncateSubagentText(text, MAX_SUBAGENT_STEP_CHARS) }),
      toolCalls: message.content
        .filter((block) => block.type === "toolCall")
        .map((block) => ({
          name: block.name,
          argumentsSha256: sha256(canonicalJson(block.arguments)),
          argumentsBytes: Buffer.byteLength(
            canonicalJson(block.arguments),
            "utf8",
          ),
          argumentsRedacted: true,
        })),
    });
  }

  private async observeTool(
    event: Extract<AgentEvent, { type: "tool_execution_end" }>,
  ): Promise<void> {
    this.stepIndex += 1;
    this.task = await this.progress({
      stepDelta: 1,
    });
    const text = subagentToolResultText(event);
    await this.emit("subagent.step", this.task, {
      taskId: this.task.id,
      messageIndex: this.stepIndex,
      kind: "tool",
      toolName: event.toolName,
      isError: event.isError,
      textSha256: sha256(text),
      textBytes: Buffer.byteLength(text, "utf8"),
      contentRedacted: true,
    });
  }

  private progress(delta: SubagentProgress & { usage?: Usage }): Promise<SubagentTask> {
    return this.recordProgress ? this.recordProgress(delta) : this.store.recordSubagentProgress(this.task.id, delta);
  }
}
