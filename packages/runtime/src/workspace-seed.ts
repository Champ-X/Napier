import {
  emptyUsage,
  type AgentProfile,
  type RunEvent,
  type RunRecord,
  type ThreadRecord,
} from "@napier/contracts";

import {
  DEFAULT_MODEL_ADVISOR_POLICY,
  DEFAULT_RUN_LIMITS,
  DEFAULT_SUBAGENT_LIMITS,
  normalizeRunLimits,
} from "./agents.js";
import { recommendedCapabilityUpdate } from "./default-agent-capability-contract.js";
import { createId, nowIso } from "./ids.js";
import { createRunConfigurationFingerprint } from "./run-config.js";
import { appendWorkspaceSeedEventsToThread } from "./run-event-writer.js";

export interface WorkspaceSeed {
  agent: AgentProfile;
  events: RunEvent[];
  thread: ThreadRecord;
  run: RunRecord;
}

export function createWorkspaceSeed(): WorkspaceSeed {
  const timestamp = nowIso();
  const threadId = createId("thread");
  const runId = createId("run");
  const assistantText =
    "This thread is a durable ledger. Every answer, tool call, branch, goal, and artifact is recorded as evidence you can inspect and replay.";
  const agent: AgentProfile = {
    id: "agent_napier",
    name: "Napier",
    description:
      "A glass-box generalist for research, building, and long-running goals.",
    systemPrompt:
      "You are Napier, a rigorous general-purpose agent. Work in observable steps, preserve evidence, and prefer reversible actions.",
    model: { provider: "napier", id: "demo" },
    thinkingLevel: "medium",
    ...recommendedCapabilityUpdate(),
    subagentLimits: structuredClone(DEFAULT_SUBAGENT_LIMITS),
    runLimits: structuredClone(DEFAULT_RUN_LIMITS),
    modelAdvisor: structuredClone(DEFAULT_MODEL_ADVISOR_POLICY),
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const thread: ThreadRecord = {
    id: threadId,
    title: "The first ledger",
    agentId: agent.id,
    status: "idle",
    createdAt: timestamp,
    updatedAt: timestamp,
    lastMessage: "",
    eventCount: 0,
    runIds: [runId],
  };
  const events: RunEvent[] = [
    ...appendWorkspaceSeedEventsToThread(
      thread,
      [
        {
          threadId,
          runId,
          type: "run.started",
          category: "lifecycle",
          visibility: "debug",
          payload: { source: "onboarding" },
        },
      ],
      { createdAt: timestamp },
    ),
    ...appendWorkspaceSeedEventsToThread(thread, [
      {
        threadId,
        runId,
        type: "message.assistant",
        category: "message",
        visibility: "user",
        payload: {
          role: "assistant",
          text: assistantText,
          model: "napier/demo",
        },
      },
      {
        threadId,
        runId,
        type: "system.note",
        category: "system",
        visibility: "debug",
        payload: {
          text: "Demo mode is active. Configure a provider key to switch this agent to a live model.",
        },
      },
    ]),
  ];
  const finishedAt = events.at(-1)!.createdAt;
  const run: RunRecord = {
    id: runId,
    threadId,
    agentId: agent.id,
    status: "completed",
    startedAt: timestamp,
    finishedAt,
    usage: emptyUsage(),
    agentRevision: agent.revision,
    limits: normalizeRunLimits(
      agent.runLimits ?? structuredClone(DEFAULT_RUN_LIMITS),
    ),
    configuration: createRunConfigurationFingerprint(agent),
  };
  return { agent, events, thread, run };
}
