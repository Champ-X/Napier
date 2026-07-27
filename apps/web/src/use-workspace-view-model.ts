import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  AgentProfile,
  BootstrapResponse,
  ContextCheckpointSnapshot,
  CreateMcpExtensionRequest,
  SignedExtensionPackageChannelIndexEnvelope,
  ExtensionPackageDeploymentPreview,
  ExtensionPackageLockfile,
  ExtensionPackageRolloutPreview,
  ExtensionPackageUpdatePreview,
  ExtensionRecord,
  GoalState,
  MemoryCategory,
  MemoryFact,
  MemoryScope,
  McpToolEffect,
  OpenTelemetryTraceArtifact,
  OpenTelemetryTraceArtifactVerification,
  ReviewExtensionRequest,
  ReviewMemoryRequest,
  RunComparison,
  RunEvent,
  RunReplaySnapshot,
  RunReplaySnapshotVerification,
  StreamFrame,
  TextMessagePayload,
  ThreadDetail,
  ThreadReplayBundle,
  ThreadReplayBundleVerification,
  ThreadSummary,
} from "@napier/contracts";

import {
  applyExtensionPackageDeployment as applyExtensionPackageDeploymentApi,
  applyExtensionPackageRolloutChannel as applyExtensionPackageRolloutChannelApi,
  applyExtensionPackageUpdate as applyExtensionPackageUpdateApi,
  clearGoal,
  compareThreadRuns,
  connectExtension,
  createBranch,
  createExtensionPublisherTrustAnchor as createExtensionPublisherTrustAnchorApi,
  createMcpExtension,
  createRunEvaluation,
  createThread,
  disconnectExtension,
  exportExtensionPackageLockfile as exportExtensionPackageLockfileApi,
  exportOpenTelemetryTrace as exportOpenTelemetryTraceApi,
  getBootstrap,
  getRunReplay,
  getThreadReplayBundle,
  getThread,
  importThreadReplayBundle,
  importSignedExtensionPackage as importSignedExtensionPackageApi,
  proposeMemory,
  previewExtensionPackageDeployment as previewExtensionPackageDeploymentApi,
  previewExtensionPackageRolloutChannel as previewExtensionPackageRolloutChannelApi,
  previewExtensionPackageUpdate as previewExtensionPackageUpdateApi,
  publishExtensionPackageRolloutChannel as publishExtensionPackageRolloutChannelApi,
  reviewMemory,
  reviewExtension,
  reviewMcpTool,
  revokeExtensionPublisherTrustAnchor as revokeExtensionPublisherTrustAnchorApi,
  resumeInterruptedRun as resumeRunApi,
  setExtensionEnabled,
  setGoal,
  signExtensionPackageChannelIndex as signExtensionPackageChannelIndexApi,
  signExtensionPackage as signExtensionPackageApi,
  stopRun,
  streamPrompt,
  verifyExtensionPackageChannelIndex as verifyExtensionPackageChannelIndexApi,
  verifyExtensionPackageLockfile as verifyExtensionPackageLockfileApi,
  verifyOpenTelemetryTraceArtifact as verifyOpenTelemetryTraceArtifactApi,
  verifyRunReplaySnapshot as verifyRunReplaySnapshotApi,
  verifySignedExtensionPackage as verifySignedExtensionPackageApi,
  verifyThreadReplayBundle as verifyThreadReplayBundleApi,
} from "./api";
import { copy } from "./copy";
import { extensionCopy } from "./extension-copy";
import type {
  ExtensionPackageDeploymentConfirmation,
  ExtensionPackageReceipt,
  ExtensionPackageSignDraft,
  ExtensionPackageUpdateConfirmation,
  ExtensionPublisherDraft,
} from "./extension-package-types";
import { formatApiErrorMessage } from "./api-error";

export type InspectorTab =
  | "trace"
  | "lab"
  | "plan"
  | "goal"
  | "memory"
  | "extensions"
  | "automations"
  | "context";

export interface MessageView {
  id: string;
  seq: number;
  role: "user" | "assistant" | "system";
  text: string;
  reasoning: string;
  model: string;
  createdAt: string;
}

export type FixtureTransferReceipt =
  | {
      action: "exported" | "imported";
      contentSha256: string;
      eventCount: number;
    }
  | {
      action: "verified";
      status: ThreadReplayBundleVerification["status"];
      diagnostics: string[];
      contentSha256?: string;
      eventStreamSha256?: string;
      eventCount: number;
      runCount: number;
      planCount: number;
      evaluationCount: number;
    };

export interface RunReplayVerificationReceipt {
  status: RunReplaySnapshotVerification["status"];
  diagnostics: string[];
  runId?: string;
  contentSha256?: string;
  eventStreamSha256?: string;
  assistantTextSha256?: string;
  eventCount: number;
  subagentCount: number;
}

export interface OpenTelemetryTraceReceipt {
  scope: "thread" | "run";
  traceId: string;
  contentSha256: string;
  eventCount: number;
  spanCount: number;
}

export interface OpenTelemetryTraceVerificationReceipt {
  status: OpenTelemetryTraceArtifactVerification["status"];
  diagnostics: string[];
  traceId?: string;
  contentSha256?: string;
  eventStreamSha256?: string;
  eventCount: number;
  spanCount: number;
}

const MAX_THREAD_REPLAY_FILE_BYTES = 10 * 1024 * 1024;
const MAX_RUN_REPLAY_SNAPSHOT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_OTLP_TRACE_ARTIFACT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_SIGNED_EXTENSION_PACKAGE_FILE_BYTES = 4 * 1024 * 1024;
const MAX_EXTENSION_PACKAGE_DEPLOYMENT_FILES = 8;
const MAX_EXTENSION_PACKAGE_DEPLOYMENT_FILE_BYTES = 16 * 1024 * 1024;
const MAX_EXTENSION_PACKAGE_LOCKFILE_FILE_BYTES =
  MAX_EXTENSION_PACKAGE_DEPLOYMENT_FILE_BYTES + 256 * 1024;
const MAX_EXTENSION_PACKAGE_CHANNEL_INDEX_FILE_BYTES = 1 * 1024 * 1024;

