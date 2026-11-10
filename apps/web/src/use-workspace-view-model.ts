import { useThreadSubmission, useThreadRecovery } from "./use-thread-submission";
import { useThreadDecisionActions } from "./use-thread-decision-actions";
import { useActiveRunStream } from "./use-active-run-stream";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AgentProfile,
  BootstrapResponse,
  ContextCheckpointSnapshot,
  CreateMcpExtensionRequest,
  ExtensionRecord,
  GoalState,
  MemoryCategory,
  MemoryFact,
  MemoryScope,
  McpToolEffect,
  OpenTelemetryTraceArtifact,
  ReviewExtensionRequest,
  ReviewMemoryRequest,
  RunComparison,
  RunReplaySnapshot,
  StreamFrame,
  ThreadReplayBundle,
} from "@napier/contracts";
import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import {
  clearGoal,
  compareThreadRuns,
  connectExtension,
  createBranch,
  createExtensionPublisherTrustAnchor as createExtensionPublisherTrustAnchorApi,
  createMcpExtension,
  createRunEvaluation,
  disconnectExtension,
  exportOpenTelemetryTrace as exportOpenTelemetryTraceApi,
  getRunReplay,
  getThreadReplayBundle,
  getThread,
  importThreadReplayBundle,
  proposeMemory,
  reviewMemory,
  reviewExtension,
  reviewMcpTool,
  revokeExtensionPublisherTrustAnchor as revokeExtensionPublisherTrustAnchorApi,
  setExtensionEnabled,
  setGoal,
  stopRun,
  verifyOpenTelemetryTraceArtifact as verifyOpenTelemetryTraceArtifactApi,
  verifyRunReplaySnapshot as verifyRunReplaySnapshotApi,
  verifyThreadReplayBundle as verifyThreadReplayBundleApi,
  type WebThreadDetail,
} from "./api";
import { getBootstrap, getBootstrapRestoringWorkspace, navigateWorkspaceRoot } from "./bootstrap-api";
import { contextCheckpointPayload } from "./context-checkpoint-payload";
import { copy } from "./copy";
import type { ExtensionPublisherDraft } from "./extension-package-types";
import { formatApiErrorMessage } from "./api-error";
import { openBrowserInteractionConfirmation } from "./browser-interaction-confirmation-view";
import { latestManuallyResumableRun } from "./manual-run-recovery";
import { selectedModelAvailability } from "./model-selection-view-model";
import { openTelemetryTraceArtifactFilename } from "./otel-trace-export-view";
import {
  runReplaySnapshotFilename,
  threadReplayBundleFilename,
} from "./run-replay-view-model";
import {
  applyThreadRunEvent,
  applyThreadStreamFrameToBootstrap,
  applyThreadStreamFrameToDetail,
  activateThreadDetail,
  attachThreadRun,
  detachThreadRun,
  mergeBackgroundBootstrap,
  mergeBackgroundThreadDetail,
  mergeNavigationBootstrap,
  resolveCachedThreadDetail,
  threadRunViewState,
  type ThreadRunSessions,
} from "./thread-run-stream-state";
import { messagePayload } from "./message-payload";
import { commitThreadLocation, threadIdFromLocation } from "./thread-location";
import { useNextRunOptions } from "./use-next-run-options";
import {
  useMemoryProvenanceDraft,
} from "./thread-detail-view-state";
import { useRecoveredActiveRun } from "./use-active-run-state";
import { useThreadNavigation } from "./use-thread-navigation";
import { useSubagentHubActions } from "./use-subagent-hub-actions";
import { useExtensionPackageActions } from "./use-extension-package-actions";
import {
  summarizeThreadReplayBundleCoverage,
  type FixtureTransferReceipt,
  type OpenTelemetryTraceReceipt,
  type OpenTelemetryTraceVerificationReceipt,
  type RunReplayVerificationReceipt,
} from "./run-lab-receipts";
export {
  importProvenanceReceiptView,
  summarizeThreadReplayBundleCoverage,
} from "./run-lab-receipts";
export type {
  FixtureTransferReceipt,
  OpenTelemetryTraceReceipt,
  OpenTelemetryTraceVerificationReceipt,
  RunReplayVerificationReceipt,
} from "./run-lab-receipts";
export type InspectorTab =
  | "browser"
  | "trace"
  | "processes"
  | "files"
  | "lab"
  | "plan"
  | "studio"
  | "goal"
  | "memory"
  | "extensions"
  | "automations"
  | "context";

