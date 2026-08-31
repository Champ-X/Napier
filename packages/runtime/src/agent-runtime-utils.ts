import { createHash } from "node:crypto";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  JsonObject,
  JsonValue,
  RegisteredRunEventInputFor,
  RunInvocationSource,
} from "@napier/contracts";
import { isModelContextOverflowMessage } from "./model-context-overflow-recovery.js";
import { isWorkflowRunSource } from "./workflow-node-execution.js";

export {
  assertPromptImageCapability,
  promptUserContent,
} from "./prompt-image-content.js";

export class OperatorDecisionPendingError extends Error {
  constructor(readonly decisionId: string) {
    super(`Run is waiting for operator decision ${decisionId}`);
    this.name = "OperatorDecisionPendingError";
  }
}

export function createRunProgressMessageEvent(input: {
  threadId: string;
  runId: string;
  sourceEventId: string;
  model: string;
  toolNames: readonly string[];
  text: string;
  contentRedacted: boolean;
}): {
  threadId: string;
  runId: string;
} & RegisteredRunEventInputFor<"run.progress.message"> {
  const text = input.text.trim().slice(0, 4_000);
  return {
    threadId: input.threadId,
    runId: input.runId,
    type: "run.progress.message",
    category: "message",
    visibility: "user",
    payload: {
      sourceEventId: input.sourceEventId,
      model: input.model,
      toolNames: [...input.toolNames],
      ...(!input.contentRedacted && text ? { text } : {}),
      ...(input.contentRedacted ? { contentRedacted: true as const } : {}),
    },
  };
}

export function turnPromptEvent(
  source: RunInvocationSource | "goal_continuation" | "advisor_correction",
) {
  if (source === "user" || source === "schedule" || source === "channel") {
    return {
      type: "message.user",
      category: "message",
      visibility: "user",
    } as const;
  }
  if (isWorkflowRunSource(source)) {
    return {
      type: "workflow.node.prompt",
      category: "plan",
      visibility: "hidden",
    } as const;
  }
  if (source === "goal_continuation") {
    return {
      type: "goal.continuation.prompt",
      category: "goal",
      visibility: "hidden",
    } as const;
  }
  return {
    type: "run.recovery.prompt",
    category: "lifecycle",
    visibility: "hidden",
  } as const;
}

