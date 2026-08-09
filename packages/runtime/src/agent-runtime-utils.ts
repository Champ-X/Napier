import { createHash } from "node:crypto";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@napier/contracts";

export class OperatorDecisionPendingError extends Error {
  constructor(readonly decisionId: string) {
    super(`Run is waiting for operator decision ${decisionId}`);
    this.name = "OperatorDecisionPendingError";
  }
}

export function formatPlanToolGuidance(tools: readonly AgentTool[]): string {
  const toolNames = new Set(tools.map((tool) => tool.name));
  const hasCreatePlan = toolNames.has("create_plan");
  const hasStepUpdate = toolNames.has("update_plan_step");
  const hasArtifactUpdate = toolNames.has("update_plan_artifact");
  const hasReplan = toolNames.has("replan_plan");
  if (!hasCreatePlan && !hasStepUpdate && !hasArtifactUpdate && !hasReplan) {
    return "";
  }
  const lines = [
    "<plan_tool_protocol>",
    "Use durable plans for multi-step work, artifact delivery, or tasks where the operator needs progress and recovery evidence.",
  ];
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
      "For planned file or directory artifacts, record produced evidence after the workspace bytes exist, then verify so Napier computes the digest; do not provide your own artifact hash.",
      "Do not claim a plan is complete until every required step is settled and every required artifact is verified or explicitly superseded.",
    );
  }
  if (hasReplan) {
    lines.push(
      "When a step is blocked, scope changes, or an artifact is missing, use replan_plan instead of silently editing the old plan shape.",
    );
  }
  lines.push("</plan_tool_protocol>");
  return lines.join("\n");
}

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

export function controlMessageEventKey(timestamp: number, text: string): string {
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
