import { createHash } from "node:crypto";

import type {
  AgentMessageExperimentPreview,
  CreateAgentMessageExperimentRequest,
  RunConfigurationFingerprintV7,
  RunConfigurationFingerprintV8,
  RunEvent,
  RunRecord,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  projectFrozenToolResultPlan,
  type FrozenToolResultPlan,
} from "./agent-message-tool-result-replay.js";
import { formatMemoryContext } from "./memory.js";
import {
  agentMessageExperimentHistoryBinding,
  agentMessageExperimentToolEffects,
} from "./agent-message-experiment-model.js";
import {
  projectPromptVariableSnapshots,
  resolvePromptVariables,
} from "./prompt-variables.js";
import { createRunConfigurationFingerprint } from "./run-config.js";
import { formatSkillCatalog, loadWorkspaceSkills } from "./skills.js";
import type { LocalStore } from "./store.js";
import type { ToolInvocationResultCapsuleStore } from "./tool-invocation-result-capsule-store.js";
import { createWorkspacePathSnapshot } from "./workspace-snapshot.js";

export interface AgentMessageExperimentSource {
  preview: AgentMessageExperimentPreview;
  prompt: string;
  sourceRun: RunRecord;
  frozenToolResults: FrozenToolResultPlan;
  title: string;
}

export async function projectAgentMessageExperimentSource(
  store: LocalStore,
  resultCapsules: ToolInvocationResultCapsuleStore,
  sourceThreadId: string,
  request: CreateAgentMessageExperimentRequest,
): Promise<AgentMessageExperimentSource> {
  const sourceThread = store.getThread(sourceThreadId);
  const sourceRun = store
    .listRuns(sourceThreadId)
    .find((run) => run.id === request.sourceRunId);
  if (
    !sourceRun ||
    sourceRun.source !== "user" ||
    sourceRun.status === "running" ||
    sourceRun.status === "queued" ||
    !sourceRun.configuration ||
    sourceRun.configuration.schemaVersion < 7 ||
    !sourceRun.agentRevision ||
    !sourceRun.finishedAt ||
    sourceRun.agentId !== sourceThread.agentId
  ) {
    throw new Error("Agent message experiment source Run is unavailable");
  }
  const sourceConfiguration = sourceRun.configuration as
    | RunConfigurationFingerprintV7
    | RunConfigurationFingerprintV8;
  const sourceEvents = await store.listEvents(sourceThreadId);
  const sourceMessage = sourceEvents.find(
    (event) =>
      event.seq === request.sourceMessageSeq &&
      event.runId === sourceRun.id &&
      event.type === "message.user",
  );
  const prompt = messageText(sourceMessage);
  if (!sourceMessage || !prompt || request.sourceMessageSeq <= 1) {
    throw new Error("Agent message experiment source message is unavailable");
  }
  const sourceRunEvents = sourceEvents.filter(
    (event) => event.runId === sourceRun.id,
  );
  const sourcePromptVariableSnapshots = projectPromptVariableSnapshots(
    sourceRunEvents,
    sourceRun.id,
  );
  if (sourcePromptVariableSnapshots.length !== 1) {
    throw new Error(
      "Agent message experiment Prompt Variable evidence is unavailable",
    );
  }
  const sourcePromptVariableSnapshot = sourcePromptVariableSnapshots[0]!;
  const sourceMemory = sourceMemoryBinding(sourceRunEvents);
  const sourceAgent = store.getAgentRevision(
    sourceRun.agentId,
    sourceRun.agentRevision,
  ).profile;
  const skills = await loadWorkspaceSkills(
    store.workspaceRoot,
    sourceConfiguration.enabledSkills,
  );
  if (
    skills.fingerprint.contentSha256 !== sourceConfiguration.skillCatalogSha256
  ) {
    throw new Error(
      "Agent message experiment Skill catalog changed since the source Run",
    );
  }
  const promptVariables = resolvePromptVariables({
    systemPrompt: sourceAgent.systemPrompt,
    definitions: sourceAgent.promptVariables,
    skillCatalogText: formatSkillCatalog(skills.skills),
    resolvedAt: new Date(sourcePromptVariableSnapshot.resolvedAt),
  });
  if (
    promptVariables.snapshot.catalogSha256 !==
      sourceConfiguration.promptVariableCatalogSha256 ||
    promptVariables.snapshot.contentSha256 !==
      sourceConfiguration.promptVariableSnapshotSha256 ||
    promptVariables.snapshot.renderedSystemPromptSha256 !==
      sourceConfiguration.resolvedSystemPromptSha256
  ) {
    throw new Error(
      "Agent message experiment Prompt Variables changed since the source Run",
    );
  }
  const currentMemory = formatMemoryContext(
    store.listMemories({ agentId: sourceAgent.id }),
    sourceAgent.id,
  );
  const currentMemoryBinding = memoryBinding({
    factIds: currentMemory.factIds,
    truncated: currentMemory.truncated,
    contentSha256: currentMemory.text
      ? createHash("sha256").update(currentMemory.text).digest("hex")
      : "",
  });
  if (currentMemoryBinding !== sourceMemory) {
    throw new Error(
      "Agent message experiment Memory context changed since the source Run",
    );
  }
  const workspace = await createWorkspacePathSnapshot(
    store.workspaceRoot,
    store.workspaceRoot,
  );
  if (workspace.truncated) {
    throw new Error(
      "Agent message experiment Workspace snapshot is incomplete",
    );
  }
  const targetModel = request.model ?? sourceConfiguration.model;
  const candidateConfiguration = createRunConfigurationFingerprint(
    sourceAgent,
    targetModel,
    "agent_experiment_read_only",
    {
      skillCatalogSha256: skills.fingerprint.contentSha256,
      promptVariables: {
        catalogSha256: promptVariables.snapshot.catalogSha256,
        snapshotSha256: promptVariables.snapshot.contentSha256,
        renderedSystemPromptSha256:
          promptVariables.snapshot.renderedSystemPromptSha256,
      },
    },
  );
  const history = agentMessageExperimentHistoryBinding(
    sourceEvents,
    request.sourceMessageSeq,
  );
  const sourceToolEffects = agentMessageExperimentToolEffects(sourceRunEvents);
  const frozenToolResults = await projectFrozenToolResultPlan(
    sourceEvents,
    sourceThreadId,
    sourceRun.id,
    resultCapsules,
  );
  const toolResultMode = request.toolResultMode ?? "live";
  if (
    toolResultMode === "reuse_source" &&
    (sourceToolEffects.toolCallCount < 1 ||
      sourceToolEffects.writeCount > 0 ||
      sourceToolEffects.unknownCount > 0 ||
      sourceToolEffects.unresolvedCount > 0 ||
      frozenToolResults.unavailableCount > 0 ||
      frozenToolResults.entries.length !== sourceToolEffects.toolCallCount)
  ) {
    throw new Error(
      "Agent message experiment source tool results are not completely reusable",
    );
  }
  const content = {
    kind: "napier.agent-message-experiment-preview" as const,
    schemaVersion: 2 as const,
    sourceThreadId,
    sourceRunId: sourceRun.id,
    sourceMessageSeq: request.sourceMessageSeq,
    branchFromSeq: request.sourceMessageSeq - 1,
    sourceAgentId: sourceRun.agentId,
    sourceAgentRevision: sourceRun.agentRevision,
    sourceRunConfigurationSha256: sourceConfiguration.contentSha256,
    sourcePromptVariableResolvedAt: sourcePromptVariableSnapshot.resolvedAt,
    sourcePromptSha256: sha256(prompt),
    sourceHistorySha256: history.sha256,
    sourceHistoryMessageCount: history.messageCount,
    sourceMemoryContextSha256: sourceMemory,
    sourceSkillCatalogSha256: skills.fingerprint.contentSha256,
    candidateWorkspaceSnapshotSha256: workspace.sha256,
    candidateWorkspaceFileCount: workspace.fileCount,
    candidateWorkspaceBytes: workspace.bytes,
    sourceModel: structuredClone(sourceConfiguration.model),
    targetModel: structuredClone(targetModel),
    targetExecutionMode: "agent_experiment_read_only" as const,
    targetToolNames: [...candidateConfiguration.enabledTools],
    sourceToolEffects,
    toolResultMode,
    sourceReusableToolResultCount: frozenToolResults.entries.length,
    sourceToolResultSetSha256: frozenToolResults.sourceResultSetSha256,
  };
  return {
    preview: {
      ...content,
      previewSha256: sha256(canonicalJson(content)),
    },
    prompt,
    sourceRun: structuredClone(sourceRun),
    frozenToolResults,
    title: experimentTitle(
      request.title,
      sourceThread.title,
      request.sourceMessageSeq,
    ),
  };
}