export function formatPlanToolGuidance(tools: readonly AgentTool[]): string {
  const toolNames = new Set(tools.map((tool) => tool.name));
  if (toolNames.size === 0) return "";
  const hasCreatePlan = toolNames.has("create_plan");
  const hasStepUpdate = toolNames.has("update_plan_step");
  const hasArtifactUpdate = toolNames.has("update_plan_artifact");
  const hasReplan = toolNames.has("replan_plan");
  const hasMilestone = toolNames.has("record_run_milestone");
  const lines = [
    "<operator_progress_protocol>",
    "For any non-trivial tool-driven Run, keep the operator oriented with concise progress updates in normal assistant text. These updates are public narration, not hidden reasoning.",
    "Before the first meaningful tool phase, briefly state the immediate approach. After a meaningful batch of tool results, and before starting the next tool phase, state what the evidence established, any important gap or changed assumption, and the next action.",
    "Put each update in the same assistant response as the tool call it introduces so it can stream before the tool starts. Use the operator's language, favor concrete facts or counts, and keep the update to one or two short paragraphs.",
    "Do not expose private chain-of-thought, narrate every minor operation, repeat tool labels, claim unverified success, or defer every progress update to the final answer.",
    "A good cadence is one update at phase boundaries such as research to synthesis, implementation to verification, recovery to retry, and verification to delivery.",
    "</operator_progress_protocol>",
  ];
  if (
    !hasCreatePlan &&
    !hasStepUpdate &&
    !hasArtifactUpdate &&
    !hasReplan &&
    !hasMilestone
  ) {
    return lines.join("\n");
  }
  lines.push("<plan_tool_protocol>");
  if (hasCreatePlan || hasStepUpdate || hasArtifactUpdate || hasReplan) {
    lines.push(
      "Use durable plans for multi-step work, artifact delivery, or tasks where the operator needs progress and recovery evidence.",
    );
  }
  if (hasCreatePlan) {
    lines.push(
      "Create one focused plan with concrete verification criteria and declared artifacts before doing substantial delivery work.",
    );
  }
  if (hasStepUpdate) {
    lines.push(
      "Start a step before acting on it, then complete, block, skip, or reopen it with concise evidence from the current run.",
    );
  }
  if (hasArtifactUpdate) {
    lines.push(
      "For planned file or directory artifacts, record produced evidence immediately after the workspace bytes exist so the operator can preview work in progress, then verify so Napier computes the digest; do not provide your own artifact hash.",
      "Do not claim a plan is complete until every required step is settled and every required artifact is verified or explicitly superseded.",
    );
  }
  if (hasReplan) {
    lines.push(
      "When a step is blocked, scope changes, or an artifact is missing, use replan_plan instead of silently editing the old plan shape.",
    );
  }
  if (hasMilestone) {
    lines.push(
      "For long-running work with multiple tool phases, use record_run_milestone at meaningful planning, execution, verification, and delivery boundaries so the operator receives concise progress conclusions during the Run.",
      "Ground each milestone in completed tool evidence, summarize what the evidence established in operator-facing language, and list every remaining check or blocker in openLoops. Do not record milestones after minor actions, invent progress, or repeat the final answer.",
    );
  }
  lines.push("</plan_tool_protocol>");
  return lines.join("\n");
}

export function toJsonValue(value: object): JsonObject;
export function toJsonValue(value: unknown): JsonValue;
export function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function controlMessageEventKey(
  timestamp: number,
  text: string,
): string {
  return `${timestamp}:${sha256Text(text)}`;
}

export function summarize(text: string, limit: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, limit - 1)}…`;
}

export function splitForStreaming(text: string, parts: number): string[] {
  const size = Math.max(1, Math.ceil(text.length / parts));
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

export function publicModelFailureMessage(
  stopReason: "error" | "aborted",
  diagnostic: string | undefined,
): string {
  if (stopReason === "aborted") {
    return "Model call was aborted. Retry when the task is ready to continue.";
  }
  const normalized = diagnostic?.toLowerCase() ?? "";
  if (
    /\b401\b|unauthori[sz]ed|authentication|invalid api[- ]?key|credential/u.test(
      normalized,
    )
  ) {
    return "Model provider authentication failed. Restore the selected credential reference, verify it with Doctor, then retry.";
  }
  if (
    /\b429\b|rate.?limit|quota|insufficient (?:credits?|balance)|credit balance/u.test(
      normalized,
    )
  ) {
    return "Model provider capacity or quota was exhausted. Wait for the provider limit to reset or select another configured model, then retry.";
  }
  if (
    /\b404\b|model.{0,32}(?:not found|unavailable|does not exist)|no endpoints? found|invalid model/u.test(
      normalized,
    )
  ) {
    return "The selected model is unavailable at the provider. Choose a current catalog model or verify the provider with Doctor, then retry.";
  }
  if (isModelContextOverflowMessage(normalized)) {
    return "The model context exceeded the provider limit. Start a smaller follow-up or reduce attached context, then retry.";
  }
  if (
    /\b(?:408|500|502|503|504)\b|timed? out|timeout|network|connection|overload|service unavailable|temporar|internal server error/u.test(
      normalized,
    )
  ) {
    return "The model provider or network failed temporarily. Retry the same Run; select another configured model if the failure persists.";
  }
  return "The model provider call failed. Verify the selected provider and model with Doctor, then retry or choose another configured model.";
}

export async function delay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw new DOMException("Run aborted", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Run aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
