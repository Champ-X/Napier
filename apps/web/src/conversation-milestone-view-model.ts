import type { AgentMilestonePhase, RunEvent } from "@napier/contracts";

export interface ConversationMilestone {
  id: string;
  runId: string;
  seq: number;
  createdAt: string;
  phase: AgentMilestonePhase;
  title: string;
  summary: string;
  completedItems: string[];
  openLoops: string[];
}

const PHASES = new Set<AgentMilestonePhase>([
  "planning",
  "execution",
  "verification",
  "delivery",
]);

export function conversationMilestones(
  events: readonly RunEvent[],
): ConversationMilestone[] {
  return events
    .flatMap((event) => {
      const milestone = conversationMilestone(event);
      return milestone ? [milestone] : [];
    })
    .sort((left, right) => left.seq - right.seq);
}

export function conversationMilestone(
  event: RunEvent,
): ConversationMilestone | undefined {
  if (
    event.type !== "agent.milestone.recorded" ||
    event.visibility !== "user" ||
    !record(event.payload) ||
    event.payload["kind"] !== "napier.agent-milestone-recorded" ||
    event.payload["schemaVersion"] !== 1
  ) {
    return undefined;
  }
  const milestoneId = boundedText(event.payload["milestoneId"], 100);
  const phase = event.payload["phase"];
  const title = boundedText(event.payload["title"], 80);
  const summary = boundedText(event.payload["summary"], 4_000);
  const completedItems = boundedTextArray(event.payload["completedItems"]);
  const openLoops = boundedTextArray(event.payload["openLoops"]);
  if (
    !milestoneId ||
    !phase ||
    !PHASES.has(phase as AgentMilestonePhase) ||
    !title ||
    !summary ||
    !completedItems ||
    !openLoops
  ) {
    return undefined;
  }
  return {
    id: milestoneId,
    runId: event.runId,
    seq: event.seq,
    createdAt: event.createdAt,
    phase: phase as AgentMilestonePhase,
    title,
    summary,
    completedItems,
    openLoops,
  };
}

function boundedText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 && text.length <= maximum ? text : undefined;
}

function boundedTextArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > 12) return undefined;
  const items = value.map((item) => boundedText(item, 500));
  return items.every((item): item is string => item !== undefined)
    ? items
    : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