function sourceMemoryBinding(events: RunEvent[]): string {
  const matches = events.filter((event) => event.type === "context.memory");
  if (matches.length === 0) {
    return memoryBinding({
      factIds: [],
      truncated: false,
      contentSha256: "",
    });
  }
  const bindings = new Set(
    matches.map((event) => {
      const payload = record(event.payload);
      if (
        !payload ||
        !Array.isArray(payload["factIds"]) ||
        payload["factIds"].some(
          (value) =>
            typeof value !== "string" ||
            !/^memory_[a-z0-9]{8,80}$/u.test(value),
        ) ||
        payload["count"] !== payload["factIds"].length ||
        typeof payload["truncated"] !== "boolean" ||
        typeof payload["contentSha256"] !== "string" ||
        (payload["contentSha256"] !== "" &&
          !/^[a-f0-9]{64}$/u.test(payload["contentSha256"]))
      ) {
        throw new Error(
          "Agent message experiment source Memory evidence is unavailable",
        );
      }
      return memoryBinding({
        factIds: payload["factIds"] as string[],
        truncated: payload["truncated"],
        contentSha256: payload["contentSha256"],
      });
    }),
  );
  if (bindings.size !== 1) {
    throw new Error(
      "Agent message experiment source Memory changed during the source Run",
    );
  }
  return [...bindings][0]!;
}

function memoryBinding(input: {
  factIds: string[];
  truncated: boolean;
  contentSha256: string;
}): string {
  return sha256(canonicalJson(input));
}

function messageText(event: RunEvent | undefined): string | undefined {
  const payload = record(event?.payload);
  return payload?.["role"] === "user" && typeof payload["text"] === "string"
    ? payload["text"]
    : undefined;
}

function experimentTitle(
  requested: string | undefined,
  sourceTitle: string,
  sourceMessageSeq: number,
): string {
  return (
    requested ??
    `${sourceTitle} / message experiment ${String(sourceMessageSeq)}`
  )
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 100);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