const SHA256 = /^[a-f0-9]{64}$/;

function eventAnchorSetSha256FromArtifact(
  artifact: OpenTelemetryTraceArtifact,
): string | undefined {
  const root = artifact.otlp.resourceSpans[0]?.scopeSpans[0]?.spans.find(
    (span) => span.parentSpanId === undefined,
  );
  const value = root?.attributes.find(
    (attribute) => attribute.key === "napier.event_anchor_set.sha256",
  )?.value;
  return value && "stringValue" in value && SHA256.test(value.stringValue)
    ? value.stringValue
    : undefined;
}

export interface MessageView {
  id: string;
  seq: number;
  role: "user" | "assistant" | "system";
  text: string;
  model: string;
  createdAt: string;
}

const MAX_THREAD_REPLAY_FILE_BYTES = 10 * 1024 * 1024;
const MAX_RUN_REPLAY_SNAPSHOT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_OTLP_TRACE_ARTIFACT_FILE_BYTES = 10 * 1024 * 1024;
export function useWorkspaceViewModel() {
  const [bootstrap, setBootstrap] = useState<LiveReadyBootstrapResponse>();
  const [detail, setDetail] = useState<WebThreadDetail>();
  const [selectedThreadId, setSelectedThreadId] = useState<string>();
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("plan");
  const [selectedModelKey, setSelectedModelKey] = useState("napier/demo");
  const {
    preset: nextRunCapabilityPreset,
    setPreset: setNextRunCapabilityPreset,
    harnessPolicy: nextRunHarnessPolicy,
    composerDraft,
  } = useNextRunOptions(
    selectedThreadId,
    bootstrap ? JSON.stringify([bootstrap.workspace.root, bootstrap.workspace.dataRoot]) : undefined,
  );
  const [threadRunSessions, setThreadRunSessions] = useState<ThreadRunSessions>(
    {},
  );
  const [goalDraft, setGoalDraft] = useState("");
  const [memoryDraft, setMemoryDraft, memoryProvenance] =
    useMemoryProvenanceDraft(proposeMemory);
  const [memoryCategory, setMemoryCategory] =
    useState<MemoryCategory>("context");
  const [memoryScope, setMemoryScope] = useState<MemoryScope>("workspace");
  const [memoryReviewIntervalDays, setMemoryReviewIntervalDays] = useState(90);
  const [memorySupersedesId, setMemorySupersedesId] = useState<string>();
  const [memoryConsolidatesIds, setMemoryConsolidatesIds] = useState<string[]>(
    [],
  );
  const [extensionBusyId, setExtensionBusyId] = useState<string>();
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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();
  const selectedThreadIdRef = useRef<string | undefined>(undefined);
  const threadDetailCacheRef = useRef(new Map<string, WebThreadDetail>());
  const activeRunStream = useActiveRunStream();
  selectedThreadIdRef.current = selectedThreadId;


  const { activeRunId, isRunning, streamingText } = useMemo(
    () => threadRunViewState(detail, threadRunSessions),
    [detail, threadRunSessions],
  );

  useRecoveredActiveRun(
    detail,
    detail ? threadRunSessions[detail.thread.id] !== undefined : false,
    selectedThreadIdRef,
    setDetail,
    setBootstrap,
  );
  const loadBootstrap = useCallback(async (threadId?: string) => {
    setIsLoading(true);
    setError(undefined);
    try {
      const result = await getBootstrapRestoringWorkspace(threadId);
      if (result.activeThread) {
        threadDetailCacheRef.current.set(
          result.activeThread.thread.id,
          result.activeThread,
        );
      }
      setBootstrap(result);
      setDetail(result.activeThread);
      commitThreadLocation(setSelectedThreadId, result.activeThread?.thread.id);
      setSelectedModelKey(modelKey(result.recommendedRunModel));
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBootstrap(threadIdFromLocation());
  }, [loadBootstrap]);
  const messages = useMemo<MessageView[]>(() => {
    if (detail?.messages) return detail.messages;
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
          model: payload.model ?? "",
          createdAt: event.createdAt,
        },
      ];
    });
  }, [detail?.events, detail?.messages]);

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
      detail
        ? latestManuallyResumableRun(detail.thread.status, detail.runs)
        : undefined,
    [detail],
  );
  const openOperatorDecision = useMemo(
    () =>
      detail?.operatorDecisions.findLast(
        (decision) =>
          decision.status === "pending" || decision.status === "answered",
      ),
    [detail?.operatorDecisions],
  );
  const openOperatorDecisionWorkflowOwned = useMemo(
    () =>
      openOperatorDecision !== undefined &&
      detail?.runs.find((run) => run.id === openOperatorDecision.runId)
        ?.source === "workflow",
    [detail?.runs, openOperatorDecision],
  );
  const terminalRuns = useMemo(
    () =>
      (detail?.runs ?? []).filter(
        (run) => run.status !== "queued" && run.status !== "running",
      ),
    [detail?.runs],
  );
  const selectedModel = useMemo(
    () => selectedModelAvailability(bootstrap?.models ?? [], selectedModelKey),
    [bootstrap?.models, selectedModelKey],
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
  const resetThreadReceipts = useCallback(
    () =>
      [
        setLabFixtureReceipt,
        setRunReplayVerificationReceipt,
        setTraceExportReceipt,
        setTraceVerificationReceipt,
      ].forEach((reset) => reset(undefined)),
    [],
  );
  const switchWorkspaceRoot = useCallback(
    async (root: string, threadId?: string): Promise<void> => {
      setError(undefined);
      try {
        await navigateWorkspaceRoot(root, threadId);
      } catch (cause) {
        setError(toErrorMessage(cause));
        throw cause;
      }
    },
    [],
  );
  const resolveThreadDetail = useCallback(
    (candidate: WebThreadDetail | undefined) =>
      resolveCachedThreadDetail(threadDetailCacheRef.current, candidate),
    [],
  );
  const cachedThreadDetail = useCallback(
    (threadId: string) => threadDetailCacheRef.current.get(threadId),
    [],
  );
  const setNavigationBootstrap = useCallback(
    (value: LiveReadyBootstrapResponse) =>
      setBootstrap((current) => mergeNavigationBootstrap(current, value)),
    [],
  );
  const threadNavigation = useThreadNavigation({
    bootstrap,
    detail,
    selectedThreadId,
    setBootstrap: setNavigationBootstrap,
    setDetail,
    setSelectedThreadId,
    setSelectedModelKey,
    modelKey,
    resetReceipts: resetThreadReceipts,
    cachedDetail: cachedThreadDetail,
    resolveDetail: resolveThreadDetail,
    setError,
  });
  const handleStreamFrame = useCallback(
    (sourceThreadId: string, frame: StreamFrame): void => {
      if (frame.type === "event") {
        setThreadRunSessions((current) =>
          applyThreadRunEvent(current, sourceThreadId, frame.event),
        );
      }
      const cached = applyThreadStreamFrameToDetail(
        threadDetailCacheRef.current.get(sourceThreadId),
        sourceThreadId,
        frame,
      );
      if (cached) threadDetailCacheRef.current.set(sourceThreadId, cached);
      if (selectedThreadIdRef.current === sourceThreadId && cached) {
        setDetail(cached);
      }
      setBootstrap((current) =>
        applyThreadStreamFrameToBootstrap(current, sourceThreadId, frame),
      );
      if (
        frame.type === "error" &&
        selectedThreadIdRef.current === sourceThreadId
      ) {
        setError(
          `${frame.message} (${frame.code} · ${frame.diagnosticSha256.slice(0, 12)})`,
        );
      }
    },
    [],
  );
  const streamFrameHandler = useCallback(
    (threadId: string) => (frame: StreamFrame) =>
      handleStreamFrame(threadId, frame),
    [handleStreamFrame],
  );
  const setRunError = useCallback((threadId: string, error: unknown): void => {
    if (selectedThreadIdRef.current === threadId) {
      setError(toErrorMessage(error));
    }
  }, []);
  const refreshBootstrap = useCallback(
    async (threadId: string) => {
      const response = await getThread(threadId);
      const refreshed = resolveThreadDetail(response) ?? response;
      threadDetailCacheRef.current.set(threadId, refreshed);
      setBootstrap((current) =>
        mergeBackgroundThreadDetail(current, refreshed),
      );
      if (selectedThreadIdRef.current === threadId) {
        setDetail(refreshed);
      }
    },
    [resolveThreadDetail],
  );

  const commitRefreshedThreadDetail = useCallback(
    (threadId: string, refreshed: WebThreadDetail): void => {
      threadDetailCacheRef.current.set(threadId, refreshed);
      setBootstrap((current) =>
        mergeBackgroundThreadDetail(current, refreshed),
      );
      if (selectedThreadIdRef.current === threadId) setDetail(refreshed);
    },
    [],
  );

  const subagentHubActions = useSubagentHubActions({
    detail,
    detailCache: threadDetailCacheRef,
    selectedThreadId: selectedThreadIdRef,
    setBootstrap,
    setDetail,
    errorMessage: toErrorMessage,
  });

  const refreshActiveThread = useCallback(async (): Promise<void> => {
    if (!detail) return;
    const threadId = detail.thread.id;
    commitRefreshedThreadDetail(threadId, await getThread(threadId));
  }, [commitRefreshedThreadDetail, detail]);

  const startRunUi = useCallback(
    (threadId: string, source: WebThreadDetail) => {
      threadDetailCacheRef.current.set(threadId, source);
      setThreadRunSessions((current) => attachThreadRun(current, threadId));
      if (selectedThreadIdRef.current === threadId) {
        setRunReplayVerificationReceipt(undefined);
        setTraceExportReceipt(undefined);
        setTraceVerificationReceipt(undefined);
        setError(undefined);
      }
    },
    [],
  );

  const finishRunUi = useCallback(
    (threadId: string) =>
      setThreadRunSessions((current) => detachThreadRun(current, threadId)),
    [],
  );

  const pendingBrowserInteraction = useMemo(
    () => openBrowserInteractionConfirmation(detail?.events ?? []),
    [detail?.events],
  );
  const { submit, controlOutbox } = useThreadSubmission({
    workspaceKey: bootstrap ? JSON.stringify([bootstrap.workspace.root, bootstrap.workspace.dataRoot]) : undefined,
    threadId: selectedThreadId,
    detail,
    composer: composerDraft,
    activeRunId,
    isRunning,
    blocked: Boolean(openOperatorDecision || pendingBrowserInteraction),
    modelConfigured: selectedModel.configured,
    modelUnavailableHint: copy.modelUnavailableHint,
    model: parseModelKey(selectedModelKey),
    capabilityPreset: nextRunCapabilityPreset,
    harnessPolicyPreset: nextRunHarnessPolicy.preset,
    execute: activeRunStream.wrapExecute(nextRunHarnessPolicy.execute),
    onStart: startRunUi,
    onFinish: finishRunUi,
    onRefresh: refreshBootstrap,
    onError: setRunError,
    onFrame: streamFrameHandler,
    setError,
  });

  const resume = useThreadRecovery({
    detail, run: resumableRun, running: isRunning,
    modelConfigured: selectedModel.configured,
    model: parseModelKey(selectedModelKey),
    onStart: startRunUi, onFinish: finishRunUi,
    onRefresh: refreshBootstrap, onError: setRunError,
    onFrame: streamFrameHandler,
    onUnavailable: () => setError(copy.modelUnavailableHint),
    ...activeRunStream.streamSignalBindings,
  });

  const stop = useCallback(async () => {
    if (!detail) return;
    const threadId = detail.thread.id;
    activeRunStream.abort();
    try {
      await stopRun(threadId);
      await refreshBootstrap(threadId);
    } catch (stopError) {
      setError(toErrorMessage(stopError));
    }
  }, [activeRunStream, detail, refreshBootstrap]);

  const operatorDecisionActions = useThreadDecisionActions({
    loadThread: getThread,
    setError,
    workspaceKey: bootstrap ? JSON.stringify([bootstrap.workspace.root, bootstrap.workspace.dataRoot]) : undefined,
    detail,
    decision: openOperatorDecision,
    isRunning,
    onStart: startRunUi,
    onFinish: finishRunUi,
    onFrame: streamFrameHandler,
    onCommit: commitRefreshedThreadDetail,
    onRunError: setRunError,
    ...activeRunStream.streamSignalBindings,
  });

  const saveGoal = useCallback(async () => {
    if (!detail || !goalDraft.trim()) return;
    const threadId = detail.thread.id;
    try {
      const updated = await setGoal(threadId, {
        objective: goalDraft.trim(),
      });
      commitRefreshedThreadDetail(threadId, updated);
      setGoalDraft("");
      setInspectorTab("goal");
    } catch (goalError) {
      setError(toErrorMessage(goalError));
    }
  }, [commitRefreshedThreadDetail, detail, goalDraft]);

  const removeGoal = useCallback(async () => {
    if (!detail) return;
    const threadId = detail.thread.id;
    try {
      commitRefreshedThreadDetail(threadId, await clearGoal(threadId));
    } catch (goalError) {
      setError(toErrorMessage(goalError));
    }
  }, [commitRefreshedThreadDetail, detail]);

  const branchFrom = useCallback(
    async (seq: number) => {
      if (!bootstrap || !detail) return;
      try {
        const response = await createBranch(detail.thread.id, { fromSeq: seq });
        const branch = resolveThreadDetail(response) ?? response;
        threadDetailCacheRef.current.set(branch.thread.id, branch);
        setNavigationBootstrap(activateThreadDetail(bootstrap, branch));
        setDetail(branch);
        commitThreadLocation(setSelectedThreadId, branch.thread.id);
        setSelectedModelKey(modelKey(bootstrap.recommendedRunModel));
      } catch (branchError) {
        setError(toErrorMessage(branchError));
      }
    },
    [bootstrap, detail, resolveThreadDetail, setNavigationBootstrap],
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
      const fact = await memoryProvenance.propose({
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
      commitRefreshedThreadDetail(
        detail.thread.id,
        await getThread(detail.thread.id),
      );
      setInspectorTab("memory");
    } catch (memoryError) {
      setError(toErrorMessage(memoryError));
    }
  }, [
    bootstrap?.memories,
    commitRefreshedThreadDetail,
    detail,
    memoryCategory,
    memoryConsolidatesIds,
    memoryDraft,
    memoryProvenance,
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
        if (refreshed.activeThread) {
          commitRefreshedThreadDetail(detail.thread.id, refreshed.activeThread);
        }
      } catch (memoryError) {
        setError(toErrorMessage(memoryError));
      }
    },
    [commitRefreshedThreadDetail, detail],
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
      if (detail) {
        commitRefreshedThreadDetail(
          detail.thread.id,
          await getThread(detail.thread.id),
        );
      }
    },
    [commitRefreshedThreadDetail, detail],
  );

  const refreshExtensionWorkspace = useCallback(async (): Promise<void> => {
    if (!detail) return;
    const refreshed = await getBootstrap(detail.thread.id);
    if (refreshed.activeThread) {
      commitRefreshedThreadDetail(detail.thread.id, refreshed.activeThread);
    }
  }, [commitRefreshedThreadDetail, detail]);

  const {
    clearExtensionPackagePreviews,
    ...extensionPackageActions
  } = useExtensionPackageActions({
    detail,
    bootstrap,
    setError,
    setExtensionBusyId,
    commitExtension,
    commitRefreshedThreadDetail,
    refreshExtensionWorkspace,
  });

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
        clearExtensionPackagePreviews();
        await refreshExtensionWorkspace();
      } catch (publisherError) {
        setError(toErrorMessage(publisherError));
        throw publisherError;
      } finally {
        setExtensionBusyId(undefined);
      }
    },
    [clearExtensionPackagePreviews, detail, refreshExtensionWorkspace],
  );

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
    if (!selectedModel.configured) {
      setError(copy.modelUnavailableHint);
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
      commitRefreshedThreadDetail(detail.thread.id, refreshed);
      setInspectorTab("lab");
    } catch (evaluationError) {
      setError(toErrorMessage(evaluationError));
    } finally {
      setLabBusyAction(undefined);
    }
  }, [
    commitRefreshedThreadDetail,
    detail,
    labLeftRunId,
    labRightRunId,
    selectedModel.configured,
    selectedModelKey,
  ]);

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
        downloadJson(artifact, openTelemetryTraceArtifactFilename(artifact));
        const eventAnchorSetSha256 = eventAnchorSetSha256FromArtifact(artifact);
        setTraceExportReceipt({
          scope: runId ? "run" : "thread",
          traceId: artifact.traceId,
          contentSha256: artifact.contentSha256,
          ...(eventAnchorSetSha256 ? { eventAnchorSetSha256 } : {}),
          eventCount: artifact.eventRange.eventCount,
          spanCount: artifact.spanCount,
        });
        const refreshed = await getThread(detail.thread.id);
        commitRefreshedThreadDetail(detail.thread.id, refreshed);
      } catch (exportError) {
        setError(toErrorMessage(exportError));
      } finally {
        setTraceExportBusy(false);
      }
    },
    [commitRefreshedThreadDetail, detail],
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
          ...(verification.eventAnchorSetSha256
            ? { eventAnchorSetSha256: verification.eventAnchorSetSha256 }
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
        downloadJson(snapshot, runReplaySnapshotFilename(snapshot));
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
          modelContextEnvelopeCount: verification.modelContextEnvelopeCount,
          embeddedModelContextEnvelopeCount:
            verification.embeddedModelContextEnvelopeCount,
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
      const coverage = summarizeThreadReplayBundleCoverage(bundle);
      downloadJson(bundle, threadReplayBundleFilename(bundle));
      setLabFixtureReceipt({
        action: "exported",
        contentSha256: bundle.contentSha256,
        ...coverage,
      });
    } catch (exportError) {
      setError(toErrorMessage(exportError));
    } finally {
      setLabBusyAction(undefined);
    }
  }, [detail]);

  const importThreadFixture = useCallback(async (file: File): Promise<void> => {
    if (!bootstrap) return;
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
      const sourceCoverage = summarizeThreadReplayBundleCoverage(bundle);
      const response = await importThreadReplayBundle({ bundle });
      const imported = resolveThreadDetail(response) ?? response;
      const provenance = imported.thread.importProvenance;
      threadDetailCacheRef.current.set(imported.thread.id, imported);
      setNavigationBootstrap(activateThreadDetail(bootstrap, imported));
      setDetail(imported);
      commitThreadLocation(setSelectedThreadId, imported.thread.id);
      setSelectedModelKey(modelKey(bootstrap.recommendedRunModel));
      setRunComparison(undefined);
      setInspectorTab("lab");
      setLabFixtureReceipt({
        action: "imported",
        contentSha256: provenance?.sourceContentSha256 ?? bundle.contentSha256,
        ...sourceCoverage,
        eventCount: provenance?.sourceEventCount ?? sourceCoverage.eventCount,
        modelContextEnvelopeCount:
          provenance?.sourceModelContextEnvelopeCount ??
          sourceCoverage.modelContextEnvelopeCount,
        embeddedModelContextEnvelopeCount:
          provenance?.sourceEmbeddedModelContextEnvelopeCount ??
          sourceCoverage.embeddedModelContextEnvelopeCount,
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
  }, [bootstrap, resolveThreadDetail, setNavigationBootstrap]);

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
        modelContextEnvelopeCount: verification.modelContextEnvelopeCount,
        embeddedModelContextEnvelopeCount:
          verification.embeddedModelContextEnvelopeCount,
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
    (refreshed: LiveReadyBootstrapResponse): void => {
      setBootstrap((current) => mergeBackgroundBootstrap(current, refreshed));
      if (selectedThreadIdRef.current === refreshed.activeThread?.thread.id)
        setDetail(refreshed.activeThread);
      setSelectedModelKey((current) =>
        current === "napier/demo"
          ? modelKey(refreshed.recommendedRunModel)
          : current,
      );
    },
    [],
  );

  return {
    bootstrap,
    detail,
    selectedThreadId,
    inspectorTab,
    selectedModelKey,
    selectedModel,
    ...composerDraft,
    controlOutbox,
    nextRunCapabilityPreset,
    nextRunHarnessPolicy,
    activeRunId,
    goalDraft,
    memoryDraft,
    ...memoryProvenance,
    memoryCategory,
    memoryScope,
    memoryReviewIntervalDays,
    memorySupersedesId,
    memoryConsolidatesIds,
    extensionBusyId,
    ...extensionPackageActions,
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
    ...operatorDecisionActions,
    ...subagentHubActions,
    ...threadNavigation,
    streamingText,
    messages,
    visibleTrace,
    isLoading,
    isRunning,
    error,
    activeGoal: detail?.thread.goal as GoalState | undefined,
    openOperatorDecision,
    openOperatorDecisionWorkflowOwned,
    resumableRun,
    terminalRuns,
    contextCheckpoint,
    contextCheckpointCalibration: detail?.contextCheckpointCalibration,
    setInspectorTab,
    setSelectedModelKey,
    setNextRunCapabilityPreset,
    setGoalDraft,
    setMemoryDraft,
    setMemoryCategory,
    setMemoryScope,
    setMemoryReviewIntervalDays,
    toggleMemoryConsolidation,
    cancelMemoryConsolidation,
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
    switchWorkspaceRoot,
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

function objectString(value: unknown, key: string): string | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object")
    return undefined;
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === "string" ? entry : undefined;
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