export function useWorkspaceViewModel() {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse>();
  const [detail, setDetail] = useState<ThreadDetail>();
  const [selectedThreadId, setSelectedThreadId] = useState<string>();
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("trace");
  const [selectedModelKey, setSelectedModelKey] = useState("napier/demo");
  const [composer, setComposer] = useState("");
  const [goalDraft, setGoalDraft] = useState("");
  const [memoryDraft, setMemoryDraft] = useState("");
  const [memoryCategory, setMemoryCategory] =
    useState<MemoryCategory>("context");
  const [memoryScope, setMemoryScope] = useState<MemoryScope>("workspace");
  const [memoryReviewIntervalDays, setMemoryReviewIntervalDays] = useState(90);
  const [memorySupersedesId, setMemorySupersedesId] = useState<string>();
  const [memoryConsolidatesIds, setMemoryConsolidatesIds] = useState<string[]>(
    [],
  );
  const [extensionBusyId, setExtensionBusyId] = useState<string>();
  const [extensionPackageReceipt, setExtensionPackageReceipt] =
    useState<ExtensionPackageReceipt>();
  const [extensionPackageUpdatePreview, setExtensionPackageUpdatePreview] =
    useState<ExtensionPackageUpdatePreview>();
  const [extensionPackageUpdateEnvelope, setExtensionPackageUpdateEnvelope] =
    useState<unknown>();
  const [
    extensionPackageDeploymentPreview,
    setExtensionPackageDeploymentPreview,
  ] = useState<ExtensionPackageDeploymentPreview>();
  const [extensionPackageRolloutPreview, setExtensionPackageRolloutPreview] =
    useState<ExtensionPackageRolloutPreview>();
  const [
    extensionPackageDeploymentEnvelopes,
    setExtensionPackageDeploymentEnvelopes,
  ] = useState<unknown[]>();
  const [labLeftRunId, setLabLeftRunId] = useState("");
  const [labRightRunId, setLabRightRunId] = useState("");
  const [runComparison, setRunComparison] = useState<RunComparison>();
  const [runReplayVerificationReceipt, setRunReplayVerificationReceipt] =
    useState<RunReplayVerificationReceipt>();
  const [labBusyAction, setLabBusyAction] = useState<string>();
  const [labFixtureReceipt, setLabFixtureReceipt] =
    useState<FixtureTransferReceipt>();
  const [traceExportBusy, setTraceExportBusy] = useState(false);
  const [traceExportReceipt, setTraceExportReceipt] =
    useState<OpenTelemetryTraceReceipt>();
  const [traceVerifyBusy, setTraceVerifyBusy] = useState(false);
  const [traceVerificationReceipt, setTraceVerificationReceipt] =
    useState<OpenTelemetryTraceVerificationReceipt>();
  const [streamingText, setStreamingText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string>();

  const loadBootstrap = useCallback(async (threadId?: string) => {
    setIsLoading(true);
    setError(undefined);
    try {
      const result = await getBootstrap(threadId);
      setBootstrap(result);
      setDetail(result.activeThread);
      setSelectedThreadId(result.activeThread?.thread.id);
      setSelectedModelKey(modelKey(result.activeThread?.agent.model));
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  const messages = useMemo<MessageView[]>(() => {
    return (detail?.events ?? []).flatMap((event): MessageView[] => {
      if (event.type !== "message.user" && event.type !== "message.assistant")
        return [];
      const payload = messagePayload(event);
      if (!payload) return [];
      return [
        {
          id: event.id,
          seq: event.seq,
          role: payload.role,
          text: payload.text,
          reasoning: payload.reasoning ?? "",
          model: payload.model ?? "",
          createdAt: event.createdAt,
        },
      ];
    });
  }, [detail?.events]);

  const visibleTrace = useMemo(
    () =>
      (detail?.events ?? [])
        .filter((event) => event.visibility !== "hidden")
        .slice()
        .reverse(),
    [detail?.events],
  );
  const resumableRun = useMemo(
    () =>
      detail?.thread.status === "waiting"
        ? detail.runs
            .slice()
            .reverse()
            .find((run) => run.status === "interrupted")
        : undefined,
    [detail],
  );
  const terminalRuns = useMemo(
    () =>
      (detail?.runs ?? []).filter(
        (run) => run.status !== "queued" && run.status !== "running",
      ),
    [detail?.runs],
  );
  const contextCheckpoint = useMemo(
    () =>
      (detail?.events ?? [])
        .slice()
        .reverse()
        .flatMap((event): ContextCheckpointSnapshot[] => {
          if (event.type !== "context.compaction.completed") return [];
          const checkpoint = contextCheckpointPayload(event.payload);
          return checkpoint ? [checkpoint] : [];
        })
        .at(0),
    [detail?.events],
  );
  const terminalRunKey = terminalRuns
    .map((run) => `${run.id}:${run.status}`)
    .join("|");

  useEffect(() => {
    const ids = new Set(terminalRuns.map((run) => run.id));
    const fallbackLeft = terminalRuns.at(-2)?.id ?? "";
    const fallbackRight = terminalRuns.at(-1)?.id ?? "";
    setLabLeftRunId((current) =>
      ids.has(current) && current !== fallbackRight ? current : fallbackLeft,
    );
    setLabRightRunId((current) =>
      ids.has(current) && current !== fallbackLeft ? current : fallbackRight,
    );
    setRunComparison(undefined);
  }, [detail?.thread.id, terminalRunKey]);

  const selectThread = useCallback(async (threadId: string) => {
    setSelectedThreadId(threadId);
    setStreamingText("");
    setLabFixtureReceipt(undefined);
    setRunReplayVerificationReceipt(undefined);
    setTraceExportReceipt(undefined);
    setTraceVerificationReceipt(undefined);
    setError(undefined);
    try {
      const selected = await getThread(threadId);
      setDetail(selected);
      setSelectedModelKey(modelKey(selected.agent.model));
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    }
  }, []);

  const newThread = useCallback(async () => {
    setLabFixtureReceipt(undefined);
    setRunReplayVerificationReceipt(undefined);
    setTraceExportReceipt(undefined);
    setTraceVerificationReceipt(undefined);
    setError(undefined);
    try {
      const created = await createThread();
      setDetail(created);
      setSelectedThreadId(created.thread.id);
      setSelectedModelKey(modelKey(created.agent.model));
      setBootstrap((current) =>
        current
          ? {
              ...current,
              threads: [created.thread, ...current.threads],
              activeThread: created,
            }
          : current,
      );
    } catch (createError) {
      setError(toErrorMessage(createError));
    }
  }, []);

  const handleStreamFrame = useCallback((frame: StreamFrame): void => {
    if (frame.type === "event") {
      const event = frame.event;
      if (event.type === "model.text.delta") {
        const delta = objectString(event.payload, "delta");
        if (delta) setStreamingText((current) => current + delta);
      }
      if (
        event.type === "message.assistant" ||
        event.type === "model.advisor.blocked" ||
        event.type === "model.advisor.correction.requested"
      ) {
        setStreamingText("");
      }
      setDetail((current) =>
        current
          ? {
              ...current,
              thread: {
                ...current.thread,
                status: "running",
                eventCount: event.seq,
                updatedAt: event.createdAt,
              },
              events: [...current.events, event],
            }
          : current,
      );
    } else if (frame.type === "snapshot") {
      setDetail(frame.detail);
      setBootstrap((current) =>
        current
          ? {
              ...current,
              threads: upsertThread(current.threads, frame.detail.thread),
            }
          : current,
      );
    } else if (frame.type === "error") {
      setError(
        `${frame.message} (${frame.code} · ${frame.diagnosticSha256.slice(0, 12)})`,
      );
    }
  }, []);

  const submit = useCallback(
    async (override?: string) => {
      const text = (override ?? composer).trim();
      if (!text || !detail || isRunning) return;
      setComposer("");
      setStreamingText("");
      setIsRunning(true);
      setRunReplayVerificationReceipt(undefined);
      setTraceExportReceipt(undefined);
      setTraceVerificationReceipt(undefined);
      setError(undefined);
      try {
        await streamPrompt(
          detail.thread.id,
          { text, model: parseModelKey(selectedModelKey) },
          handleStreamFrame,
        );
        const refreshed = await getBootstrap(detail.thread.id);
        setBootstrap(refreshed);
        setDetail(refreshed.activeThread);
      } catch (runError) {
        setError(toErrorMessage(runError));
      } finally {
        setIsRunning(false);
        setStreamingText("");
      }
    },
    [composer, detail, handleStreamFrame, isRunning, selectedModelKey],
  );

  const resume = useCallback(async () => {
    if (!detail || !resumableRun || isRunning) return;
    setStreamingText("");
    setIsRunning(true);
    setRunReplayVerificationReceipt(undefined);
    setTraceExportReceipt(undefined);
    setTraceVerificationReceipt(undefined);
    setError(undefined);
    try {
      await resumeRunApi(
        detail.thread.id,
        {
          runId: resumableRun.id,
          model: parseModelKey(selectedModelKey),
        },
        handleStreamFrame,
      );
      const refreshed = await getBootstrap(detail.thread.id);
      setBootstrap(refreshed);
      setDetail(refreshed.activeThread);
    } catch (runError) {
      setError(toErrorMessage(runError));
    } finally {
      setIsRunning(false);
      setStreamingText("");
    }
  }, [detail, handleStreamFrame, isRunning, resumableRun, selectedModelKey]);

  const stop = useCallback(async () => {
    if (!detail) return;
    try {
      await stopRun(detail.thread.id);
    } catch (stopError) {
      setError(toErrorMessage(stopError));
    }
  }, [detail]);

  const saveGoal = useCallback(async () => {
    if (!detail || !goalDraft.trim()) return;
    try {
      const updated = await setGoal(detail.thread.id, {
        objective: goalDraft.trim(),
      });
      setDetail(updated);
      setGoalDraft("");
      setInspectorTab("goal");
      setBootstrap((current) =>
        current
          ? {
              ...current,
              threads: upsertThread(current.threads, updated.thread),
            }
          : current,
      );
    } catch (goalError) {
      setError(toErrorMessage(goalError));
    }
  }, [detail, goalDraft]);

  const removeGoal = useCallback(async () => {
    if (!detail) return;
    try {
      const updated = await clearGoal(detail.thread.id);
      setDetail(updated);
      setBootstrap((current) =>
        current
          ? {
              ...current,
              threads: upsertThread(current.threads, updated.thread),
            }
          : current,
      );
    } catch (goalError) {
      setError(toErrorMessage(goalError));
    }
  }, [detail]);

  const branchFrom = useCallback(
    async (seq: number) => {
      if (!detail) return;
      try {
        const branch = await createBranch(detail.thread.id, { fromSeq: seq });
        setDetail(branch);
        setSelectedThreadId(branch.thread.id);
        setSelectedModelKey(modelKey(branch.agent.model));
        setBootstrap((current) =>
          current
            ? {
                ...current,
                threads: [branch.thread, ...current.threads],
                activeThread: branch,
              }
            : current,
        );
      } catch (branchError) {
        setError(toErrorMessage(branchError));
      }
    },
    [detail],
  );

  const saveMemory = useCallback(async () => {
    if (!detail || !memoryDraft.trim()) return;
    if (memoryConsolidatesIds.length === 1) return;
    try {
      const correctionTarget = memorySupersedesId
        ? bootstrap?.memories.find((memory) => memory.id === memorySupersedesId)
        : undefined;
      const consolidationTargets = memoryConsolidatesIds.flatMap((memoryId) => {
        const memory = bootstrap?.memories.find(
          (candidate) => candidate.id === memoryId,
        );
        return memory ? [memory] : [];
      });
      const replacementTarget = correctionTarget ?? consolidationTargets[0];
      const effectiveScope = replacementTarget?.scope ?? memoryScope;
      const effectiveAgentId =
        effectiveScope === "agent"
          ? (replacementTarget?.agentId ?? detail.agent.id)
          : undefined;
      const fact = await proposeMemory({
        content: memoryDraft.trim(),
        category: memoryCategory,
        scope: effectiveScope,
        ...(effectiveAgentId ? { agentId: effectiveAgentId } : {}),
        reviewIntervalDays: memoryReviewIntervalDays,
        ...(memorySupersedesId
          ? { supersedesMemoryId: memorySupersedesId }
          : {}),
        ...(memoryConsolidatesIds.length >= 2
          ? { consolidatesMemoryIds: memoryConsolidatesIds }
          : {}),
        threadId: detail.thread.id,
      });
      setMemoryDraft("");
      setMemorySupersedesId(undefined);
      setMemoryConsolidatesIds([]);
      if (replacementTarget) {
        setMemoryCategory("context");
        setMemoryScope("workspace");
        setMemoryReviewIntervalDays(90);
      }
      setBootstrap((current) =>
        current
          ? {
              ...current,
              memories: upsertMemory(current.memories, fact),
            }
          : current,
      );
      setDetail(await getThread(detail.thread.id));
      setInspectorTab("memory");
    } catch (memoryError) {
      setError(toErrorMessage(memoryError));
    }
  }, [
    bootstrap?.memories,
    detail,
    memoryCategory,
    memoryConsolidatesIds,
    memoryDraft,
    memoryReviewIntervalDays,
    memoryScope,
    memorySupersedesId,
  ]);

  const startMemoryCorrection = useCallback((memory: MemoryFact): void => {
    setMemoryConsolidatesIds([]);
    setMemoryDraft(memory.content);
    setMemoryCategory("correction");
    setMemoryScope(memory.scope);
    setMemoryReviewIntervalDays(memory.reviewIntervalDays);
    setMemorySupersedesId(memory.id);
    setInspectorTab("memory");
  }, []);

  const cancelMemoryCorrection = useCallback((): void => {
    setMemorySupersedesId(undefined);
    setMemoryDraft("");
    setMemoryCategory("context");
    setMemoryScope("workspace");
    setMemoryReviewIntervalDays(90);
  }, []);

  const toggleMemoryConsolidation = useCallback(
    (memory: MemoryFact): void => {
      const selected = memoryConsolidatesIds.flatMap((memoryId) => {
        const candidate = bootstrap?.memories.find(
          (item) => item.id === memoryId,
        );
        return candidate ? [candidate] : [];
      });
      const alreadySelected = memoryConsolidatesIds.includes(memory.id);
      if (!alreadySelected) {
        const anchor = selected[0];
        if (
          anchor &&
          (anchor.scope !== memory.scope || anchor.agentId !== memory.agentId)
        ) {
          setError(copy.memory.errors.consolidationScope);
          return;
        }
        if (memoryConsolidatesIds.length >= 8) {
          setError(copy.memory.errors.consolidationLimit);
          return;
        }
      }
      const nextIds = alreadySelected
        ? memoryConsolidatesIds.filter((memoryId) => memoryId !== memory.id)
        : [...memoryConsolidatesIds, memory.id];
      const nextTargets = [
        ...selected,
        ...(!alreadySelected ? [memory] : []),
      ].filter((candidate) => nextIds.includes(candidate.id));
      setMemorySupersedesId(undefined);
      setMemoryConsolidatesIds(nextIds);
      if (memoryConsolidatesIds.length === 0 || nextIds.length === 0) {
        setMemoryDraft("");
      }
      if (nextTargets[0]) {
        const sourceCategories = nextTargets.map((candidate) =>
          candidate.category === "correction" ? "context" : candidate.category,
        );
        setMemoryCategory(
          sourceCategories.every((category) => category === sourceCategories[0])
            ? sourceCategories[0]!
            : "context",
        );
        setMemoryScope(nextTargets[0].scope);
        setMemoryReviewIntervalDays(
          Math.min(
            ...nextTargets.map((candidate) => candidate.reviewIntervalDays),
          ),
        );
      } else {
        setMemoryCategory("context");
        setMemoryScope("workspace");
        setMemoryReviewIntervalDays(90);
      }
      setInspectorTab("memory");
    },
    [bootstrap?.memories, memoryConsolidatesIds],
  );

  const cancelMemoryConsolidation = useCallback((): void => {
    setMemoryConsolidatesIds([]);
    setMemoryDraft("");
    setMemoryCategory("context");
    setMemoryScope("workspace");
    setMemoryReviewIntervalDays(90);
  }, []);

  const reviewMemoryFact = useCallback(
    async (
      memoryId: string,
      action: ReviewMemoryRequest["action"],
    ): Promise<void> => {
      if (!detail) return;
      try {
        await reviewMemory(memoryId, {
          action,
          threadId: detail.thread.id,
        });
        const refreshed = await getBootstrap(detail.thread.id);
        setBootstrap(refreshed);
        setDetail(refreshed.activeThread);
      } catch (memoryError) {
        setError(toErrorMessage(memoryError));
      }
    },
    [detail],
  );

  const commitExtension = useCallback(
    async (extension: ExtensionRecord): Promise<void> => {
      setBootstrap((current) =>
        current
          ? {
              ...current,
              extensions: upsertExtension(current.extensions, extension),
            }
          : current,
      );
      if (detail) setDetail(await getThread(detail.thread.id));
    },
    [detail],
  );

  const refreshExtensionWorkspace = useCallback(async (): Promise<void> => {
    if (!detail) return;
    const refreshed = await getBootstrap(detail.thread.id);
    setBootstrap(refreshed);
    setDetail(refreshed.activeThread);
  }, [detail]);

  const runExtensionMutation = useCallback(
    async (
      busyId: string,
      operation: () => Promise<ExtensionRecord>,
    ): Promise<void> => {
      setExtensionBusyId(busyId);
      setError(undefined);
      try {
        await commitExtension(await operation());
      } catch (extensionError) {
        setError(toErrorMessage(extensionError));
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [commitExtension],
  );

  const proposeMcpExtension = useCallback(
    async (
      request: Omit<CreateMcpExtensionRequest, "threadId">,
    ): Promise<void> => {
      if (!detail) return;
      setExtensionBusyId("new");
      setError(undefined);
      try {
        const extension = await createMcpExtension({
          ...request,
          threadId: detail.thread.id,
        });
        await commitExtension(extension);
        setInspectorTab("extensions");
      } catch (extensionError) {
        setError(toErrorMessage(extensionError));
        throw extensionError;
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [commitExtension, detail],
  );

  const reviewExtensionTrust = useCallback(
    async (
      extensionId: string,
      action: ReviewExtensionRequest["action"],
    ): Promise<void> => {
      if (!detail) return;
      await runExtensionMutation(extensionId, () =>
        reviewExtension(extensionId, {
          action,
          threadId: detail.thread.id,
        }),
      );
    },
    [detail, runExtensionMutation],
  );

  const connectMcpExtension = useCallback(
    async (extensionId: string): Promise<void> => {
      await runExtensionMutation(extensionId, () =>
        connectExtension(extensionId, detail?.thread.id),
      );
    },
    [detail?.thread.id, runExtensionMutation],
  );

  const disconnectMcpExtension = useCallback(
    async (extensionId: string): Promise<void> => {
      await runExtensionMutation(extensionId, () =>
        disconnectExtension(extensionId, detail?.thread.id),
      );
    },
    [detail?.thread.id, runExtensionMutation],
  );

  const reviewExtensionTool = useCallback(
    async (
      extensionId: string,
      toolName: string,
      action: "approve" | "reject",
      effect?: McpToolEffect,
      routingHint?: string,
    ): Promise<void> => {
      if (!detail) return;
      await runExtensionMutation(extensionId, () =>
        reviewMcpTool(extensionId, toolName, {
          action,
          ...(effect ? { effect } : {}),
          ...(routingHint?.trim() ? { routingHint: routingHint.trim() } : {}),
          threadId: detail.thread.id,
        }),
      );
    },
    [detail, runExtensionMutation],
  );

  const toggleExtension = useCallback(
    async (extensionId: string, enabled: boolean): Promise<void> => {
      if (!detail) return;
      await runExtensionMutation(extensionId, () =>
        setExtensionEnabled(extensionId, {
          agentId: detail.agent.id,
          enabled,
          threadId: detail.thread.id,
        }),
      );
    },
    [detail, runExtensionMutation],
  );

  const createExtensionPublisher = useCallback(
    async (draft: ExtensionPublisherDraft): Promise<void> => {
      if (!detail) return;
      setExtensionBusyId("publisher:new");
      setError(undefined);
      try {
        await createExtensionPublisherTrustAnchorApi({
          threadId: detail.thread.id,
          label: draft.label,
          source: draft.source,
        });
        await refreshExtensionWorkspace();
      } catch (publisherError) {
        setError(toErrorMessage(publisherError));
        throw publisherError;
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [detail, refreshExtensionWorkspace],
  );

  const revokeExtensionPublisher = useCallback(
    async (anchorId: string): Promise<void> => {
      if (!detail) return;
      setExtensionBusyId(`publisher:${anchorId}`);
      setError(undefined);
      try {
        await revokeExtensionPublisherTrustAnchorApi(
          anchorId,
          detail.thread.id,
        );
        setExtensionPackageUpdatePreview(undefined);
        setExtensionPackageUpdateEnvelope(undefined);
        setExtensionPackageDeploymentPreview(undefined);
        setExtensionPackageDeploymentEnvelopes(undefined);
        await refreshExtensionWorkspace();
      } catch (publisherError) {
        setError(toErrorMessage(publisherError));
        throw publisherError;
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [detail, refreshExtensionWorkspace],
  );

  const downloadSignedExtensionPackage = useCallback(
    async (
      extensionId: string,
      draft: ExtensionPackageSignDraft,
    ): Promise<void> => {
      if (!detail || !bootstrap) return;
      setExtensionBusyId("package:sign");
      setExtensionPackageReceipt(undefined);
      setError(undefined);
      try {
        const envelope = await signExtensionPackageApi(extensionId, {
          threadId: detail.thread.id,
          trustAnchorId: draft.trustAnchorId,
          publisher: draft.publisher,
          ...(draft.dependencies ? { dependencies: draft.dependencies } : {}),
          ...(draft.expiresAt ? { expiresAt: draft.expiresAt } : {}),
        });
        const normalizedName =
          bootstrap.extensions.find((extension) => extension.id === extensionId)
            ?.normalizedName ?? extensionId;
        downloadJson(
          envelope,
          `${normalizedName}-${envelope.contentSha256.slice(0, 12)}.napier-extension.json`,
        );
        setExtensionPackageReceipt({
          action: "signed",
          status: "trusted",
          reason: extensionCopy.packages.signedNotApproved,
          extensionId,
          packageName: envelope.manifest.name,
          packageVersion: envelope.manifest.version,
          keyId: envelope.signature.keyId,
          manifestSha256: envelope.manifest.contentSha256,
          envelopeSha256: envelope.contentSha256,
        });
        const refreshed = await getThread(detail.thread.id);
        setDetail(refreshed);
        setBootstrap((current) =>
          current ? { ...current, activeThread: refreshed } : current,
        );
      } catch (packageError) {
        setError(toErrorMessage(packageError));
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [bootstrap, detail],
  );

  const verifySignedExtensionPackageFile = useCallback(
    async (file: File): Promise<void> => {
      if (file.size > MAX_EXTENSION_PACKAGE_LOCKFILE_FILE_BYTES) {
        setError(extensionCopy.packages.errors.lockfileTooLarge);
        return;
      }
      setExtensionBusyId("package:verify");
      setExtensionPackageReceipt(undefined);
      setError(undefined);
      try {
        const artifact = JSON.parse(await file.text()) as unknown;
        if (isExtensionPackageLockfile(artifact)) {
          const verification = await verifyExtensionPackageLockfileApi({
            lockfile: artifact,
          });
          setExtensionPackageReceipt({
            action: "lockfile_verified",
            status: verification.status,
            reason:
              verification.status === "trusted"
                ? extensionCopy.packages.lockfileVerified
                : verification.reason,
            ...(verification.lockfileSha256
              ? { envelopeSha256: verification.lockfileSha256 }
              : {}),
          });
          return;
        }
        if (isSignedExtensionPackageChannelIndexEnvelope(artifact)) {
          if (file.size > MAX_EXTENSION_PACKAGE_CHANNEL_INDEX_FILE_BYTES) {
            setError(extensionCopy.packages.errors.channelIndexTooLarge);
            return;
          }
          const verification = await verifyExtensionPackageChannelIndexApi({
            envelope: artifact,
          });
          setExtensionPackageReceipt({
            action: "channel_index_verified",
            status: verification.status,
            reason:
              verification.status === "trusted"
                ? extensionCopy.packages.channelIndexVerified
                : verification.reason,
            ...(verification.keyId ? { keyId: verification.keyId } : {}),
            ...(verification.indexSha256
              ? { indexSha256: verification.indexSha256 }
              : {}),
            ...(verification.envelopeSha256
              ? { envelopeSha256: verification.envelopeSha256 }
              : {}),
            channelCount: verification.channelCount,
          });
          return;
        }
        if (file.size > MAX_SIGNED_EXTENSION_PACKAGE_FILE_BYTES) {
          setError(extensionCopy.packages.errors.tooLarge);
          return;
        }
        const verification = await verifySignedExtensionPackageApi({
          envelope: artifact,
        });
        setExtensionPackageReceipt({
          action: "verified",
          status: verification.status,
          reason: verification.reason,
          ...(verification.packageName
            ? { packageName: verification.packageName }
            : {}),
          ...(verification.packageVersion
            ? { packageVersion: verification.packageVersion }
            : {}),
          ...(verification.keyId ? { keyId: verification.keyId } : {}),
          ...(verification.manifestSha256
            ? { manifestSha256: verification.manifestSha256 }
            : {}),
          ...(verification.envelopeSha256
            ? { envelopeSha256: verification.envelopeSha256 }
            : {}),
        });
      } catch (packageError) {
        setError(
          packageError instanceof SyntaxError
            ? extensionCopy.packages.errors.invalid
            : toErrorMessage(packageError),
        );
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [],
  );

  const importSignedExtensionPackageFile = useCallback(
    async (file: File): Promise<void> => {
      if (!detail) return;
      if (file.size > MAX_SIGNED_EXTENSION_PACKAGE_FILE_BYTES) {
        setError(extensionCopy.packages.errors.tooLarge);
        return;
      }
      setExtensionBusyId("package:import");
      setExtensionPackageReceipt(undefined);
      setError(undefined);
      try {
        const envelope = JSON.parse(await file.text()) as unknown;
        const extension = await importSignedExtensionPackageApi({
          threadId: detail.thread.id,
          envelope,
        });
        setExtensionPackageUpdatePreview(undefined);
        setExtensionPackageUpdateEnvelope(undefined);
        setExtensionPackageDeploymentPreview(undefined);
        setExtensionPackageDeploymentEnvelopes(undefined);
        setExtensionPackageRolloutPreview(undefined);
        await commitExtension(extension);
        const packageBinding = extension.packageBinding;
        if (!packageBinding) {
          throw new Error(
            "Signed Extension import did not produce a package binding",
          );
        }
        const signed = packageBinding.envelope;
        setExtensionPackageReceipt({
          action: "imported",
          status: "trusted",
          reason: extensionCopy.packages.signedNotApproved,
          extensionId: extension.id,
          packageName: signed.manifest.name,
          packageVersion: signed.manifest.version,
          keyId: signed.signature.keyId,
          manifestSha256: signed.manifest.contentSha256,
          envelopeSha256: signed.contentSha256,
        });
      } catch (packageError) {
        setError(
          packageError instanceof SyntaxError
            ? extensionCopy.packages.errors.invalid
            : toErrorMessage(packageError),
        );
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [commitExtension, detail],
  );

  const exportExtensionPackageLockfile =
    useCallback(async (): Promise<void> => {
      if (!detail) return;
      setExtensionBusyId("package:lockfile-export");
      setExtensionPackageReceipt(undefined);
      setError(undefined);
      try {
        const lockfile = await exportExtensionPackageLockfileApi({
          threadId: detail.thread.id,
        });
        downloadJson(
          lockfile,
          `napier-extension-lockfile-${lockfile.contentSha256.slice(0, 12)}.json`,
        );
        setExtensionPackageReceipt({
          action: "lockfile_exported",
          status: "trusted",
          reason: extensionCopy.packages.lockfileExported,
          envelopeSha256: lockfile.contentSha256,
        });
        await refreshExtensionWorkspace();
      } catch (packageError) {
        setError(toErrorMessage(packageError));
      } finally {
        setExtensionBusyId(undefined);
      }
    }, [detail, refreshExtensionWorkspace]);

  const downloadExtensionPackageChannelIndex = useCallback(
    async (trustAnchorId: string, publisher: string): Promise<void> => {
      if (!detail) return;
      setExtensionBusyId("package:channel-index-sign");
      setExtensionPackageReceipt(undefined);
      setError(undefined);
      try {
        const envelope = await signExtensionPackageChannelIndexApi({
          threadId: detail.thread.id,
          trustAnchorId,
          publisher,
          lockfileBaseUrl: window.location.origin,
        });
        downloadJson(
          envelope,
          `napier-channel-index-${envelope.index.contentSha256.slice(0, 12)}.json`,
        );
        setExtensionPackageReceipt({
          action: "channel_index_signed",
          status: "trusted",
          reason: extensionCopy.packages.channelIndexSigned,
          keyId: envelope.signature.keyId,
          indexSha256: envelope.index.contentSha256,
          envelopeSha256: envelope.contentSha256,
          channelCount: envelope.index.channels.length,
        });
        await refreshExtensionWorkspace();
      } catch (packageError) {
        setError(toErrorMessage(packageError));
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [detail, refreshExtensionWorkspace],
  );

  const publishExtensionPackageRolloutChannel = useCallback(
    async (name: string): Promise<void> => {
      if (!detail) return;
      setExtensionBusyId("package:rollout-publish");
      setExtensionPackageReceipt(undefined);
      setError(undefined);
      try {
        const channel = await publishExtensionPackageRolloutChannelApi({
          threadId: detail.thread.id,
          name,
        });
        setExtensionPackageReceipt({
          action: "rollout_published",
          status: "trusted",
          reason: extensionCopy.packages.rolloutPublished,
          envelopeSha256: channel.lockfileSha256,
        });
        setExtensionPackageRolloutPreview(undefined);
        setExtensionPackageDeploymentPreview(undefined);
        setExtensionPackageDeploymentEnvelopes(undefined);
        await refreshExtensionWorkspace();
      } catch (packageError) {
        setError(toErrorMessage(packageError));
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [detail, refreshExtensionWorkspace],
  );

  const previewExtensionPackageRolloutChannel = useCallback(
    async (channelId: string): Promise<void> => {
      setExtensionBusyId(`package:rollout-preview:${channelId}`);
      setExtensionPackageReceipt(undefined);
      setExtensionPackageUpdatePreview(undefined);
      setExtensionPackageUpdateEnvelope(undefined);
      setExtensionPackageDeploymentPreview(undefined);
      setExtensionPackageDeploymentEnvelopes(undefined);
      setExtensionPackageRolloutPreview(undefined);
      setError(undefined);
      try {
        const preview =
          await previewExtensionPackageRolloutChannelApi(channelId);
        setExtensionPackageRolloutPreview(preview);
        setExtensionPackageDeploymentPreview(preview.deploymentPreview);
      } catch (packageError) {
        setError(toErrorMessage(packageError));
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [],
  );

  const previewExtensionPackageUpdateFile = useCallback(
    async (extensionId: string, file: File): Promise<void> => {
      if (file.size > MAX_SIGNED_EXTENSION_PACKAGE_FILE_BYTES) {
        setError(extensionCopy.packages.errors.tooLarge);
        return;
      }
      setExtensionBusyId("package:update-preview");
      setExtensionPackageReceipt(undefined);
      setExtensionPackageUpdatePreview(undefined);
      setExtensionPackageUpdateEnvelope(undefined);
      setExtensionPackageDeploymentPreview(undefined);
      setExtensionPackageDeploymentEnvelopes(undefined);
      setExtensionPackageRolloutPreview(undefined);
      setError(undefined);
      try {
        const envelope = JSON.parse(await file.text()) as unknown;
        const preview = await previewExtensionPackageUpdateApi(extensionId, {
          envelope,
        });
        setExtensionPackageUpdateEnvelope(envelope);
        setExtensionPackageUpdatePreview(preview);
      } catch (packageError) {
        setError(
          packageError instanceof SyntaxError
            ? extensionCopy.packages.errors.invalid
            : toErrorMessage(packageError),
        );
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [],
  );

  const applyExtensionPackageUpdate = useCallback(
    async (confirmation: ExtensionPackageUpdateConfirmation): Promise<void> => {
      if (
        !detail ||
        !extensionPackageUpdatePreview ||
        extensionPackageUpdateEnvelope === undefined
      ) {
        return;
      }
      setExtensionBusyId("package:update");
      setExtensionPackageReceipt(undefined);
      setError(undefined);
      try {
        const result = await applyExtensionPackageUpdateApi(
          extensionPackageUpdatePreview.extensionId,
          {
            threadId: detail.thread.id,
            envelope: extensionPackageUpdateEnvelope,
            expectedPackageBindingSha256:
              extensionPackageUpdatePreview.expectedPackageBindingSha256,
            ...(confirmation.publisherChange
              ? { confirmPublisherChange: true }
              : {}),
            ...(confirmation.versionOverride
              ? { confirmVersionOverride: true }
              : {}),
          },
        );
        await commitExtension(result.extension);
        setExtensionPackageReceipt({
          action: "updated",
          status: "trusted",
          reason: result.updated
            ? extensionCopy.packages.reviewReset
            : extensionCopy.packages.noUpdateChanges,
          extensionId: result.extension.id,
          packageName: result.extension.name,
          packageVersion: result.preview.next.version,
          keyId: result.preview.next.keyId,
          manifestSha256: result.preview.next.manifestSha256,
          envelopeSha256: result.preview.next.envelopeSha256,
        });
        setExtensionPackageUpdatePreview(undefined);
        setExtensionPackageUpdateEnvelope(undefined);
      } catch (packageError) {
        setError(toErrorMessage(packageError));
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [
      commitExtension,
      detail,
      extensionPackageUpdateEnvelope,
      extensionPackageUpdatePreview,
    ],
  );

  const cancelExtensionPackageUpdate = useCallback((): void => {
    setExtensionPackageUpdatePreview(undefined);
    setExtensionPackageUpdateEnvelope(undefined);
  }, []);

  const previewExtensionPackageDeploymentFiles = useCallback(
    async (files: File[]): Promise<void> => {
      const totalBytes = files.reduce((total, file) => total + file.size, 0);
      const singleLockfileCandidate = files.length === 1;
      if (
        files.length < 1 ||
        files.length > MAX_EXTENSION_PACKAGE_DEPLOYMENT_FILES ||
        totalBytes > MAX_EXTENSION_PACKAGE_DEPLOYMENT_FILE_BYTES ||
        (!singleLockfileCandidate &&
          files.some(
            (file) => file.size > MAX_SIGNED_EXTENSION_PACKAGE_FILE_BYTES,
          ))
      ) {
        setError(extensionCopy.packages.errors.deploymentTooLarge);
        return;
      }
      setExtensionBusyId("package:deployment-preview");
      setExtensionPackageReceipt(undefined);
      setExtensionPackageDeploymentPreview(undefined);
      setExtensionPackageDeploymentEnvelopes(undefined);
      setExtensionPackageRolloutPreview(undefined);
      setExtensionPackageUpdatePreview(undefined);
      setExtensionPackageUpdateEnvelope(undefined);
      setError(undefined);
      try {
        const parsed = await Promise.all(
          files.map(async (file) => JSON.parse(await file.text()) as unknown),
        );
        const envelopes =
          parsed.length === 1 && isExtensionPackageLockfile(parsed[0])
            ? parsed[0].packages.map((entry) => entry.envelope)
            : parsed;
        const preview = await previewExtensionPackageDeploymentApi({
          envelopes,
        });
        setExtensionPackageDeploymentEnvelopes(envelopes);
        setExtensionPackageDeploymentPreview(preview);
      } catch (packageError) {
        setError(
          packageError instanceof SyntaxError
            ? extensionCopy.packages.errors.invalid
            : toErrorMessage(packageError),
        );
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [],
  );

  const applyExtensionPackageDeployment = useCallback(
    async (
      confirmation: ExtensionPackageDeploymentConfirmation,
    ): Promise<void> => {
      if (
        !detail ||
        !extensionPackageDeploymentPreview ||
        (!extensionPackageDeploymentEnvelopes &&
          !extensionPackageRolloutPreview)
      ) {
        return;
      }
      setExtensionBusyId("package:deployment");
      setExtensionPackageReceipt(undefined);
      setError(undefined);
      try {
        let deploymentNoChanges: boolean;
        let receiptReason: string;
        if (extensionPackageRolloutPreview) {
          const result = await applyExtensionPackageRolloutChannelApi(
            extensionPackageRolloutPreview.channelId,
            {
              threadId: detail.thread.id,
              expectedRolloutSha256:
                extensionPackageRolloutPreview.contentSha256,
              expectedDeploymentSha256:
                extensionPackageRolloutPreview.deploymentPreview.contentSha256,
              ...(confirmation.publisherChanges
                ? { confirmPublisherChanges: true }
                : {}),
              ...(confirmation.versionOverrides
                ? { confirmVersionOverrides: true }
                : {}),
            },
          );
          deploymentNoChanges = result.deployment.preview.noChanges;
          receiptReason = deploymentNoChanges
            ? extensionCopy.packages.noUpdateChanges
            : extensionCopy.packages.rolloutApplied;
        } else {
          if (!extensionPackageDeploymentEnvelopes) return;
          const result = await applyExtensionPackageDeploymentApi({
            threadId: detail.thread.id,
            envelopes: extensionPackageDeploymentEnvelopes,
            expectedDeploymentSha256:
              extensionPackageDeploymentPreview.contentSha256,
            ...(confirmation.publisherChanges
              ? { confirmPublisherChanges: true }
              : {}),
            ...(confirmation.versionOverrides
              ? { confirmVersionOverrides: true }
              : {}),
          });
          deploymentNoChanges = result.preview.noChanges;
          receiptReason = deploymentNoChanges
            ? extensionCopy.packages.noUpdateChanges
            : extensionCopy.packages.deploymentReviewReset;
        }
        await refreshExtensionWorkspace();
        setExtensionPackageReceipt({
          action: extensionPackageRolloutPreview
            ? "rollout_applied"
            : "deployed",
          status: "trusted",
          reason: receiptReason,
        });
        setExtensionPackageDeploymentPreview(undefined);
        setExtensionPackageDeploymentEnvelopes(undefined);
        setExtensionPackageRolloutPreview(undefined);
      } catch (packageError) {
        setError(toErrorMessage(packageError));
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [
      detail,
      extensionPackageDeploymentEnvelopes,
      extensionPackageDeploymentPreview,
      extensionPackageRolloutPreview,
      refreshExtensionWorkspace,
    ],
  );

  const cancelExtensionPackageDeployment = useCallback((): void => {
    setExtensionPackageDeploymentPreview(undefined);
    setExtensionPackageDeploymentEnvelopes(undefined);
    setExtensionPackageRolloutPreview(undefined);
  }, []);

  const selectLabLeftRun = useCallback((runId: string) => {
    setLabLeftRunId(runId);
    setRunComparison(undefined);
  }, []);

  const selectLabRightRun = useCallback((runId: string) => {
    setLabRightRunId(runId);
    setRunComparison(undefined);
  }, []);

  const compareSelectedRuns = useCallback(async () => {
    if (!detail || !labLeftRunId || !labRightRunId) return;
    if (labLeftRunId === labRightRunId) {
      setError(copy.lab.errors.distinct);
      return;
    }
    setLabBusyAction("compare");
    setError(undefined);
    try {
      setRunComparison(
        await compareThreadRuns(detail.thread.id, labLeftRunId, labRightRunId),
      );
      setInspectorTab("lab");
    } catch (comparisonError) {
      setError(toErrorMessage(comparisonError));
    } finally {
      setLabBusyAction(undefined);
    }
  }, [detail, labLeftRunId, labRightRunId]);

  const evaluateSelectedRuns = useCallback(async () => {
    if (!detail || !labLeftRunId || !labRightRunId) return;
    if (labLeftRunId === labRightRunId) {
      setError(copy.lab.errors.distinct);
      return;
    }
    setLabBusyAction("evaluate");
    setError(undefined);
    try {
      const comparison = await compareThreadRuns(
        detail.thread.id,
        labLeftRunId,
        labRightRunId,
      );
      await createRunEvaluation(detail.thread.id, {
        leftRunId: labLeftRunId,
        rightRunId: labRightRunId,
        model: parseModelKey(selectedModelKey),
      });
      const refreshed = await getThread(detail.thread.id);
      setRunComparison(comparison);
      setDetail(refreshed);
      setBootstrap((current) =>
        current ? { ...current, activeThread: refreshed } : current,
      );
      setInspectorTab("lab");
    } catch (evaluationError) {
      setError(toErrorMessage(evaluationError));
    } finally {
      setLabBusyAction(undefined);
    }
  }, [detail, labLeftRunId, labRightRunId, selectedModelKey]);

  const exportOpenTelemetryTrace = useCallback(
    async (runId?: string): Promise<void> => {
      if (!detail) return;
      setTraceExportBusy(true);
      setTraceVerificationReceipt(undefined);
      setError(undefined);
      try {
        const artifact = await exportOpenTelemetryTraceApi(
          detail.thread.id,
          runId,
        );
        downloadJson(
          artifact,
          `napier-otel-${runId ?? detail.thread.id}-${artifact.contentSha256.slice(0, 12)}.json`,
        );
        setTraceExportReceipt({
          scope: runId ? "run" : "thread",
          traceId: artifact.traceId,
          contentSha256: artifact.contentSha256,
          eventCount: artifact.eventRange.eventCount,
          spanCount: artifact.spanCount,
        });
        const refreshed = await getThread(detail.thread.id);
        setDetail(refreshed);
        setBootstrap((current) =>
          current ? { ...current, activeThread: refreshed } : current,
        );
      } catch (exportError) {
        setError(toErrorMessage(exportError));
      } finally {
        setTraceExportBusy(false);
      }
    },
    [detail],
  );

  const verifyOpenTelemetryTraceArtifactFile = useCallback(
    async (file: File): Promise<void> => {
      if (!detail) return;
      if (file.size > MAX_OTLP_TRACE_ARTIFACT_FILE_BYTES) {
        setError(copy.trace.otel.errors.artifactTooLarge);
        return;
      }
      setTraceVerifyBusy(true);
      setTraceVerificationReceipt(undefined);
      setError(undefined);
      try {
        const artifact = JSON.parse(
          await file.text(),
        ) as OpenTelemetryTraceArtifact;
        const verification = await verifyOpenTelemetryTraceArtifactApi(
          detail.thread.id,
          { artifact },
        );
        setTraceVerificationReceipt({
          status: verification.status,
          diagnostics: verification.diagnostics,
          ...(verification.traceId ? { traceId: verification.traceId } : {}),
          ...(verification.contentSha256
            ? { contentSha256: verification.contentSha256 }
            : {}),
          ...(verification.eventStreamSha256
            ? { eventStreamSha256: verification.eventStreamSha256 }
            : {}),
          eventCount: verification.eventCount,
          spanCount: verification.spanCount,
        });
      } catch (verifyError) {
        setError(
          verifyError instanceof SyntaxError
            ? copy.trace.otel.errors.artifactInvalid
            : toErrorMessage(verifyError),
        );
      } finally {
        setTraceVerifyBusy(false);
      }
    },
    [detail],
  );

  const exportRunReplay = useCallback(
    async (runId: string): Promise<void> => {
      if (!detail) return;
      setLabBusyAction(runId);
      setRunReplayVerificationReceipt(undefined);
      setError(undefined);
      try {
        const snapshot = await getRunReplay(detail.thread.id, runId);
        downloadJson(snapshot, `napier-${runId}-replay.json`);
      } catch (exportError) {
        setError(toErrorMessage(exportError));
      } finally {
        setLabBusyAction(undefined);
      }
    },
    [detail],
  );

  const verifyRunReplaySnapshotFile = useCallback(
    async (file: File): Promise<void> => {
      if (!detail) return;
      if (file.size > MAX_RUN_REPLAY_SNAPSHOT_FILE_BYTES) {
        setError(copy.lab.errors.replayTooLarge);
        return;
      }
      setLabBusyAction("run-replay-verify");
      setRunReplayVerificationReceipt(undefined);
      setError(undefined);
      try {
        const snapshot = JSON.parse(await file.text()) as RunReplaySnapshot;
        const runId = objectString(snapshot.run, "id");
        if (!runId) {
          setError(copy.lab.errors.replayInvalid);
          return;
        }
        const verification = await verifyRunReplaySnapshotApi(
          detail.thread.id,
          runId,
          { snapshot },
        );
        setRunReplayVerificationReceipt({
          status: verification.status,
          diagnostics: verification.diagnostics,
          ...(verification.runId ? { runId: verification.runId } : {}),
          ...(verification.contentSha256
            ? { contentSha256: verification.contentSha256 }
            : {}),
          ...(verification.eventStreamSha256
            ? { eventStreamSha256: verification.eventStreamSha256 }
            : {}),
          ...(verification.assistantTextSha256
            ? { assistantTextSha256: verification.assistantTextSha256 }
            : {}),
          eventCount: verification.eventCount,
          subagentCount: verification.subagentCount,
        });
      } catch (verifyError) {
        setError(
          verifyError instanceof SyntaxError
            ? copy.lab.errors.replayInvalid
            : toErrorMessage(verifyError),
        );
      } finally {
        setLabBusyAction(undefined);
      }
    },
    [detail],
  );

  const exportThreadFixture = useCallback(async (): Promise<void> => {
    if (!detail) return;
    setLabBusyAction("fixture-export");
    setError(undefined);
    try {
      const bundle = await getThreadReplayBundle(detail.thread.id);
      downloadJson(
        bundle,
        `napier-thread-${bundle.thread.id}-${bundle.contentSha256.slice(0, 12)}.json`,
      );
      setLabFixtureReceipt({
        action: "exported",
        contentSha256: bundle.contentSha256,
        eventCount: bundle.events.length,
      });
    } catch (exportError) {
      setError(toErrorMessage(exportError));
    } finally {
      setLabBusyAction(undefined);
    }
  }, [detail]);

  const importThreadFixture = useCallback(async (file: File): Promise<void> => {
    if (file.size > MAX_THREAD_REPLAY_FILE_BYTES) {
      setError(copy.lab.errors.fixtureTooLarge);
      return;
    }
    setLabBusyAction("fixture-import");
    setRunReplayVerificationReceipt(undefined);
    setTraceExportReceipt(undefined);
    setTraceVerificationReceipt(undefined);
    setError(undefined);
    try {
      const bundle = JSON.parse(await file.text()) as ThreadReplayBundle;
      const imported = await importThreadReplayBundle({ bundle });
      setDetail(imported);
      setSelectedThreadId(imported.thread.id);
      setSelectedModelKey(modelKey(imported.agent.model));
      setRunComparison(undefined);
      setInspectorTab("lab");
      setBootstrap((current) =>
        current
          ? {
              ...current,
              agents: [imported.agent, ...current.agents],
              threads: [imported.thread, ...current.threads],
              activeThread: imported,
            }
          : current,
      );
      setLabFixtureReceipt({
        action: "imported",
        contentSha256:
          imported.thread.importProvenance?.sourceContentSha256 ??
          bundle.contentSha256,
        eventCount: imported.events.length,
      });
    } catch (importError) {
      setError(
        importError instanceof SyntaxError
          ? copy.lab.errors.fixtureInvalid
          : toErrorMessage(importError),
      );
    } finally {
      setLabBusyAction(undefined);
    }
  }, []);

  const verifyThreadFixture = useCallback(async (file: File): Promise<void> => {
    if (file.size > MAX_THREAD_REPLAY_FILE_BYTES) {
      setError(copy.lab.errors.fixtureTooLarge);
      return;
    }
    setLabBusyAction("fixture-verify");
    setLabFixtureReceipt(undefined);
    setError(undefined);
    try {
      const bundle = JSON.parse(await file.text()) as ThreadReplayBundle;
      const verification = await verifyThreadReplayBundleApi({ bundle });
      setLabFixtureReceipt({
        action: "verified",
        status: verification.status,
        diagnostics: verification.diagnostics,
        ...(verification.contentSha256
          ? { contentSha256: verification.contentSha256 }
          : {}),
        ...(verification.eventStreamSha256
          ? { eventStreamSha256: verification.eventStreamSha256 }
          : {}),
        eventCount: verification.eventCount,
        runCount: verification.runCount,
        planCount: verification.planCount,
        evaluationCount: verification.evaluationCount,
      });
    } catch (verifyError) {
      setError(
        verifyError instanceof SyntaxError
          ? copy.lab.errors.fixtureInvalid
          : toErrorMessage(verifyError),
      );
    } finally {
      setLabBusyAction(undefined);
    }
  }, []);

  const commitAgentConfiguration = useCallback((agent: AgentProfile): void => {
    setDetail((current) => (current ? { ...current, agent } : current));
    setBootstrap((current) =>
      current
        ? {
            ...current,
            agents: current.agents.map((candidate) =>
              candidate.id === agent.id ? agent : candidate,
            ),
            ...(current.activeThread
              ? {
                  activeThread: {
                    ...current.activeThread,
                    agent,
                  },
                }
              : {}),
          }
        : current,
    );
  }, []);

  const commitConfigurationBootstrap = useCallback(
    (refreshed: BootstrapResponse): void => {
      setBootstrap(refreshed);
      setDetail(refreshed.activeThread);
    },
    [],
  );

  const refreshActiveThread = useCallback(async (): Promise<void> => {
    if (!detail) return;
    const refreshed = await getThread(detail.thread.id);
    setDetail(refreshed);
    setBootstrap((current) =>
      current
        ? {
            ...current,
            threads: upsertThread(current.threads, refreshed.thread),
            activeThread: refreshed,
          }
        : current,
    );
  }, [detail]);

  return {
    bootstrap,
    detail,
    selectedThreadId,
    inspectorTab,
    selectedModelKey,
    composer,
    goalDraft,
    memoryDraft,
    memoryCategory,
    memoryScope,
    memoryReviewIntervalDays,
    memorySupersedesId,
    memoryConsolidatesIds,
    extensionBusyId,
    extensionPackageReceipt,
    extensionPackageDeploymentPreview,
    extensionPackageRolloutPreview,
    extensionPackageUpdatePreview,
    labLeftRunId,
    labRightRunId,
    runComparison,
    runReplayVerificationReceipt,
    traceExportBusy,
    traceExportReceipt,
    traceVerifyBusy,
    traceVerificationReceipt,
    labBusyAction,
    labFixtureReceipt,
    streamingText,
    messages,
    visibleTrace,
    isLoading,
    isRunning,
    error,
    activeGoal: detail?.thread.goal as GoalState | undefined,
    resumableRun,
    terminalRuns,
    contextCheckpoint,
    contextCheckpointCalibration: detail?.contextCheckpointCalibration,
    setInspectorTab,
    setSelectedModelKey,
    setComposer,
    setGoalDraft,
    setMemoryDraft,
    setMemoryCategory,
    setMemoryScope,
    setMemoryReviewIntervalDays,
    toggleMemoryConsolidation,
    cancelMemoryConsolidation,
    selectThread,
    newThread,
    submit,
    resume,
    stop,
    saveGoal,
    removeGoal,
    branchFrom,
    saveMemory,
    startMemoryCorrection,
    cancelMemoryCorrection,
    reviewMemoryFact,
    proposeMcpExtension,
    reviewExtensionTrust,
    connectMcpExtension,
    disconnectMcpExtension,
    reviewExtensionTool,
    toggleExtension,
    createExtensionPublisher,
    revokeExtensionPublisher,
    downloadSignedExtensionPackage,
    verifySignedExtensionPackageFile,
    importSignedExtensionPackageFile,
    exportExtensionPackageLockfile,
    downloadExtensionPackageChannelIndex,
    publishExtensionPackageRolloutChannel,
    previewExtensionPackageRolloutChannel,
    previewExtensionPackageUpdateFile,
    applyExtensionPackageUpdate,
    cancelExtensionPackageUpdate,
    previewExtensionPackageDeploymentFiles,
    applyExtensionPackageDeployment,
    cancelExtensionPackageDeployment,
    selectLabLeftRun,
    selectLabRightRun,
    compareSelectedRuns,
    evaluateSelectedRuns,
    exportOpenTelemetryTrace,
    verifyOpenTelemetryTraceArtifactFile,
    exportRunReplay,
    verifyRunReplaySnapshotFile,
    exportThreadFixture,
    verifyThreadFixture,
    importThreadFixture,
    refreshActiveThread,
    commitAgentConfiguration,
    commitConfigurationBootstrap,
  };
}

function modelKey(model: { provider: string; id: string } | undefined): string {
  return model ? `${model.provider}/${model.id}` : "napier/demo";
}

function parseModelKey(value: string): { provider: string; id: string } {
  const separator = value.indexOf("/");
  if (separator < 1 || separator === value.length - 1)
    return { provider: "napier", id: "demo" };
  return {
    provider: value.slice(0, separator),
    id: value.slice(separator + 1),
  };
}

function downloadJson(value: unknown, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(value, null, 2)}\n`], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function messagePayload(event: RunEvent): TextMessagePayload | undefined {
  if (
    !event.payload ||
    Array.isArray(event.payload) ||
    typeof event.payload !== "object"
  )
    return undefined;
  const role = event.payload["role"];
  const text = event.payload["text"];
  if (
    (role !== "user" && role !== "assistant" && role !== "system") ||
    typeof text !== "string"
  )
    return undefined;
  return {
    role,
    text,
    ...(typeof event.payload["reasoning"] === "string"
      ? { reasoning: event.payload["reasoning"] }
      : {}),
    ...(typeof event.payload["model"] === "string"
      ? { model: event.payload["model"] }
      : {}),
  };
}

function objectString(value: unknown, key: string): string | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object")
    return undefined;
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === "string" ? entry : undefined;
}

function isExtensionPackageLockfile(
  value: unknown,
): value is ExtensionPackageLockfile {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const packages = record["packages"];
  return (
    record["kind"] === "napier.extension-package-lockfile" &&
    Array.isArray(packages) &&
    packages.length > 0 &&
    packages.every(
      (entry) =>
        Boolean(entry) &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        "envelope" in entry,
    )
  );
}

function isSignedExtensionPackageChannelIndexEnvelope(
  value: unknown,
): value is SignedExtensionPackageChannelIndexEnvelope {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const index = record["index"];
  const signature = record["signature"];
  return (
    record["kind"] === "napier.signed-extension-package-channel-index" &&
    Boolean(index) &&
    typeof index === "object" &&
    !Array.isArray(index) &&
    Array.isArray((index as Record<string, unknown>)["channels"]) &&
    Boolean(signature) &&
    typeof signature === "object" &&
    !Array.isArray(signature)
  );
}

function contextCheckpointPayload(
  value: unknown,
): ContextCheckpointSnapshot | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const payload = value as Record<string, unknown>;
  const decisions = payload["decisions"];
  const openLoops = payload["openLoops"];
  const artifacts = payload["artifacts"];
  if (
    payload["schemaVersion"] !== 1 ||
    typeof payload["checkpointId"] !== "string" ||
    typeof payload["fromSeq"] !== "number" ||
    typeof payload["toSeq"] !== "number" ||
    typeof payload["retainedFromSeq"] !== "number" ||
    typeof payload["sourceEventCount"] !== "number" ||
    typeof payload["sourceSha256"] !== "string" ||
    typeof payload["summarySha256"] !== "string" ||
    typeof payload["summary"] !== "string" ||
    !isStringArray(decisions) ||
    !isStringArray(openLoops) ||
    !isStringArray(artifacts)
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    checkpointId: payload["checkpointId"],
    ...(typeof payload["parentCheckpointId"] === "string"
      ? { parentCheckpointId: payload["parentCheckpointId"] }
      : {}),
    fromSeq: payload["fromSeq"],
    toSeq: payload["toSeq"],
    retainedFromSeq: payload["retainedFromSeq"],
    sourceEventCount: payload["sourceEventCount"],
    sourceSha256: payload["sourceSha256"],
    summarySha256: payload["summarySha256"],
    summary: payload["summary"],
    decisions,
    openLoops,
    artifacts,
  };
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function upsertThread(
  threads: ThreadSummary[],
  thread: ThreadSummary,
): ThreadSummary[] {
  return [thread, ...threads.filter((item) => item.id !== thread.id)].sort(
    (left, right) => right.updatedAt.localeCompare(left.updatedAt),
  );
}

function upsertMemory(
  memories: BootstrapResponse["memories"],
  fact: BootstrapResponse["memories"][number],
): BootstrapResponse["memories"] {
  return [fact, ...memories.filter((memory) => memory.id !== fact.id)];
}

function upsertExtension(
  extensions: ExtensionRecord[],
  extension: ExtensionRecord,
): ExtensionRecord[] {
  return [
    extension,
    ...extensions.filter((candidate) => candidate.id !== extension.id),
  ];
}

function toErrorMessage(error: unknown): string {
  return formatApiErrorMessage(error);
}
