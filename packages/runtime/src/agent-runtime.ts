import {
  runAgentLoop,
  type AgentEvent,
  type AgentMessage,
  type Skill,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import {
  type Api,
  type AssistantMessage,
  contentText,
  type Model,
  type SimpleStreamOptions,
  type ThinkingLevel,
  type UserMessage,
} from "@earendil-works/pi-ai";
import {
  type AgentProfile,
  type ContextCheckpointSnapshot,
  type GoalEvaluation,
  type GoalState,
  type ModelContextEnvelopeReceipt,
  type ModelRef,
  type RunEvent,
  type RunInvocationSource,
  type RunControlMessageMode,
  type RunRecord,
  type Usage,
  type UsageAccounting,
} from "@napier/contracts";
import {
  manualRunRecoveryBlockReason,
  manualRunRecoverySettlementMatches,
} from "@napier/contracts/manual-run-recovery";

import {
  buildContextCompactionMessages,
  contextMessageEvents,
  createContextCheckpoint,
  formatContextCheckpoint,
  latestValidContextCheckpoint,
  parseContextCompactionResponse,
  planContextProjection,
} from "./compaction.js";
import { captureConversationSurfaceTurn } from "./conversation-surface-capture.js";
import { ConversationSurfaceCapsuleStore } from "./conversation-surface-capsule-store.js";
import { ContextEventReadModel } from "./context-event-read-model.js";
import { projectConversationSurface } from "./conversation-surface.js";
import { createDelegationLedgerProjection } from "./delegation-ledger.js";
import type { EventSink } from "./event-sink.js";
import {
  effectiveRunProfile,
  modernRunConfiguration,
  runExecutionBoundary,
} from "./effective-run-profile.js";
import { createEnvironmentCapabilityNegotiationEvents } from "./environment-capability-negotiation.js";
import {
  agentToolGenericDetailsLedgerProjection,
  agentToolCallArgumentsLedgerProjection as toolCallArgumentsLedgerProjection,
  agentToolInputLedgerProjection as toolInputLedgerProjection,
  agentToolOutputLedgerProjection as toolOutputLedgerProjection,
} from "./agent-tool-ledger.js";
import {
  AgentCapabilityRuntime,
  type AgentNetworkCapabilities,
} from "./agent-capability-runtime.js";
import { compileAuxiliaryPrompt } from "./agent-prompt-layers.js";
import { resolveOperatorDecisionCapabilityContinuation } from "./agent-capability-override.js";
import { createAgentRunStartedPayload } from "./agent-run-started-event.js";
import {
  controlMessageEventKey,
  delay,
  formatPlanToolGuidance,
  OperatorDecisionPendingError,
  sha256Text,
  splitForStreaming,
  summarize,
  toJsonValue,
} from "./agent-runtime-utils.js";
import { resolveAgentRunModel } from "./agent-run-model.js";
import { validateAgentRunPrompt } from "./agent-run-prompt-preflight.js";
import { createAgentRunModelRoute } from "./agent-run-model-route.js";
import { executeAgentRunCompletionLifecycle } from "./agent-run-completion-lifecycle.js";
import {
  finishSuccessfulAgentRun,
  recordAgentRunRecoveryStarted,
} from "./agent-run-lifecycle-events.js";
import {
  extractAssistantReasoning,
  mapModelUsage,
  modelRefFromModel,
  providerMessages,
} from "./agent-model-projection.js";
import { contextHistoryCharacterBudget } from "./model-context-token-meter.js";
import { builtInToolHarnessProjection } from "./agent-tool-effects.js";
import {
  AgentToolResultLifecycle,
  toolLife,
} from "./agent-tool-result-lifecycle.js";
import { agentToolResultText } from "./agent-tool-result-text.js";
import { createAgentToolResultFinalizer } from "./agent-tool-result-boundary.js";
import { createAgentToolPreflight } from "./agent-tool-preflight.js";
import { createCapabilityCatalogTool } from "./capability-catalog.js";
import { ToolProtocolRegistry } from "./tool-protocol-registry.js";
import { createGovernedCodeBridgeBinding } from "./governed-code-bridge.js";
import { PrivateSourceModelContentBoundary } from "./private-source-model-content.js";
import { BrowserInteractionConfirmationManager } from "./browser-interaction-confirmations.js";
import { BrowserLiveViewService } from "./browser-live-view.js";
import type { BrowserSessionPort } from "./browser-session-port.js";
import { BrowserSessionControlService } from "./browser-session-control.js";
import { BrowserSessionPauseManager } from "./browser-session-pause.js";
import type { BrowserSourceCaptureProvider } from "./research-sources.js";
export { buildRunRecoveryPrompt } from "./run-recovery-prompt.js";
import { buildRunRecoveryPrompt } from "./run-recovery-prompt.js";
import type { WorkspaceFileMutationManager } from "./workspace-file-mutations.js";
import type { WorkspaceProcessManager } from "./workspace-processes.js";
import { formatWorkspaceToolGuidance } from "./workspace-tool-guidance.js";
import {
  isWorkflowRunSource,
  WORKFLOW_NODE_EXECUTION,
} from "./workflow-node-execution.js";
import { AGENT_MESSAGE_EXPERIMENT_EXECUTION } from "./agent-message-experiment-execution.js";
import {
  AGENT_MESSAGE_TOOL_RESULT_REPLAY,
  type FrozenToolResultReplayController,
  validateAgentMessageToolResultReplay,
} from "./agent-message-tool-result-replay.js";
import { createAgentRunControlTools } from "./agent-run-control-tools.js";
import { createAgentMilestoneContextProjection } from "./agent-milestones.js";
import {
  applyGoalEvaluation,
  beginGoalContinuation,
  buildGoalContinuationPrompt,
  buildGoalEvaluatorMessages,
  parseGoalEvaluationResponse,
  shouldContinueGoal,
} from "./goals.js";
import {
  DEFAULT_RUN_LIMITS,
  effectiveModelAdvisorPolicy,
  effectiveToolLoopGuardPolicy,
} from "./agents.js";
import {
  buildMemoryExtractorMessages,
  formatMemoryContext,
  memoryReplacementTargetIds,
  parseMemoryProposalResponse,
} from "./memory.js";
import {
  buildThreadTitleMessages,
  deriveThreadTitleFromPrompt,
  isDefaultThreadTitle,
  parseThreadTitleResponse,
} from "./thread-title.js";
import { modelAdapterReceipt } from "./model-adapters.js";
import { ModelDeltaBatcher } from "./model-delta-batcher.js";
import { AgentModelCallPipelineHost } from "./agent-model-call-pipeline-host.js";
import { AgentLifecyclePipelineAttachmentHost } from "./agent-lifecycle-pipeline-host.js";
import {
  createLifecycleAgentStepStream,
  createRuntimeCompiledPromptBuilder,
  wrapAgentToolsWithLifecycle,
} from "./agent-runtime-step-lifecycle.js";
import { AgentTurnPipelineHost } from "./agent-turn-pipeline-host.js";
import { modelFailureError } from "./model-turn-deadline.js";
import { ModelInvocationCapsuleStore } from "./model-invocation-capsule-store.js";
import { captureCompiledModelInvocation } from "./model-invocation-capture.js";
import { McpExtensionManager } from "./mcp.js";
import {
  CombinedModelAdvisorBlockedError,
  createCombinedModelAdvisorBlock,
  createModelAdvisorCorrectionOutcome,
  createModelAdvisorCorrectionRequestFromBlock,
  createModelAdvisorNotice,
  isModelAdvisorBlocked,
  ModelAdvisorBlockedError,
  type ModelAdvisorCorrectionRequest,
} from "./model-advisor.js";
import {
  INDEPENDENT_MODEL_ADVISOR_REVIEWED_EVENT,
  reviewIndependentModelAdvisorCandidate,
} from "./independent-model-advisor.js";
import { ModelRegistry } from "./models.js";
import { ModelRouter, type ModelRouteSession } from "./model-route.js";
import { createId, createProcessLeaseOwnerId } from "./ids.js";
import {
  authorizeInternalResearchRecoveryIf,
  resolvePromptCapabilityProfile,
} from "./internal-research-recovery-authorization.js";
import {
  formatImportedLedgerBoundary,
  localImportedThroughSeq,
} from "./import-boundary-format.js";
import {
  prepareAutomaticSkillRecoveryOptions,
  prepareManualSkillRecoveryOptions,
} from "./research-recovery-options.js";
import { formatOperatorDecisionContinuation } from "./operator-decisions.js";
import {
  PROMPT_VARIABLES_RESOLVED_EVENT,
  resolvePromptVariables,
} from "./prompt-variables.js";
import { RunBudgetTracker } from "./run-budget.js";
import { finLife } from "./run-finalization-reserve.js";
import { classifyFailure } from "./run-failure-classification.js";
import { settleRunFailure } from "./run-failure-settlement.js";
import { progLife } from "./run-progress-vector.js";
import {
  createPlatformSandboxAdapter,
  type OsSandboxAdapter,
} from "./sandbox.js";
import { negotiateEnvironmentExecution } from "./process-run-readiness.js";
import { formatSkillCatalog } from "./skills.js";
import { SKILL_CONTINUATION_SNAPSHOT } from "./skill-load-replay.js";
import {
  assertRunConfigurationSkillContext,
  resolveAgentRunSkillContext,
} from "./skill-run-context.js";
import { recordActiveSkillLifecycles } from "./skill-lifecycle-projection.js";
import type { SkillSnapshot } from "./standard-skill-snapshot.js";
import { LocalStore } from "./store.js";
import { SubagentCoordinator } from "./subagents.js";
import type { SubagentHubControlService } from "./subagent-hub-control.js";
import { createUsageAccounting } from "./token-accounting.js";
import { TokenMeterRegistry } from "./token-meter-provider.js";
import { calibrateResponse } from "./model-context-token-calibration.js";
import {
  createToolCallSha256,
  createToolLoopGuardContextReceipt,
  detectToolCallLoop,
  latestActiveToolLoopGuard,
  projectToolLoopGuardTriggers,
  TOOL_LOOP_GUARD_CONTEXT_EVENT,
  TOOL_LOOP_GUARD_TRIGGERED_EVENT,
} from "./tool-loop-guard.js";
import { ToolInvocationCapsuleStore } from "./tool-invocation-capsule-store.js";
import { ToolInvocationResultCapsuleStore } from "./tool-invocation-result-capsule-store.js";
import type {
  ContinueOperatorDecisionOptions,
  ResumeInterruptedRunAutomaticallyOptions,
  ResumeInterruptedRunOptions,
  RunPromptOptions,
} from "./agent-runtime-options.js";
export type {
  ContinueOperatorDecisionOptions,
  ResumeInterruptedRunAutomaticallyOptions,
  ResumeInterruptedRunOptions,
  RunPromptOptions,
} from "./agent-runtime-options.js";
export type { EventSink } from "./event-sink.js";
interface ActiveRun {
  runId: string;
  abort: () => void;
  source: RunInvocationSource;
}
type TurnSource = RunInvocationSource | "goal_continuation" | "advisor_correction";
const RUN_LEASE_TTL_MS = 60_000, RUN_LEASE_HEARTBEAT_MS = 20_000;
export class AgentRuntime {
  private readonly activeRuns = new Map<string, Map<string, ActiveRun>>();
  private readonly workerId = createId("worker");
  private readonly runLeaseOwnerId = createProcessLeaseOwnerId("worker");
  private readonly modelCalls = new AgentModelCallPipelineHost();
  private readonly modelRouter: ModelRouter;
  readonly attachKernelModelCallPipeline = this.modelCalls.attach;
  private readonly lifecycles = new AgentLifecyclePipelineAttachmentHost();
  readonly attachKernelLifecyclePipelines = this.lifecycles.attach;
  private readonly turns = new AgentTurnPipelineHost();
  readonly attachKernelTurnPipeline = this.turns.attach;
  readonly tokenMeters = new TokenMeterRegistry();
  private readonly capabilities: AgentCapabilityRuntime;
  readonly browserLiveViews: BrowserLiveViewService;
  readonly browserSessionControls: BrowserSessionControlService;
  private readonly contextEvents: ContextEventReadModel;
  constructor(
    readonly store: LocalStore,
    readonly modelRegistry: ModelRegistry,
    readonly extensionManager?: McpExtensionManager,
    readonly verificationSandbox: OsSandboxAdapter = createPlatformSandboxAdapter(),
    readonly workspaceProcesses?: WorkspaceProcessManager,
    readonly workspaceFileMutations?: WorkspaceFileMutationManager,
    readonly browserSessions?: BrowserSessionPort,
    readonly researchSourceCaptures?: BrowserSourceCaptureProvider,
    readonly modelInvocationCapsules = new ModelInvocationCapsuleStore(store.dataRoot),
    readonly toolInvocationCapsules = new ToolInvocationCapsuleStore(store.dataRoot),
    readonly toolInvocationResultCapsules = new ToolInvocationResultCapsuleStore(store.dataRoot),
    readonly networkCapabilities: AgentNetworkCapabilities = {},
    readonly browserInteractionConfirmations = new BrowserInteractionConfirmationManager(
      store,
    ),
    readonly browserSessionPauses = new BrowserSessionPauseManager(store),
    readonly conversationSurfaceCapsules = new ConversationSurfaceCapsuleStore(
      store.dataRoot,
    ),
    private readonly subagentHubControls?: Pick<SubagentHubControlService, "register">,
  ) {
    this.contextEvents = new ContextEventReadModel(store);
    this.modelRouter = new ModelRouter(store, modelRegistry);
    this.capabilities = new AgentCapabilityRuntime(
      store,
      verificationSandbox,
      workspaceProcesses,
      workspaceFileMutations,
      browserInteractionConfirmations,
      browserSessionPauses,
      browserSessions,
      researchSourceCaptures,
      networkCapabilities,
    );
    this.browserLiveViews = new BrowserLiveViewService(
      store,
      this.capabilities,
    );
    this.browserSessionControls = new BrowserSessionControlService(
      store,
      this.capabilities,
      browserSessionPauses,
    );
  }
  async runPrompt(options: RunPromptOptions): Promise<RunRecord> {
    const requestedSource = (
      options as unknown as { source?: RunInvocationSource }
    ).source;
    const prompt = validateAgentRunPrompt(
      options.text,
      requestedSource,
      [...(this.activeRuns.get(options.threadId)?.values() ?? [])].map(
        (active) => active.source,
      ),
    );
    const thread = this.store.getThread(options.threadId);
    const invocationSource = requestedSource ?? "user";
    const { profile: effectiveAgentSnapshot, internalResearchRecovery } =
      await resolvePromptCapabilityProfile(
        this.store,
        this.verificationSandbox,
        thread.agentId,
        options,
        invocationSource,
      );
    const environmentExecution = await negotiateEnvironmentExecution(
      effectiveAgentSnapshot,
      this.verificationSandbox,
      this.store.workspaceRoot,
      options.executionMode ?? "standard",
      options.signal,
    );
    const modelRef = await resolveAgentRunModel(
      this.store,
      this.modelRegistry,
      effectiveAgentSnapshot,
      invocationSource,
      options.model, options.modelRoute,
    );
    const workflowInvocation = isWorkflowRunSource(invocationSource);
    const messageExperiment = options[AGENT_MESSAGE_EXPERIMENT_EXECUTION];
    const toolResultReplay = options[AGENT_MESSAGE_TOOL_RESULT_REPLAY];
    validateAgentMessageToolResultReplay(messageExperiment, toolResultReplay);
    const firstClassSkillLoading =
      effectiveAgentSnapshot.enabledTools.includes("skill_load");
    const {
      projectSkillSnapshot,
      skillRunContext,
      catalogSkills,
      skillCatalogSha256,
      skillContext,
    } = await resolveAgentRunSkillContext({
      workspaceRoot: this.store.workspaceRoot,
      enabledSkills: effectiveAgentSnapshot.enabledSkills,
      firstClassSkillLoading,
      continuationSnapshot: options[SKILL_CONTINUATION_SNAPSHOT],
      signal: options.signal,
      toolResultReplay,
    });
    const promptVariables = resolvePromptVariables({
      systemPrompt: effectiveAgentSnapshot.systemPrompt,
      definitions: effectiveAgentSnapshot.promptVariables,
      skillCatalogText: formatSkillCatalog(catalogSkills),
      ...(messageExperiment
        ? {
            resolvedAt: new Date(
              messageExperiment.sourcePromptVariableResolvedAt,
            ),
          }
        : {}),
    });
    const toolLoopGuardContext = createToolLoopGuardContextReceipt(
      effectiveAgentSnapshot.toolLoopGuard,
    );
    const createRunInput = {
      threadId: thread.id,
      agentId: effectiveAgentSnapshot.id,
      model: modelRef,
      source: invocationSource,
      ...(options.capabilityPreset
        ? { capabilityPreset: options.capabilityPreset }
        : {}),
      skillCatalogSha256,
      promptVariables: {
        catalogSha256: promptVariables.snapshot.catalogSha256,
        snapshotSha256: promptVariables.snapshot.contentSha256,
        renderedSystemPromptSha256:
          promptVariables.snapshot.renderedSystemPromptSha256,
      },
      ...(options.agentRevision !== undefined
        ? { agentRevision: options.agentRevision }
        : {}),
      executionMode: environmentExecution.executionMode,
      ...(options.triggerId ? { triggerId: options.triggerId } : {}),
      ...(options[WORKFLOW_NODE_EXECUTION]
        ? {
            [WORKFLOW_NODE_EXECUTION]: options[WORKFLOW_NODE_EXECUTION],
          }
        : {}),
      ...(options[AGENT_MESSAGE_EXPERIMENT_EXECUTION]
        ? {
            [AGENT_MESSAGE_EXPERIMENT_EXECUTION]:
              options[AGENT_MESSAGE_EXPERIMENT_EXECUTION],
          }
        : {}),
      ...(options.parentRunId ? { parentRunId: options.parentRunId } : {}),
      ...(options.operatorDecisionId
        ? { operatorDecisionId: options.operatorDecisionId }
        : {}),
    };
    const leasedRun = await this.store.createLeasedRun(
      authorizeInternalResearchRecoveryIf(
        createRunInput,
        internalResearchRecovery,
      ),
      {
        ownerId: this.runLeaseOwnerId,
        ttlMs: RUN_LEASE_TTL_MS,
      },
    );
    const run = leasedRun.run;
    if (skillRunContext) {
      assertRunConfigurationSkillContext(run.configuration, skillRunContext);
    }
    const agentProfile = effectiveRunProfile(effectiveAgentSnapshot, run);
    const access = runExecutionBoundary(run.configuration);
    const abortController = new AbortController();
    const budget = new RunBudgetTracker(
      run.limits ??
        agentProfile.runLimits ??
        structuredClone(DEFAULT_RUN_LIMITS),
      run.startedAt,
    );
    const forwardAbort = (): void => abortController.abort();
    options.signal?.addEventListener("abort", forwardAbort, { once: true });
    if (options.signal?.aborted) abortController.abort();
    const threadRuns = this.activeRuns.get(thread.id) ?? new Map();
    threadRuns.set(run.id, {
      runId: run.id,
      abort: forwardAbort,
      source: invocationSource,
    });
    this.activeRuns.set(thread.id, threadRuns);
    const budgetTimeout = setTimeout(
      () => {
        budget.exhaustTimeout();
        abortController.abort();
      },
      Math.max(1, budget.remainingTimeoutMs()),
    );
    const heartbeat = setInterval(() => {
      void this.store
        .renewRunLease(run.id, leasedRun.token, RUN_LEASE_TTL_MS)
        .catch(() => abortController.abort());
    }, RUN_LEASE_HEARTBEAT_MS);
    let modelContextEnvelopeTurnIndex = 0;
    let unregisterSubagentHub: (() => void) | undefined;
    const nextModelContextEnvelopeTurnIndex = (): number => modelContextEnvelopeTurnIndex++;
    try {
      await options.onRunCreated?.(run);
      await this.record(
        {
          threadId: thread.id,
          runId: run.id,
          type: "run.started",
          category: "lifecycle",
          visibility: "debug",
          payload: createAgentRunStartedPayload({
            agent: agentProfile,
            model: modelRef,
            source: invocationSource,
            run,
            limits: run.limits ?? budget.limits,
            triggerId: options.triggerId,
            capabilityPreset: options.capabilityPreset,
            parentRunId: options.parentRunId,
            sourceContinuityRunId: options.sourceContinuityRunId,
            recovery: options.recovery,
          }),
        },
        options.onEvent,
      );
      await Promise.all(
        createEnvironmentCapabilityNegotiationEvents({
          executionMode: environmentExecution.executionMode,
          readiness: environmentExecution.readiness,
          threadId: thread.id,
          runId: run.id,
          configuredProfile: effectiveAgentSnapshot,
          activeProfile: agentProfile,
          sandboxId: this.verificationSandbox.id,
        }).map((event) => this.record(event, options.onEvent)),
      );
      await this.record(
        {
          threadId: thread.id,
          runId: run.id,
          type: "context.skills",
          category: "system",
          visibility: "debug",
          payload: toJsonValue(skillContext),
        },
        options.onEvent,
      );
      await this.record(
        {
          threadId: thread.id,
          runId: run.id,
          type: PROMPT_VARIABLES_RESOLVED_EVENT,
          category: "system",
          visibility: "debug",
          payload: toJsonValue(promptVariables.snapshot),
        },
        options.onEvent,
      );
      await this.record(
        {
          threadId: thread.id,
          runId: run.id,
          type: TOOL_LOOP_GUARD_CONTEXT_EVENT,
          category: "system",
          visibility: "debug",
          payload: toJsonValue(toolLoopGuardContext),
        },
        options.onEvent,
      );
      await recordAgentRunRecoveryStarted({
        store: this.store,
        run,
        invocationSource,
        ...(options.parentRunId ? { parentRunId: options.parentRunId } : {}),
        ...(options.recovery ? { recovery: options.recovery } : {}),
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      });
      const sourceContinuityGuidance =
        await this.capabilities.prepareSourceContinuityGuidance({
          owner: { threadId: thread.id, runId: run.id },
          invocationSource,
          automaticRecovery: options.recovery?.mode === "automatic",
          sourceContinuityRequired: options.sourceContinuityRunId !== undefined,
          sourceContinuityRunId: options.sourceContinuityRunId,
          enabledTools: agentProfile.enabledTools,
          onEvent: options.onEvent,
        });
      abortController.signal.throwIfAborted();
      const model = await this.modelRegistry.resolveConfigured(modelRef);
      const modelRoute = await createAgentRunModelRoute(this.modelRouter, {
        run, model, profile: agentProfile,
        ...(options.modelRoute ? { request: options.modelRoute } : {}),
        explicitPrimary: options.model !== undefined,
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      });
      const subagents =
        model && !access.restricted && !access.degraded
          ? new SubagentCoordinator({
              store: this.store,
              models: this.modelRegistry.models,
              model,
              modelRouter: this.modelRouter,
              ...(options.modelRoute
                ? { modelRouteRequest: options.modelRoute }
                : {}),
              run,
              profile: agentProfile,
              sandbox: this.verificationSandbox,
              processes: this.workspaceProcesses,
              worktreeOwnerId: this.workerId,
              parentSignal: abortController.signal,
              ...(options.onEvent ? { onEvent: options.onEvent } : {}),
            })
          : undefined;
      unregisterSubagentHub = this.subagentHubControls?.register(
        thread.id, run.id, subagents,
      );
      const modelAdvisorPolicy = effectiveModelAdvisorPolicy(agentProfile);
      const privateSourceContent = new PrivateSourceModelContentBoundary();
      const invokeTurn = async (
        text: string,
        source: TurnSource,
        advisorCorrection: boolean,
        advisorReviewPrompt: string,
      ): Promise<string> => {
        return model
          ? this.runLive(
              run,
              agentProfile,
              model,
              modelRoute!,
              text,
              source,
              subagents,
              access.restricted,
              access.degraded,
              firstClassSkillLoading &&
                (invocationSource === "user" ||
                  invocationSource === "recovery"),
              projectSkillSnapshot,
              catalogSkills,
              promptVariables.renderedSystemPrompt,
              sourceContinuityGuidance,
              promptVariables.snapshot.skillCatalogInjected,
              advisorCorrection,
              advisorReviewPrompt,
              abortController.signal,
              budget,
              nextModelContextEnvelopeTurnIndex,
              privateSourceContent,
              options.harnessExperimentProfile,
              toolResultReplay,
              options.onEvent,
            )
          : this.runDemo(
              run,
              agentProfile,
              text,
              source,
              advisorReviewPrompt,
              abortController.signal,
              budget,
              options.onEvent,
            );
      };
      const runTurn = async (
        text: string,
        source: TurnSource,
      ): Promise<string> => {
        let currentText = text;
        let currentSource = source;
        let correctionAttempt = 0;
        let correctionRequest: ModelAdvisorCorrectionRequest | undefined;
        while (true) {
          try {
            const response = await invokeTurn(
              currentText,
              currentSource,
              currentSource === "advisor_correction",
              text,
            );
            if (correctionRequest) {
              await this.recordModelAdvisorCorrectionOutcome(
                run,
                createModelAdvisorCorrectionOutcome({
                  request: correctionRequest.payload,
                  status: "accepted",
                  responseTextSha256: sha256Text(response),
                }),
                options.onEvent,
              );
            }
            return response;
          } catch (error) {
            const block =
              error instanceof ModelAdvisorBlockedError ||
              error instanceof CombinedModelAdvisorBlockedError
                ? error.block
                : undefined;
            if (!block) throw error;
            if (correctionRequest) {
              await this.recordModelAdvisorCorrectionOutcome(
                run,
                createModelAdvisorCorrectionOutcome({
                  request: correctionRequest.payload,
                  status:
                    correctionAttempt < modelAdvisorPolicy.maxCorrectionAttempts
                      ? "blocked"
                      : "exhausted",
                  responseTextSha256: block.textSha256,
                  diagnosticSetSha256: block.evidenceSha256,
                }),
                options.onEvent,
              );
            }
            if (!block.correctable) throw error;
            if (correctionAttempt >= modelAdvisorPolicy.maxCorrectionAttempts) {
              throw error;
            }
            correctionAttempt += 1;
            correctionRequest = createModelAdvisorCorrectionRequestFromBlock({
              block,
              turnSource: source,
              attempt: correctionAttempt,
              maxAttempts: modelAdvisorPolicy.maxCorrectionAttempts,
            });
            await this.recordModelAdvisorCorrectionRequest(
              run,
              correctionRequest,
              options.onEvent,
            );
            currentText = correctionRequest.prompt;
            currentSource = "advisor_correction";
          }
        }
      };
      let assistantText = await runTurn(prompt, invocationSource);
      toolResultReplay?.assertComplete();
      budget.throwIfExhausted();
      let goal = workflowInvocation
        ? undefined
        : await this.evaluateActiveGoal(
            thread.id,
            run.id,
            assistantText,
            model,
            abortController.signal,
            budget,
            nextModelContextEnvelopeTurnIndex,
            options.onEvent,
          );
      while (
        goal &&
        shouldContinueGoal(goal) &&
        !abortController.signal.aborted
      ) {
        goal = beginGoalContinuation(goal);
        await this.store.setGoal(thread.id, goal);
        await this.record(
          {
            threadId: thread.id,
            runId: run.id,
            type: "goal.continuation.started",
            category: "goal",
            visibility: "user",
            payload: {
              continuation: goal.continuationCount,
              maxContinuations: goal.maxContinuations,
              objective: goal.objective,
            },
          },
          options.onEvent,
        );
        assistantText = await runTurn(
          buildGoalContinuationPrompt(goal),
          "goal_continuation",
        );
        goal = await this.evaluateActiveGoal(
          thread.id,
          run.id,
          assistantText,
          model,
          abortController.signal,
          budget,
          nextModelContextEnvelopeTurnIndex,
          options.onEvent,
        );
      }
      if (
        model &&
        !access.restricted &&
        !workflowInvocation &&
        !abortController.signal.aborted
      ) {
        await this.proposeMemoriesFromRun(
          thread.id,
          run.id,
          agentProfile.id,
          model,
          abortController.signal,
          budget,
          nextModelContextEnvelopeTurnIndex,
          options.onEvent,
        );
      }
      await this.maybeGenerateThreadTitle({
        threadId: thread.id,
        runId: run.id,
        model,
        source: invocationSource,
        workflowInvocation,
        signal: abortController.signal,
      });
      budget.throwIfExhausted();
      await recordActiveSkillLifecycles(
        this.store,
        thread.id,
        run.id,
        options.onEvent,
      );
      await this.capabilities.cancelRun({
        threadId: thread.id,
        runId: run.id,
      });
      const completionUsage = await executeAgentRunCompletionLifecycle({
        lifecycles: this.lifecycles.current(),
        run,
        signal: abortController.signal,
        collectUsage: () => this.collectRunUsage(run.id),
      });
      return await finishSuccessfulAgentRun({
        store: this.store,
        run,
        invocationSource,
        ...(options.parentRunId ? { parentRunId: options.parentRunId } : {}),
        ...(options.recovery ? { recovery: options.recovery } : {}),
        usage: completionUsage,
        leaseToken: leasedRun.token,
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      });
    } catch (error) {
      await this.capabilities
        .cancelRun({
          threadId: thread.id,
          runId: run.id,
        })
        .catch(() => undefined);
      await this.maybeGenerateThreadTitle({
        threadId: thread.id,
        runId: run.id,
        model: undefined,
        source: invocationSource,
        workflowInvocation,
        signal: abortController.signal,
      });
      if (error instanceof OperatorDecisionPendingError) {
        await recordActiveSkillLifecycles(
          this.store,
          thread.id,
          run.id,
          options.onEvent,
        );
        await this.record(
          {
            threadId: thread.id,
            runId: run.id,
            type: "run.waiting_for_operator",
            category: "lifecycle",
            visibility: "user",
            payload: {
              status: "waiting",
              operatorDecisionId: error.decisionId,
            },
          },
          options.onEvent,
        );
        return await this.store.finishRun(run.id, "completed", {
          usage: await this.collectRunUsage(run.id),
          leaseToken: leasedRun.token,
          waitForOperatorDecisionId: error.decisionId,
        });
      }
      const failure = classifyFailure(
        abortController.signal.aborted,
        workflowInvocation,
        budget.exhaustion,
        error,
      );
      if (failure.blocksGoal) {
        await this.blockGoalForRunFailure(
          thread.id,
          run.id,
          failure.message,
          options.onEvent,
        );
      }
      return settleRunFailure({
        store: this.store,
        run,
        failure,
        invocationSource,
        ...(options.parentRunId ? { parentRunId: options.parentRunId } : {}),
        ...(options.recovery ? { recovery: options.recovery } : {}),
        usage: await this.collectRunUsage(run.id),
        limits: budget.limits,
        leaseToken: leasedRun.token,
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      });
    } finally {
      unregisterSubagentHub?.();
      clearTimeout(budgetTimeout);
      clearInterval(heartbeat);
      options.signal?.removeEventListener("abort", forwardAbort);
      const threadRuns = this.activeRuns.get(thread.id);
      threadRuns?.delete(run.id);
      if (threadRuns?.size === 0) this.activeRuns.delete(thread.id);
    }
  }
  async resumeInterruptedRun(
    options: ResumeInterruptedRunOptions,
  ): Promise<RunRecord> {
    const thread = this.store.getThread(options.threadId);
    const interrupted = this.store
      .listRuns(thread.id)
      .filter((run) => manualRunRecoverySettlementMatches(thread.status, run))
      .findLast((run) => !options.runId || run.id === options.runId);
    if (!interrupted) throw new Error("Manually resumable run not found");
    const blockReason = manualRunRecoveryBlockReason(interrupted);
    if (blockReason === "workflow_managed") {
      throw new Error(
        "Workflow node Runs must be resumed through their Workflow Plan",
      );
    }
    if (blockReason === "model_experiment") {
      throw new Error(
        "Model invocation experiment Runs must be retried from their source checkpoint",
      );
    }
    if (blockReason === "tool_experiment") {
      throw new Error(
        "Tool invocation experiment Runs must be retried from their source checkpoint",
      );
    }
    if (blockReason === "agent_experiment") {
      throw new Error(
        "Agent message experiment Runs must be retried from their source checkpoint",
      );
    }
    const events = await this.store.listRunEvents(interrupted.id);
    const recoveryOptions: RunPromptOptions = {
      threadId: thread.id,
      text: buildRunRecoveryPrompt(
        interrupted,
        thread.goal?.status === "active" ? thread.goal.objective : undefined,
        { events, plans: this.store.listPlans(thread.id) },
      ),
      parentRunId: interrupted.id,
      source: "recovery",
      recovery: { mode: "manual" },
      ...(options.model ? { model: options.model } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    };
    return this.runPrompt(
      await prepareManualSkillRecoveryOptions(
        this.store.workspaceRoot,
        interrupted,
        events,
        recoveryOptions,
      ),
    );
  }
  async continueOperatorDecision(
    options: ContinueOperatorDecisionOptions,
  ): Promise<RunRecord> {
    const decision = (
      await this.store.listOperatorDecisions(options.threadId)
    ).find((candidate) => candidate.id === options.decisionId);
    if (!decision) {
      throw new Error(`Operator decision not found: ${options.decisionId}`);
    }
    if (decision.status !== "answered") {
      throw new Error(
        `Operator decision cannot continue in ${decision.status} state`,
      );
    }
    const continuation = await resolveOperatorDecisionCapabilityContinuation(
      this.store,
      options.threadId,
      decision.runId,
    );
    return this.runPrompt({
      threadId: options.threadId,
      text: formatOperatorDecisionContinuation(decision),
      ...continuation.runOptions,
      parentRunId: continuation.originRun.id,
      operatorDecisionId: decision.id,
      source: "user",
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      onRunCreated: async (run) => {
        await this.store.continueOperatorDecision(
          options.threadId,
          decision.id,
          run.id,
        );
        await options.onRunCreated?.(run);
      },
    });
  }
  async resumeInterruptedRunAutomatically(
    options: ResumeInterruptedRunAutomaticallyOptions,
  ): Promise<RunRecord> {
    const { assessment, attempt } = options;
    if (
      !assessment.eligible ||
      assessment.runId !== attempt.interruptedRunId ||
      assessment.rootRunId !== attempt.rootRunId ||
      assessment.contentSha256 !== attempt.assessmentSha256 ||
      assessment.priorAttempts + 1 !== attempt.attempt ||
      attempt.status !== "claimed"
    ) {
      throw new Error("Automatic recovery claim evidence is invalid");
    }
    const thread = this.store.getThread(assessment.threadId);
    if (thread.status !== "waiting" || thread.currentRunId) {
      throw new Error("Thread is not waiting for automatic recovery");
    }
    const interrupted = this.store
      .listRuns(thread.id)
      .find((run) => run.id === assessment.runId);
    if (
      !interrupted ||
      interrupted.status !== "interrupted" ||
      isWorkflowRunSource(interrupted.source) ||
      !interrupted.configuration ||
      !modernRunConfiguration(interrupted.configuration) ||
      interrupted.configuration.automaticRecovery.mode !== "safe_read_only" ||
      interrupted.configuration.contentSha256 !==
        assessment.runConfigurationSha256
    ) {
      throw new Error(
        "Interrupted Run is not eligible for safe automatic recovery",
      );
    }
    const events = await this.store.listRunEvents(interrupted.id);
    const recoveryOptions: RunPromptOptions = {
      threadId: thread.id,
      text: buildRunRecoveryPrompt(
        interrupted,
        thread.goal?.status === "active" ? thread.goal.objective : undefined,
        events,
        "automatic",
      ),
      model: interrupted.configuration.model,
      agentRevision: interrupted.configuration.agentRevision,
      executionMode: "safe_read_only_recovery",
      parentRunId: interrupted.id,
      source: "recovery",
      triggerId: attempt.triggerId,
      recovery: {
        mode: "automatic",
        attemptId: attempt.id,
        assessmentSha256: assessment.contentSha256,
      },
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      ...(options.onRunCreated ? { onRunCreated: options.onRunCreated } : {}),
    };
    return this.runPrompt(
      await prepareAutomaticSkillRecoveryOptions(
        this.store.workspaceRoot,
        interrupted,
        events,
        recoveryOptions,
      ),
    );
  }
  stop(threadId: string): boolean {
    const activeRuns = this.activeRuns.get(threadId);
    if (!activeRuns || activeRuns.size === 0) return false;
    for (const active of activeRuns.values()) active.abort();
    return true;
  }
  private async runDemo(
    run: RunRecord,
    profile: AgentProfile,
    prompt: string,
    source: TurnSource,
    advisorReviewPrompt: string,
    signal: AbortSignal,
    budget: RunBudgetTracker,
    onEvent?: EventSink,
  ): Promise<string> {
    budget.beginPrimaryTurn();
    if (source !== "advisor_correction") {
      const promptEvent = turnPromptEvent(source);
      await this.record(
        {
          threadId: run.threadId,
          runId: run.id,
          ...promptEvent,
          payload: { role: "user", text: prompt },
        },
        onEvent,
      );
    }
    await this.record(
      {
        threadId: run.threadId,
        runId: run.id,
        type: "context.prepared",
        category: "model",
        visibility: "debug",
        payload: {
          messageCount: isWorkflowRunSource(source)
            ? 0
            : (
                await this.store.listEventsRange(
                  run.threadId,
                  1,
                  this.store.getThread(run.threadId).eventCount,
                  [
                    "message.user",
                    "message.assistant",
                    "run.control.queued",
                    "run.control.delivered",
                    "run.control.cancelled",
                  ],
                )
              ).length,
          skills: profile.enabledSkills,
          policy: profile.toolPolicy,
        },
      },
      onEvent,
    );
    await delay(90, signal);
    const chinese = /[\u3400-\u9fff]/u.test(prompt);
    const response =
      source === "recovery"
        ? chinese
          ? "我已从持久账本重新打开中断运行。零密钥演示模型无法检查当前状态或安全验证先前工具的结果，因此没有重放任何操作。配置真实模型后，Napier 会先核对工作区与外部状态，再继续任务。"
          : "I reopened the interrupted run from its durable ledger. The zero-key demo model cannot inspect current state or safely verify prior tool outcomes, so no operation was replayed. Configure a live model to verify workspace and external state before continuing."
        : chinese
          ? `我已将“${summarize(prompt, 46)}”写入可回放运行账本。当前使用零密钥演示模型，所以我不会虚构工具执行或外部结果。真实模型接入后，Napier 会先建立可验证计划，再在工作区权限边界内调用工具，并把每一步证据、产物和成本记录到右侧 Trace。`
          : `I recorded “${summarize(prompt, 56)}” in the replayable run ledger. This thread is using the zero-key demo model, so I will not fabricate tool execution or external results. With a live model configured, Napier will form a verifiable plan, work inside the workspace policy, and preserve every step, artifact, and cost in the Trace.`;
    const usage: Usage = {
      inputTokens: Math.ceil(prompt.length / 4),
      outputTokens: Math.ceil(response.length / 4),
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    };
    const usageAccounting = createUsageAccounting(
      { provider: "napier", id: "demo" },
      usage,
    );
    budget.observePrimaryUsage(usage, Date.now(), usageAccounting);
    const modelAdvisorPolicy = effectiveModelAdvisorPolicy(profile);
    const redactCandidate = modelAdvisorPolicy.mode === "enforce";

    const chunks = splitForStreaming(response, 7);
    let accumulated = "";
    for (const chunk of chunks) {
      await delay(45, signal);
      accumulated += chunk;
      await this.record(
        {
          threadId: run.threadId,
          runId: run.id,
          type: "model.text.delta",
          category: "model",
          visibility: "hidden",
          payload: redactCandidate
            ? {
                deltaSha256: sha256Text(chunk),
                deltaBytes: Buffer.byteLength(chunk, "utf8"),
                textSha256: sha256Text(accumulated),
                textBytes: Buffer.byteLength(accumulated, "utf8"),
                redacted: true,
              }
            : { delta: chunk, text: accumulated },
        },
        redactCandidate ? undefined : onEvent,
      );
    }
    await this.recordModelAdvisorGate(
      run,
      response,
      { provider: "napier", id: "demo" },
      advisorReviewPrompt,
      source,
      modelAdvisorPolicy,
      signal,
      budget,
      onEvent,
    );
    await this.record(
      {
        threadId: run.threadId,
        runId: run.id,
        type: "message.assistant",
        category: "message",
        visibility: "user",
        payload: {
          role: "assistant",
          text: response,
          model: "napier/demo",
          usage,
          usageAccounting,
        },
      },
      onEvent,
    );
    budget.throwIfExhausted();
    return response;
  }
  private async runLive(
    run: RunRecord,
    profile: AgentProfile,
    model: Model<Api>,
    modelRoute: ModelRouteSession,
    prompt: string,
    source: TurnSource,
    subagents: SubagentCoordinator | undefined,
    restrictedReadOnlyExecution: boolean,
    environmentDegradedExecution: boolean,
    skillLoadAllowed: boolean,
    projectSkillSnapshot: SkillSnapshot | undefined,
    catalogSkills: readonly Skill[],
    resolvedSystemPrompt: string,
    sourceContinuityGuidance: string,
    skillCatalogInjected: boolean,
    advisorCorrection: boolean,
    advisorReviewPrompt: string,
    signal: AbortSignal,
    budget: RunBudgetTracker,
    nextModelContextEnvelopeTurnIndex: () => number,
    privateSourceContent: PrivateSourceModelContentBoundary,
    harnessExperimentProfile?: import("./model-harness-experiment-profile.js").ModelHarnessExperimentProfile,
    toolResultReplay?: FrozenToolResultReplayController,
    onEvent?: EventSink,
  ): Promise<string> {
    const turnPipeline = this.turns.current();
    const workflowInvocation = isWorkflowRunSource(run.source);
    const history = await this.buildModelHistory(
      run, model, signal, budget, nextModelContextEnvelopeTurnIndex, onEvent,
    ); budget.assertCanStartPrimaryTurn();
    const expiredMemories = restrictedReadOnlyExecution
      ? []
      : await this.store.expireDueMemories({
          agentId: profile.id,
        });
    for (const memory of expiredMemories) {
      await this.record(
        {
          threadId: run.threadId,
          runId: run.id,
          type: "memory.stale",
          category: "memory",
          visibility: "user",
          payload: {
            memoryId: memory.id,
            scope: memory.scope,
            ...(memory.agentId ? { agentId: memory.agentId } : {}),
            reviewDueAt: memory.reviewDueAt ?? "",
            reason: "review_due",
            useCount: memory.useCount,
          },
        },
        onEvent,
      );
    }
    const memoryContext = formatMemoryContext(
      this.store.listMemories({ agentId: profile.id }),
      profile.id,
    );
    if (!restrictedReadOnlyExecution) {
      await this.store.recordMemoryUsage(memoryContext.factIds, run.id);
    }
    const skillCatalogOverlay = skillCatalogInjected
      ? ""
      : formatSkillCatalog(catalogSkills);
    const threadRecord = this.store.getThread(run.threadId);
    const toolLoopGuardPolicy = effectiveToolLoopGuardPolicy(profile);
    let activeToolLoopGuard = latestActiveToolLoopGuard(
      await this.store.listRunEvents(run.id),
      run.id,
      toolLoopGuardPolicy,
    );
    const importedLedgerBoundary = formatImportedLedgerBoundary(
      threadRecord.importProvenance,
    );
    await this.record(
      {
        threadId: run.threadId,
        runId: run.id,
        type: "context.memory",
        category: "memory",
        visibility: "debug",
        payload: {
          factIds: memoryContext.factIds,
          count: memoryContext.factIds.length,
          truncated: memoryContext.truncated,
          contentSha256: memoryContext.text
            ? sha256Text(memoryContext.text)
            : "",
        },
      },
      onEvent,
    );
    const codeBridge = createGovernedCodeBridgeBinding();
    let tools = this.capabilities.createTools({
      profile,
      threadId: run.threadId,
      runId: run.id,
      ...(projectSkillSnapshot ? { projectSkillSnapshot } : {}),
      skillLoadAllowed,
      restrictedReadOnlyExecution,
      advisorCorrection,
      browserInteractionConfirmationAllowed:
        run.source === "user" && !environmentDegradedExecution,
      codeBridge: codeBridge.dispatcher,
    });
    let pendingOperatorDecisionId: string | undefined;
    if (
      !restrictedReadOnlyExecution &&
      !advisorCorrection &&
      !workflowInvocation
    ) {
      tools.push(
        ...createAgentRunControlTools({
          store: this.store,
          run,
          onOperatorDecision: (id) => {
            pendingOperatorDecisionId = id;
          },
          ...(onEvent ? { onEvent } : {}),
        }),
      );
    }
    let deferredExtensionTools: AgentTool[] = [];
    if (
      this.extensionManager &&
      !restrictedReadOnlyExecution &&
      !environmentDegradedExecution &&
      !advisorCorrection
    ) {
      const extensionTools = this.extensionManager.createDeferredAgentTools(
        profile.id,
      );
      tools.push(...extensionTools.initialTools);
      deferredExtensionTools = extensionTools.deferredTools;
    }
    if (
      !restrictedReadOnlyExecution &&
      !advisorCorrection &&
      subagents?.hasEnabledRoles()
    ) {
      tools.push(...subagents.createTools()); deferredExtensionTools.push(...subagents.createSupervisorTools());
    }
    if (
      !advisorCorrection &&
      tools.length + deferredExtensionTools.length > 20
    ) {
      const candidates = [...tools, ...deferredExtensionTools];
      tools.push(createCapabilityCatalogTool(candidates, new ToolProtocolRegistry(candidates)));
    }
    const toolSelection = await turnPipeline.compileTools({
      immediate: tools,
      deferred: deferredExtensionTools,
    });
    const definitions = toolSelection.immediate.concat(toolSelection.deferred); const toolProtocol = new ToolProtocolRegistry(definitions);
    tools = toolSelection.immediate; deferredExtensionTools = toolSelection.deferred;
    const lifecyclePipelines = this.lifecycles.current(); let stepIndex = 0;
    let activeStepToolNames = new Set(tools.map((tool) => tool.name));
    const wrapTools = (candidates: readonly AgentTool[]) => wrapAgentToolsWithLifecycle({
      tools: candidates, registry: toolProtocol, lifecycles: lifecyclePipelines,
      run, stepIndex: () => stepIndex,
    });
    tools = wrapTools(tools);
    deferredExtensionTools = wrapTools(deferredExtensionTools);
    const toolResultLifecycle = toolLife(this,
      [budget, run, tools, deferredExtensionTools, definitions],
      [toolResultReplay, onEvent, toolProtocol]);
    const progress = await progLife(this, budget, run, tools, prompt, onEvent);
    const workspaceToolGuidance = formatWorkspaceToolGuidance(tools);
    const planToolGuidance = formatPlanToolGuidance(tools);
    const initialPromptMessages = providerMessages([
      ...history.messages,
      { role: "user", content: prompt, timestamp: Date.now() },
    ]);
    const checkpointContext = history.checkpoint
      ? formatContextCheckpoint(history.checkpoint)
      : "";
    const milestoneRedactThroughEventSeq = localImportedThroughSeq(
      threadRecord.importProvenance,
    );
    let milestoneContextProjection = createAgentMilestoneContextProjection(
      run.threadId,
      workflowInvocation
        ? []
        : await this.store.listAgentMilestones(run.threadId),
      { redactThroughEventSeq: milestoneRedactThroughEventSeq },
    );
    let delegationLedgerProjection = createDelegationLedgerProjection(
      run.threadId,
      this.store.listSubagentTasks(
        run.threadId,
        workflowInvocation ? run.id : undefined,
      ),
    );
    const buildCompiledPrompt = createRuntimeCompiledPromptBuilder({
      turnPipeline,
      profile,
      run,
      sandboxId: this.verificationSandbox.id,
      restrictedReadOnlyExecution,
      environmentDegradedExecution,
      advisorCorrection,
      browserInteractionConfirmationAvailable:
        this.browserInteractionConfirmations.available,
      resolvedSystemPrompt,
      skillCatalog: skillCatalogOverlay,
      workspaceToolGuidance,
      planToolGuidance,
      sourceContinuityGuidance,
      importedLedgerBoundary,
      checkpoint: checkpointContext,
      memory: memoryContext.text,
      delegation: () => delegationLedgerProjection,
      milestones: () => milestoneContextProjection,
      toolLoopGuard: () => activeToolLoopGuard,
      harnessExperimentProfile,
    });
    const systemPrompt = buildCompiledPrompt(model, undefined, {
      messages: initialPromptMessages,
      tools,
    }).systemPrompt;
    let currentModelContextEnvelope: ModelContextEnvelopeReceipt | undefined;
    const streamWithModelContextEnvelope = this.modelCalls
      .current(this)
      .createAgentTurnStream({
        host: this,
        budget,
        run,
        modelRoute,
        harnessExperimentProfile,
        buildCompiledPrompt,
        nextTurnIndex: nextModelContextEnvelopeTurnIndex,
        onEnvelope: (envelope) => {
          currentModelContextEnvelope = envelope;
        },
        ...(onEvent ? { onEvent } : {}),
      });
    const streamWithStepLifecycle = createLifecycleAgentStepStream({
      delegate: streamWithModelContextEnvelope,
      lifecycles: lifecyclePipelines,
      run,
      toolSetSha256: toolSelection.receipt.activeToolSetSha256, registry: toolProtocol,
      onStep: (index, names) => {
        stepIndex = index;
        activeStepToolNames = names;
      },
    });
    const toolPreflight = createAgentToolPreflight({
      store: this.store,
      policy: {
        store: this.store, run, profile,
        ...(this.extensionManager ? { extensionManager: this.extensionManager } : {}),
        confirmations: this.browserInteractionConfirmations,
        browserPauses: this.browserSessionPauses,
        browserConfirmation: this.capabilities.browserConfirmation,
        restrictedReadOnlyExecution, toolProtocol,
        ...(onEvent ? { onEvent } : {}),
      },
      turnPipeline, budget, progress, lifecycle: toolResultLifecycle,
      activeToolNames: () => activeStepToolNames,
      toolLoopGuardPolicy,
      ...(onEvent ? { onEvent } : {}),
    });
    const afterToolCall = createAgentToolResultFinalizer(toolResultLifecycle);
    codeBridge.attach({
      store: this.store,
      run, tools: [...tools, ...deferredExtensionTools], registry: toolProtocol,
      activeToolNames: () => activeStepToolNames,
      assertBudget: () => budget.assertCanStartAuxiliaryCall(),
      preflight: toolPreflight.governed,
      finalize: afterToolCall,
      ...(onEvent ? { onEvent } : {}),
    });
    const preRecordedControlMessages = new Map<string, number>();
    const hasQueuedControlMessage = async (
      mode?: RunControlMessageMode,
    ): Promise<boolean> => {
      try {
        return (
          await this.store.listRunControlMessages(run.threadId, run.id)
        ).some(
          (message) =>
            message.status === "queued" && (!mode || message.mode === mode),
        );
      } catch {
        return false;
      }
    };
    const drainControlMessage = async (
      mode: RunControlMessageMode,
    ): Promise<UserMessage[]> => {
      if (advisorCorrection) return [];
      try {
        if (!(await hasQueuedControlMessage(mode))) return [];
        if (budget.exhaustBeforeNextPrimaryTurn()) return [];
        const delivery = await this.store.deliverNextRunControlMessage(
          run.threadId,
          run.id,
          mode,
        );
        if (!delivery) return [];
        for (const event of delivery.events) {
          if (!onEvent) continue;
          try {
            await onEvent(event);
          } catch {
            // A disconnected stream must not cancel durable message delivery.
          }
        }
        const messageEvent = delivery.events.find(
          (event) => event.type === "message.user",
        );
        const timestamp = messageEvent
          ? Date.parse(messageEvent.createdAt)
          : Date.now();
        const eventKey = controlMessageEventKey(timestamp, delivery.text);
        preRecordedControlMessages.set(
          eventKey,
          (preRecordedControlMessages.get(eventKey) ?? 0) + 1,
        );
        return [
          {
            role: "user",
            content: delivery.text,
            timestamp,
          },
        ];
      } catch {
        // Queue polling must not interrupt an otherwise valid Agent turn.
        return [];
      }
    };

    await this.record(
      {
        threadId: run.threadId,
        runId: run.id,
        type: "context.prepared",
        category: "model",
        visibility: "debug",
        payload: {
          messageCount: history.messages.length,
          rawMessageCount: history.rawMessageCount,
          toolExchangeCount: history.toolExchangeCount,
          omittedToolExchangeCount: history.omittedToolExchangeCount,
          compacted: history.compacted,
          ...(history.checkpoint
            ? {
                checkpointId: history.checkpoint.checkpointId,
                checkpointSourceSha256: history.checkpoint.sourceSha256,
                checkpointToSeq: history.checkpoint.toSeq,
              }
            : {}),
          skills: profile.enabledSkills,
          policy: profile.toolPolicy,
          advisorCorrection,
          ...turnPipeline.resolutionEvidence(toolSelection.receipt),
          toolCount: tools.length,
          deferredToolCount: deferredExtensionTools.length,
          delegationTaskCount: delegationLedgerProjection.taskCount,
          delegationActiveTaskCount: delegationLedgerProjection.activeTaskCount,
          delegationOmittedTaskCount:
            delegationLedgerProjection.omittedTaskCount,
          delegationTaskSetSha256: delegationLedgerProjection.taskSetSha256,
          delegationProjectionSha256: delegationLedgerProjection.contentSha256,
          milestoneCount: milestoneContextProjection.milestoneCount,
          milestoneSelectedCount:
            milestoneContextProjection.selectedMilestoneCount,
          milestoneOmittedCount:
            milestoneContextProjection.omittedMilestoneCount,
          milestoneTextRedacted: milestoneContextProjection.textRedacted,
          milestoneSetSha256: milestoneContextProjection.milestoneSetSha256,
          milestoneProjectionSha256: milestoneContextProjection.contentSha256,
          toolLoopGuardEnabled: toolLoopGuardPolicy.enabled,
          toolLoopGuardThreshold: toolLoopGuardPolicy.threshold,
          toolLoopGuardActive: Boolean(activeToolLoopGuard),
          ...(activeToolLoopGuard
            ? {
                toolLoopGuardTriggerSha256:
                  activeToolLoopGuard.receipt.contentSha256,
              }
            : {}),
        },
      },
      onEvent,
    );
    let finalText = "";
    const finalization = finLife(this, budget, run, preRecordedControlMessages);
    const deltaBatcher = new ModelDeltaBatcher(
      run.threadId,
      run.id,
      (input, sink) => this.record(input, sink),
      onEvent,
    );
    const loop = runAgentLoop(
      [
        {
          role: "user",
          content: prompt,
          timestamp: Date.now(),
        },
      ],
      {
        systemPrompt,
        tools,
        messages: history.messages,
      },
      {
        model,
        ...(model.reasoning && profile.thinkingLevel !== "off"
          ? { reasoning: profile.thinkingLevel as ThinkingLevel }
          : {}),
        sessionId: run.threadId,
        toolExecution: "parallel",
        convertToLlm: providerMessages,
        beforeToolCall: toolPreflight.beforeToolCall,
        afterToolCall,
        getSteeringMessages: () =>
          finalization.steer(() =>
            progress.steer(preRecordedControlMessages, drainControlMessage),
          ),
        getFollowUpMessages: () => finalization.followUp(drainControlMessage),
        prepareNextTurn: async ({ context, toolResults }) => {
          let nextTools = context.tools;
          if (!finalization.active && deferredExtensionTools.length > 0) {
            const requestedNames = new Set(
              toolResults.flatMap((result) => result.addedToolNames ?? []),
            );
            const currentNames = new Set(
              (context.tools ?? []).map((tool) => tool.name),
            );
            const additions = deferredExtensionTools.filter(
              (tool) =>
                requestedNames.has(tool.name) && !currentNames.has(tool.name),
            );
            if (additions.length > 0) {
              nextTools = [...(context.tools ?? []), ...additions];
            }
          }
          let nextDelegationLedgerProjection = delegationLedgerProjection;
          let nextMilestoneContextProjection = milestoneContextProjection;
          let nextActiveToolLoopGuard = activeToolLoopGuard;
          try {
            nextDelegationLedgerProjection = createDelegationLedgerProjection(
              run.threadId,
              this.store.listSubagentTasks(
                run.threadId,
                workflowInvocation ? run.id : undefined,
              ),
            );
          } catch {
            // Retain the last verified delegation projection.
          }
          if (!workflowInvocation) {
            try {
              nextMilestoneContextProjection =
                createAgentMilestoneContextProjection(
                  run.threadId,
                  await this.store.listAgentMilestones(run.threadId),
                  { redactThroughEventSeq: milestoneRedactThroughEventSeq },
                );
            } catch {
              // Retain the last verified milestone projection.
            }
          }
          try {
            let runEvents = await this.store.listRunEvents(run.id);
            const detection = detectToolCallLoop(
              runEvents,
              run.id,
              toolLoopGuardPolicy,
            );
            const knownTriggers = projectToolLoopGuardTriggers(
              runEvents,
              run.id,
            );
            if (
              detection &&
              !knownTriggers.some(
                (trigger) =>
                  trigger.receipt.attemptSetSha256 ===
                  detection.attemptSetSha256,
              )
            ) {
              await this.record(
                {
                  threadId: run.threadId,
                  runId: run.id,
                  type: TOOL_LOOP_GUARD_TRIGGERED_EVENT,
                  category: "system",
                  visibility: "debug",
                  payload: toJsonValue(detection),
                },
                onEvent,
              );
              runEvents = await this.store.listRunEvents(run.id);
            }
            nextActiveToolLoopGuard = latestActiveToolLoopGuard(
              runEvents,
              run.id,
              toolLoopGuardPolicy,
            );
          } catch {
            // Retain the last verified loop-guard projection.
          }
          const nextSystemPrompt = buildCompiledPrompt(model, undefined, {
            messages: providerMessages(context.messages),
            ...(nextTools ? { tools: nextTools } : {}),
          }).systemPrompt;
          activeToolLoopGuard = nextActiveToolLoopGuard;
          if (
            nextDelegationLedgerProjection.contentSha256 !==
            delegationLedgerProjection.contentSha256
          ) {
            const previousProjectionSha256 =
              delegationLedgerProjection.contentSha256;
            delegationLedgerProjection = nextDelegationLedgerProjection;
            try {
              await this.record(
                {
                  threadId: run.threadId,
                  runId: run.id,
                  type: "context.delegation.updated",
                  category: "model",
                  visibility: "debug",
                  payload: {
                    previousProjectionSha256,
                    delegationTaskCount: delegationLedgerProjection.taskCount,
                    delegationActiveTaskCount:
                      delegationLedgerProjection.activeTaskCount,
                    delegationOmittedTaskCount:
                      delegationLedgerProjection.omittedTaskCount,
                    delegationTaskSetSha256:
                      delegationLedgerProjection.taskSetSha256,
                    delegationProjectionSha256:
                      delegationLedgerProjection.contentSha256,
                  },
                },
                onEvent,
              );
            } catch {
              // Projection refresh must not fail an otherwise valid model turn.
            }
          }
          if (
            nextMilestoneContextProjection.contentSha256 !==
            milestoneContextProjection.contentSha256
          ) {
            const previousProjectionSha256 =
              milestoneContextProjection.contentSha256;
            milestoneContextProjection = nextMilestoneContextProjection;
            try {
              await this.record(
                {
                  threadId: run.threadId,
                  runId: run.id,
                  type: "context.milestones.updated",
                  category: "model",
                  visibility: "debug",
                  payload: {
                    previousProjectionSha256,
                    milestoneCount: milestoneContextProjection.milestoneCount,
                    milestoneSelectedCount:
                      milestoneContextProjection.selectedMilestoneCount,
                    milestoneOmittedCount:
                      milestoneContextProjection.omittedMilestoneCount,
                    milestoneTextRedacted:
                      milestoneContextProjection.textRedacted,
                    milestoneSetSha256:
                      milestoneContextProjection.milestoneSetSha256,
                    milestoneProjectionSha256:
                      milestoneContextProjection.contentSha256,
                    milestoneId:
                      milestoneContextProjection.milestones.at(-1)
                        ?.milestoneId ?? "",
                  },
                },
                onEvent,
              );
            } catch {
              // Milestone refresh must not fail an otherwise valid model turn.
            }
          }
          if (
            nextTools === context.tools &&
            nextSystemPrompt === context.systemPrompt
          ) {
            return undefined;
          }
          return {
            context: {
              ...context,
              systemPrompt: nextSystemPrompt,
              ...(nextTools ? { tools: nextTools } : {}),
            },
          };
        },
        shouldStopAfterTurn: async ({ toolResults }) => {
          if (toolResultLifecycle.shouldStopAfterTurn()) return true;
          budget.syncSubagentUsage(
            this.store.listSubagentTasks(run.threadId, run.id),
          );
          if (budget.exhaustion) return true;
          if (pendingOperatorDecisionId) return true;
          const requiresNextTurn =
            toolResults.length > 0 ||
            (!advisorCorrection && (await hasQueuedControlMessage()));
          if (!requiresNextTurn) return false;
          if (budget.exhaustBeforeNextPrimaryTurn()) return true;
          await finalization.enterIfNeeded(onEvent);
          return false;
        },
      },
      async (event) => {
        const text = await this.handleAgentEvent(
          run,
          event,
          source,
          budget,
          effectiveModelAdvisorPolicy(profile),
          advisorReviewPrompt,
          signal,
          preRecordedControlMessages,
          currentModelContextEnvelope,
          toolResultLifecycle,
          privateSourceContent,
          deltaBatcher,
          onEvent,
        );
        if (event.type === "turn_end") await progress.recordTurn();
        if (text !== undefined) finalText = text;
      },
      signal,
      streamWithStepLifecycle,
    );
    await loop.finally(() => deltaBatcher.flush());
    if (signal.aborted && !budget.exhaustion) {
      throw new Error("Run was cancelled");
    }
    budget.throwIfExhausted();
    toolResultLifecycle.deadlines.throwIfTriggered();
    finalization.assertDelivered(finalText);
    if (pendingOperatorDecisionId) {
      throw new OperatorDecisionPendingError(pendingOperatorDecisionId);
    }
    return finalText;
  }
  private async handleAgentEvent(
    run: RunRecord,
    event: AgentEvent,
    source: TurnSource,
    budget: RunBudgetTracker,
    modelAdvisorPolicy: ReturnType<typeof effectiveModelAdvisorPolicy>,
    advisorReviewPrompt: string,
    signal: AbortSignal,
    preRecordedControlMessages: Map<string, number>,
    modelContextEnvelope: ModelContextEnvelopeReceipt | undefined,
    toolResultLifecycle: AgentToolResultLifecycle,
    privateSourceContent: PrivateSourceModelContentBoundary,
    deltaBatcher: ModelDeltaBatcher,
    onEvent?: EventSink,
  ): Promise<string | undefined> {
    if (event.type === "message_update") {
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta" || update.type === "thinking_delta") {
        const redactCandidate = privateSourceContent.redact(
          modelAdvisorPolicy.mode === "enforce",
        );
        await deltaBatcher.push(
          update.type === "text_delta"
            ? "model.text.delta"
            : "model.thinking.delta",
          update.delta,
          redactCandidate,
        );
      }
      return undefined;
    }
    await deltaBatcher.flush();
    if (event.type === "turn_start" || event.type === "turn_end") {
      if (event.type === "turn_start") budget.beginPrimaryTurn();
      await captureConversationSurfaceTurn({ host: this, run, event, envelope: modelContextEnvelope, ...(onEvent ? { onEvent } : {}) });
      await this.record(
        {
          threadId: run.threadId,
          runId: run.id,
          type: event.type === "turn_start" ? "turn.started" : "turn.completed",
          category: "lifecycle",
          visibility: "debug",
          payload: {},
        },
        onEvent,
      );
      return undefined;
    }
    if (event.type === "message_end") {
      if (event.message.role === "user" && source !== "advisor_correction") {
        const text = contentText(event.message.content);
        const eventKey = controlMessageEventKey(event.message.timestamp, text);
        const preRecordedCount = preRecordedControlMessages.get(eventKey) ?? 0;
        if (preRecordedCount > 0) {
          if (preRecordedCount === 1) {
            preRecordedControlMessages.delete(eventKey);
          } else {
            preRecordedControlMessages.set(eventKey, preRecordedCount - 1);
          }
          return undefined;
        }
        const promptEvent = turnPromptEvent(source);
        await this.record(
          {
            threadId: run.threadId,
            runId: run.id,
            ...promptEvent,
            payload: { role: "user", text },
          },
          onEvent,
        );
      }
      if (event.message.role === "assistant") {
        const text = contentText(event.message.content);
        const reasoning = extractAssistantReasoning(event.message);
        const usage = mapModelUsage(event.message.usage);
        const usageAccounting = createUsageAccounting(
          { provider: event.message.provider, id: event.message.model },
          usage,
        );
        const toolCalls = event.message.content
          .filter((block) => block.type === "toolCall")
          .map((block) => ({
            id: block.id,
            name: block.name,
            arguments: toolResultLifecycle.toolCallArguments(
              block.arguments,
              toolCallArgumentsLedgerProjection(block.name, block.arguments),
            ),
          }));
        const hasToolCalls = toolCalls.length > 0;
        const modelFailure =
          event.message.stopReason === "error" ||
          event.message.stopReason === "aborted";
        const modelFailureDiagnostic =
          event.message.errorMessage?.trim() ||
          (event.message.stopReason === "aborted"
            ? "Model call was aborted."
            : "Model call failed.");
        const responseEvent = await this.record(
          {
            threadId: run.threadId,
            runId: run.id,
            type: "model.response",
            category: "model",
            visibility: "debug",
            payload: {
              ...privateSourceContent.modelProjection({
                text,
                reasoning,
                defaultRedacted:
                  modelFailure ||
                  (!hasToolCalls && modelAdvisorPolicy.mode === "enforce"),
                ...(modelFailure ? { error: modelFailureDiagnostic } : {}),
              }),
              model: `${event.message.provider}/${event.message.model}`,
              stopReason: event.message.stopReason,
              ...(modelContextEnvelope
                ? {
                    modelContextEnvelopeSha256:
                      modelContextEnvelope.contentSha256,
                    modelContextEnvelopeTurnIndex:
                      modelContextEnvelope.turnIndex,
                    modelContextMessageSetSha256:
                      modelContextEnvelope.messageSetSha256,
                    modelContextToolDefinitionSetSha256:
                      modelContextEnvelope.toolDefinitionSetSha256,
                  }
                : {}),
              usage,
              usageAccounting,
              toolCalls: toJsonValue(toolCalls),
            },
          },
          onEvent,
        );
        await calibrateResponse(this, run, responseEvent, event.message, onEvent);
        budget.observePrimaryUsage(usage, Date.now(), usageAccounting);
        if (modelFailure)
          throw modelFailureError(
            event.message.stopReason === "aborted" ? "aborted" : "error",
            event.message.errorMessage,
          );
        if (hasToolCalls) return undefined;
        await this.recordModelAdvisorGate(
          run,
          text,
          { provider: event.message.provider, id: event.message.model },
          advisorReviewPrompt,
          source,
          modelAdvisorPolicy,
          signal,
          budget,
          onEvent,
        );
        await this.record(
          {
            threadId: run.threadId,
            runId: run.id,
            type: "message.assistant",
            category: "message",
            visibility: "user",
            payload: {
              role: "assistant",
              text,
              ...privateSourceContent.reasoningProjection(reasoning),
              model: `${event.message.provider}/${event.message.model}`,
              usage,
              usageAccounting,
            },
          },
          onEvent,
        );
        return text;
      }
      return undefined;
    }
    if (event.type === "tool_execution_start") {
      await this.record(
        {
          threadId: run.threadId,
          runId: run.id,
          type: "tool.started",
          category: "tool",
          visibility: "user",
          payload: {
            callId: event.toolCallId,
            toolName: event.toolName,
            status: "started",
            callInputSha256: createToolCallSha256(event.toolName, event.args),
            ...builtInToolHarnessProjection(event.toolName, event.args),
            ...toolResultLifecycle.toolInput(
              event.args,
              toolInputLedgerProjection(event.toolName, event.args),
            ),
            ...toolResultLifecycle.startedProjection(
              event.toolName,
              event.args,
            ),
            ...toolResultLifecycle.protocolProjection(
              event.toolCallId, event.toolName, "started", event.args),
          },
        },
        onEvent,
      );
      return undefined;
    }
    if (event.type === "tool_execution_end") {
      privateSourceContent.observeToolResult(event.toolName);
      const output = agentToolResultText(event.result);
      const reusedProjection = toolResultLifecycle.reusedTerminalProjection(
        event.toolCallId,
      );
      const outputProjection = reusedProjection
        ? {}
        : toolOutputLedgerProjection(event.toolName, output, event.result);
      await this.record(
        {
          threadId: run.threadId,
          runId: run.id,
          type: event.isError ? "tool.failed" : "tool.completed",
          category: "tool",
          visibility: "user",
          payload: {
            callId: event.toolCallId,
            toolName: event.toolName,
            status: event.isError ? "failed" : "completed",
            outputTextSha256: sha256Text(output),
            outputTextBytes: Buffer.byteLength(output, "utf8"),
            ...(reusedProjection
              ? reusedProjection
              : {
                  ...outputProjection,
                  ...agentToolGenericDetailsLedgerProjection(
                    event.toolName,
                    outputProjection,
                    event.result.details,
                  ),
                }),
            ...toolResultLifecycle.protocolProjection(event.toolCallId,
              event.toolName, event.isError ? "failed" : "completed"),
          },
        },
        onEvent,
      );
      if (["delegate_task", "subagent_collect"].includes(event.toolName)) {
        budget.syncSubagentUsage(
          this.store.listSubagentTasks(run.threadId, run.id),
        );
      }
    }
    return undefined;
  }

  private async recordModelAdvisorGate(
    run: RunRecord,
    assistantText: string,
    candidateModel: ModelRef,
    advisorReviewPrompt: string,
    source: TurnSource,
    modelAdvisorPolicy: ReturnType<typeof effectiveModelAdvisorPolicy>,
    signal: AbortSignal,
    budget: RunBudgetTracker,
    onEvent?: EventSink,
  ): Promise<void> {
    const runEvents = await this.store.listRunEvents(run.id);
    const notice = createModelAdvisorNotice({
      assistantText,
      runEvents,
      turnSource: source,
      policy: modelAdvisorPolicy,
    });
    if (notice) {
      await this.record(
        {
          threadId: run.threadId,
          runId: run.id,
          type: isModelAdvisorBlocked(notice)
            ? "model.advisor.blocked"
            : "model.advisor.notice",
          category: "system",
          visibility: "debug",
          payload: toJsonValue(notice),
        },
        onEvent,
      );
    }
    let independentReview:
      | Awaited<ReturnType<typeof reviewIndependentModelAdvisorCandidate>>
      | undefined;
    if (
      (!notice || !isModelAdvisorBlocked(notice)) &&
      modelAdvisorPolicy.mode !== "off" &&
      modelAdvisorPolicy.reviewModel
    ) {
      budget.assertCanStartAuxiliaryCall();
      independentReview = await reviewIndependentModelAdvisorCandidate(
        this.modelRegistry,
        {
          turnSource: source,
          turnPrompt: advisorReviewPrompt,
          candidateText: assistantText,
          candidateModel,
          reviewerModel: modelAdvisorPolicy.reviewModel,
          runEvents,
          signal,
        },
      );
      const usageAccounting = createUsageAccounting(
        modelAdvisorPolicy.reviewModel,
        independentReview.review.usage,
      );
      budget.observeAuxiliaryUsage(
        independentReview.review.usage,
        Date.now(),
        usageAccounting,
      );
      await this.record(
        {
          threadId: run.threadId,
          runId: run.id,
          type: INDEPENDENT_MODEL_ADVISOR_REVIEWED_EVENT,
          category: "system",
          visibility: "debug",
          payload: toJsonValue(independentReview.review),
        },
        onEvent,
      );
    }
    const block = createCombinedModelAdvisorBlock({
      ...(notice ? { notice } : {}),
      ...(independentReview
        ? {
            review: independentReview.review,
            reviewGuidance: independentReview.guidance,
          }
        : {}),
      policy: modelAdvisorPolicy,
    });
    if (!block) return;
    if (notice && isModelAdvisorBlocked(notice) && !independentReview) {
      throw new ModelAdvisorBlockedError(notice);
    }
    throw new CombinedModelAdvisorBlockedError(block);
  }

  private async recordModelAdvisorCorrectionRequest(
    run: RunRecord,
    request: ModelAdvisorCorrectionRequest,
    onEvent?: EventSink,
  ): Promise<void> {
    await this.record(
      {
        threadId: run.threadId,
        runId: run.id,
        type: "model.advisor.correction.requested",
        category: "system",
        visibility: "debug",
        payload: toJsonValue(request.payload),
      },
      onEvent,
    );
  }

  private async recordModelAdvisorCorrectionOutcome(
    run: RunRecord,
    outcome: ReturnType<typeof createModelAdvisorCorrectionOutcome>,
    onEvent?: EventSink,
  ): Promise<void> {
    await this.record(
      {
        threadId: run.threadId,
        runId: run.id,
        type: "model.advisor.correction.outcome",
        category: "system",
        visibility: "debug",
        payload: toJsonValue(outcome),
      },
      onEvent,
    );
  }

  private async buildModelHistory(
    run: RunRecord,
    model: Model<Api>,
    signal: AbortSignal,
    budget: RunBudgetTracker,
    nextModelContextEnvelopeTurnIndex: () => number,
    onEvent?: EventSink,
  ): Promise<{
    messages: AgentMessage[];
    checkpoint?: ContextCheckpointSnapshot;
    rawMessageCount: number;
    toolExchangeCount: number;
    omittedToolExchangeCount: number;
    compacted: boolean;
  }> {
    if (isWorkflowRunSource(run.source)) {
      return {
        messages: [],
        rawMessageCount: 0,
        toolExchangeCount: 0,
        omittedToolExchangeCount: 0,
        compacted: false,
      };
    }
    const events = await this.contextEvents.read(run.threadId);
    const importedEventCount = localImportedThroughSeq(
      this.store.getThread(run.threadId).importProvenance,
    );
    const priorCheckpoint = latestValidContextCheckpoint(events);
    const plan = planContextProjection(events, priorCheckpoint, {
      maxHistoryCharacters: contextHistoryCharacterBudget(model),
    });
    let checkpoint = priorCheckpoint;
    let compacted = false;
    let projectedEvents = plan.recentEvents;
    if (plan.needsCompaction) {
      const fromSeq = plan.compactEvents[0]?.seq;
      const toSeq = plan.compactEvents.at(-1)?.seq;
      const retainedFromSeq = plan.recentEvents[0]?.seq ?? (toSeq ?? 0) + 1;
      await this.record(
        {
          threadId: run.threadId,
          runId: run.id,
          type: "context.compaction.started",
          category: "model",
          visibility: "debug",
          payload: {
            fromSeq: fromSeq ?? 0,
            toSeq: toSeq ?? 0,
            retainedFromSeq,
            sourceEventCount: plan.compactEvents.length,
            ...(priorCheckpoint
              ? { parentCheckpointId: priorCheckpoint.checkpointId }
              : {}),
          },
        },
        onEvent,
      );
      let compactorUsage: Usage | undefined;
      let compactorUsageAccounting: UsageAccounting | undefined;
      budget.assertCanStartAuxiliaryCall();
      try {
        const prompt = buildContextCompactionMessages(
          priorCheckpoint,
          plan.deltaEvents,
          plan.deltaContinuityEvents,
        );
        const modelOptions = {
          signal,
          maxTokens: 1_200,
          temperature: 0,
        } satisfies SimpleStreamOptions;
        const rawRequestContext = {
          systemPrompt: prompt.system,
          messages: [
            {
              role: "user" as const,
              content: prompt.user,
              timestamp: Date.now(),
            },
          ],
          tools: [],
        };
        const prepared = await captureCompiledModelInvocation({
          store: this.store,
          capsules: this.modelInvocationCapsules,
          run,
          model,
          context: rawRequestContext,
          options: modelOptions,
          turnIndex: nextModelContextEnvelopeTurnIndex(),
          purpose: "context_compaction",
          compiledPrompt: compileAuxiliaryPrompt({
            purpose: "context_compaction",
            sourceId: "task.context_compaction",
            systemPrompt: prompt.system,
            adapter: modelAdapterReceipt(model, modelOptions),
          }),
          ...(onEvent ? { onEvent } : {}),
        });
        const { context: requestContext, envelope } = prepared;
        let response: AssistantMessage;
        try {
          response = await this.modelRegistry.models.completeSimple(
            model,
            requestContext,
            modelOptions,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          await this.record(
            {
              threadId: run.threadId,
              runId: run.id,
              type: "model.response",
              category: "model",
              visibility: "debug",
              payload: {
                modelCallPurpose: "context_compaction",
                errorSha256: sha256Text(message),
                errorBytes: Buffer.byteLength(message, "utf8"),
                contentRedacted: true,
                model: `${model.provider}/${model.id}`,
                stopReason: "error",
                modelContextEnvelopeSha256: envelope.contentSha256,
                modelContextEnvelopeTurnIndex: envelope.turnIndex,
                modelContextMessageSetSha256: envelope.messageSetSha256,
                modelContextToolDefinitionSetSha256:
                  envelope.toolDefinitionSetSha256,
              },
            },
            onEvent,
          );
          throw error;
        }
        const responseText = contentText(response.content);
        await this.record(
          {
            threadId: run.threadId,
            runId: run.id,
            type: "model.response",
            category: "model",
            visibility: "debug",
            payload: {
              modelCallPurpose: "context_compaction",
              textSha256: sha256Text(responseText),
              textBytes: Buffer.byteLength(responseText, "utf8"),
              contentRedacted: true,
              model: `${model.provider}/${model.id}`,
              ...(response.stopReason
                ? { stopReason: response.stopReason }
                : {}),
              modelContextEnvelopeSha256: envelope.contentSha256,
              modelContextEnvelopeTurnIndex: envelope.turnIndex,
              modelContextMessageSetSha256: envelope.messageSetSha256,
              modelContextToolDefinitionSetSha256:
                envelope.toolDefinitionSetSha256,
            },
          },
          onEvent,
        );
        compactorUsage = mapModelUsage(response.usage);
        compactorUsageAccounting = createUsageAccounting(
          modelRefFromModel(model),
          compactorUsage,
        );
        budget.observeAuxiliaryUsage(
          compactorUsage,
          Date.now(),
          compactorUsageAccounting,
        );
        checkpoint = createContextCheckpoint({
          checkpointId: createId("checkpoint"),
          ...(priorCheckpoint ? { parent: priorCheckpoint } : {}),
          compactEvents: plan.compactEvents,
          continuityEvents: plan.compactContinuityEvents,
          retainedFromSeq,
          result: parseContextCompactionResponse(responseText),
        });
        await this.record(
          {
            threadId: run.threadId,
            runId: run.id,
            type: "context.compaction.completed",
            category: "model",
            visibility: "user",
            payload: toJsonValue({
              ...checkpoint,
              usage: compactorUsage,
              usageAccounting: compactorUsageAccounting,
            }),
          },
          onEvent,
        );
        compacted = true;
      } catch (error) {
        if (signal.aborted) throw error;
        const uncoveredEvents = contextMessageEvents(events).filter(
          (event) => !priorCheckpoint || event.seq > priorCheckpoint.toSeq,
        );
        projectedEvents = uncoveredEvents.slice(-24);
        const omittedMessageCount = Math.max(
          0,
          uncoveredEvents.length - projectedEvents.length,
        );
        await this.record(
          {
            threadId: run.threadId,
            runId: run.id,
            type: "context.compaction.failed",
            category: "model",
            visibility: "user",
            payload: {
              fromSeq: fromSeq ?? 0,
              toSeq: toSeq ?? 0,
              retainedFromSeq,
              sourceEventCount: plan.compactEvents.length,
              fallbackMessageCount: projectedEvents.length,
              omittedMessageCount,
              message: error instanceof Error ? error.message : String(error),
              ...(compactorUsage ? { usage: compactorUsage } : {}),
              ...(compactorUsageAccounting
                ? { usageAccounting: compactorUsageAccounting }
                : {}),
            },
          },
          onEvent,
        );
        checkpoint = priorCheckpoint;
      }
      budget.throwIfExhausted();
    }
    const surface = await projectConversationSurface({
      events,
      textEvents: projectedEvents,
      model,
      importedEventCount,
      projectionRun: run,
      minimumEventSeq:
        plan.needsCompaction && !compacted
          ? (projectedEvents[0]?.seq ??
            (checkpoint?.toSeq !== undefined ? checkpoint.toSeq + 1 : 1))
          : checkpoint?.toSeq !== undefined
            ? checkpoint.toSeq + 1
            : 1,
      capsules: this.conversationSurfaceCapsules,
      resultCapsules: this.toolInvocationResultCapsules,
      modelInvocationCapsules: this.modelInvocationCapsules,
    });
    return {
      messages: surface.messages,
      ...(checkpoint ? { checkpoint } : {}),
      rawMessageCount: projectedEvents.length,
      toolExchangeCount: surface.toolExchangeCount,
      omittedToolExchangeCount: surface.omittedToolExchangeCount,
      compacted,
    };
  }
  private async evaluateActiveGoal(
    threadId: string,
    runId: string,
    assistantText: string,
    model: Model<Api> | undefined,
    signal: AbortSignal,
    budget: RunBudgetTracker,
    nextModelContextEnvelopeTurnIndex: () => number,
    onEvent?: EventSink,
  ): Promise<GoalState | undefined> {
    const thread = this.store.getThread(threadId);
    if (!thread.goal || thread.goal.status !== "active") return;
    await this.record(
      {
        threadId,
        runId,
        type: "goal.evaluation.started",
        category: "goal",
        visibility: "debug",
        payload: {
          continuation: thread.goal.continuationCount,
          objective: thread.goal.objective,
        },
      },
      onEvent,
    );

    let evaluation: GoalEvaluation;
    let evaluationUsage: Usage | undefined;
    let evaluationUsageAccounting: UsageAccounting | undefined;
    if (model) budget.assertCanStartAuxiliaryCall();
    try {
      if (model) {
        const response = await this.requestGoalEvaluation(
          thread.goal,
          threadId,
          runId,
          model,
          signal,
          nextModelContextEnvelopeTurnIndex,
          onEvent,
        );
        evaluationUsage = mapModelUsage(response.usage);
        evaluationUsageAccounting = createUsageAccounting(
          modelRefFromModel(model),
          evaluationUsage,
        );
        budget.observeAuxiliaryUsage(
          evaluationUsage,
          Date.now(),
          evaluationUsageAccounting,
        );
        evaluation = parseGoalEvaluationResponse(contentText(response.content));
      } else {
        evaluation = {
          satisfied: false,
          blocker: "missing_evidence",
          reason:
            "The deterministic demo model cannot independently verify goal completion.",
          evidence: assistantText.replace(/\s+/g, " ").trim().slice(0, 800),
        };
      }
    } catch (error) {
      if (signal.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      evaluation = {
        satisfied: false,
        blocker: "missing_evidence",
        reason: `Goal evaluation failed closed: ${message}`.slice(0, 1_000),
        evidence: "",
      };
      await this.record(
        {
          threadId,
          runId,
          type: "goal.evaluation.failed",
          category: "goal",
          visibility: "debug",
          payload: {
            message,
            ...(evaluationUsage ? { usage: evaluationUsage } : {}),
            ...(evaluationUsageAccounting
              ? { usageAccounting: evaluationUsageAccounting }
              : {}),
          },
        },
        onEvent,
      );
    }

    const goal = applyGoalEvaluation(
      thread.goal,
      evaluation,
      assistantText,
      runId,
    );
    await this.store.setGoal(threadId, goal);
    await this.record(
      {
        threadId,
        runId,
        type: "goal.evaluated",
        category: "goal",
        visibility: "user",
        payload: {
          status: goal.status,
          blocker: goal.blocker,
          reason: goal.reason,
          evidence: goal.evidence,
          satisfied: evaluation.satisfied,
          continuationCount: goal.continuationCount,
          noProgressCount: goal.noProgressCount,
          ...(evaluationUsage ? { usage: evaluationUsage } : {}),
          ...(evaluationUsageAccounting
            ? { usageAccounting: evaluationUsageAccounting }
            : {}),
        },
      },
      onEvent,
    );
    budget.throwIfExhausted();
    return goal;
  }

  private async requestGoalEvaluation(
    goal: GoalState,
    threadId: string,
    runId: string,
    model: Model<Api>,
    signal: AbortSignal,
    nextModelContextEnvelopeTurnIndex: () => number,
    onEvent?: EventSink,
  ): Promise<AssistantMessage> {
    const conversation = await this.buildVisibleConversation(threadId);
    const prompt = buildGoalEvaluatorMessages(goal, conversation);
    const modelOptions = {
      signal,
      maxTokens: 512,
      temperature: 0,
    } satisfies SimpleStreamOptions;
    const rawRequestContext = {
      systemPrompt: prompt.system,
      messages: [
        {
          role: "user" as const,
          content: prompt.user,
          timestamp: Date.now(),
        },
      ],
      tools: [],
    };
    const prepared = await captureCompiledModelInvocation({
      store: this.store,
      capsules: this.modelInvocationCapsules,
      run: this.requireRun(threadId, runId),
      model,
      context: rawRequestContext,
      options: modelOptions,
      turnIndex: nextModelContextEnvelopeTurnIndex(),
      purpose: "goal_evaluation",
      compiledPrompt: compileAuxiliaryPrompt({
        purpose: "goal_evaluation",
        sourceId: "task.goal_evaluation",
        systemPrompt: prompt.system,
        adapter: modelAdapterReceipt(model, modelOptions),
      }),
      ...(onEvent ? { onEvent } : {}),
    });
    const { context: requestContext, envelope } = prepared;
    try {
      const response = await this.modelRegistry.models.completeSimple(
        model,
        requestContext,
        modelOptions,
      );
      const text = contentText(response.content);
      await this.record(
        {
          threadId,
          runId,
          type: "model.response",
          category: "model",
          visibility: "debug",
          payload: {
            modelCallPurpose: "goal_evaluation",
            textSha256: sha256Text(text),
            textBytes: Buffer.byteLength(text, "utf8"),
            contentRedacted: true,
            model: `${model.provider}/${model.id}`,
            ...(response.stopReason ? { stopReason: response.stopReason } : {}),
            modelContextEnvelopeSha256: envelope.contentSha256,
            modelContextEnvelopeTurnIndex: envelope.turnIndex,
            modelContextMessageSetSha256: envelope.messageSetSha256,
            modelContextToolDefinitionSetSha256:
              envelope.toolDefinitionSetSha256,
          },
        },
        onEvent,
      );
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.record(
        {
          threadId,
          runId,
          type: "model.response",
          category: "model",
          visibility: "debug",
          payload: {
            modelCallPurpose: "goal_evaluation",
            errorSha256: sha256Text(message),
            errorBytes: Buffer.byteLength(message, "utf8"),
            contentRedacted: true,
            model: `${model.provider}/${model.id}`,
            stopReason: "error",
            modelContextEnvelopeSha256: envelope.contentSha256,
            modelContextEnvelopeTurnIndex: envelope.turnIndex,
            modelContextMessageSetSha256: envelope.messageSetSha256,
            modelContextToolDefinitionSetSha256:
              envelope.toolDefinitionSetSha256,
          },
        },
        onEvent,
      );
      throw error;
    }
  }

  private async maybeGenerateThreadTitle(options: {
    threadId: string;
    runId: string;
    model: Model<Api> | undefined;
    source: TurnSource;
    workflowInvocation: boolean;
    signal: AbortSignal;
  }): Promise<void> {
    const { threadId, model, signal } = options;
    if (options.workflowInvocation || options.source !== "user") return;
    if (signal.aborted) return;
    if (!isDefaultThreadTitle(this.store.getThread(threadId).title)) return;
    const firstUserText = await this.firstUserMessageText(threadId);
    if (!firstUserText) return;
    const isDemo =
      !model || (model.provider === "napier" && model.id === "demo");
    let title: string | undefined;
    if (!isDemo) {
      try {
        const prompt = buildThreadTitleMessages(firstUserText);
        const response = await this.modelRegistry.models.completeSimple(
          model,
          {
            systemPrompt: prompt.system,
            messages: [
              { role: "user", content: prompt.user, timestamp: Date.now() },
            ],
            tools: [],
          },
          { signal, maxTokens: 40, temperature: 0.2 },
        );
        title = parseThreadTitleResponse(contentText(response.content));
      } catch {
        // Titling is best-effort; fall back to prompt derivation below.
      }
    }
    const resolved = title ?? deriveThreadTitleFromPrompt(firstUserText);
    if (resolved) await this.store.setThreadTitleIfDefault(threadId, resolved);
  }

  private async firstUserMessageText(
    threadId: string,
  ): Promise<string | undefined> {
    const thread = this.store.getThread(threadId);
    const event = (
      await this.store.listEventsRange(threadId, 1, thread.eventCount, [
        "message.user",
      ])
    )[0];
    const payload = event?.payload;
    if (!payload || Array.isArray(payload) || typeof payload !== "object") {
      return undefined;
    }
    const text = payload["text"];
    return typeof text === "string" && text.trim() ? text : undefined;
  }

  private async proposeMemoriesFromRun(
    threadId: string,
    runId: string,
    agentId: string,
    model: Model<Api>,
    signal: AbortSignal,
    budget: RunBudgetTracker,
    nextModelContextEnvelopeTurnIndex: () => number,
    onEvent?: EventSink,
  ): Promise<void> {
    const conversation = await this.buildRunConversation(runId);
    if (!conversation) return;
    if (!budget.canStartOptionalAuxiliaryCall()) {
      await this.record(
        {
          threadId,
          runId,
          type: "memory.extraction.skipped",
          category: "memory",
          visibility: "debug",
          payload: toJsonValue({
            reason: "run_budget",
            observed: budget.observed(),
            limits: budget.limits,
          }),
        },
        onEvent,
      );
      return;
    }
    budget.assertCanStartAuxiliaryCall();
    const visibleMemories = this.store.listMemories({ agentId });
    const pendingCorrectionTargets = new Set(
      visibleMemories
        .filter((fact) => fact.status === "proposed")
        .flatMap(memoryReplacementTargetIds),
    );
    const correctionCandidates = visibleMemories.filter(
      (fact) =>
        (fact.status === "active" || fact.status === "stale") &&
        !fact.supersededByMemoryId &&
        !pendingCorrectionTargets.has(fact.id),
    );
    const prompt = buildMemoryExtractorMessages(
      conversation,
      correctionCandidates,
    );
    await this.record(
      {
        threadId,
        runId,
        type: "memory.extraction.started",
        category: "memory",
        visibility: "debug",
        payload: {
          correctionCandidateIds: prompt.correctionCandidateIds,
          correctionInventorySha256: prompt.correctionInventorySha256,
          correctionInventoryTruncated: prompt.correctionInventoryTruncated,
          replacementCandidateIds: prompt.replacementCandidateIds,
          replacementInventorySha256: prompt.replacementInventorySha256,
          replacementInventoryTruncated: prompt.replacementInventoryTruncated,
        },
      },
      onEvent,
    );
    let extractionUsage: Usage | undefined;
    let extractionUsageAccounting: UsageAccounting | undefined;
    try {
      const modelOptions = {
        signal,
        maxTokens: 700,
        temperature: 0,
      } satisfies SimpleStreamOptions;
      const rawRequestContext = {
        systemPrompt: prompt.system,
        messages: [
          {
            role: "user" as const,
            content: prompt.user,
            timestamp: Date.now(),
          },
        ],
        tools: [],
      };
      const prepared = await captureCompiledModelInvocation({
        store: this.store,
        capsules: this.modelInvocationCapsules,
        run: this.requireRun(threadId, runId),
        model,
        context: rawRequestContext,
        options: modelOptions,
        turnIndex: nextModelContextEnvelopeTurnIndex(),
        purpose: "memory_extraction",
        compiledPrompt: compileAuxiliaryPrompt({
          purpose: "memory_extraction",
          sourceId: "task.memory_extraction",
          systemPrompt: prompt.system,
          adapter: modelAdapterReceipt(model, modelOptions),
        }),
        ...(onEvent ? { onEvent } : {}),
      });
      const { context: requestContext, envelope } = prepared;
      let response: AssistantMessage;
      try {
        response = await this.modelRegistry.models.completeSimple(
          model,
          requestContext,
          modelOptions,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.record(
          {
            threadId,
            runId,
            type: "model.response",
            category: "model",
            visibility: "debug",
            payload: {
              modelCallPurpose: "memory_extraction",
              errorSha256: sha256Text(message),
              errorBytes: Buffer.byteLength(message, "utf8"),
              contentRedacted: true,
              model: `${model.provider}/${model.id}`,
              stopReason: "error",
              modelContextEnvelopeSha256: envelope.contentSha256,
              modelContextEnvelopeTurnIndex: envelope.turnIndex,
              modelContextMessageSetSha256: envelope.messageSetSha256,
              modelContextToolDefinitionSetSha256:
                envelope.toolDefinitionSetSha256,
            },
          },
          onEvent,
        );
        throw error;
      }
      const responseText = contentText(response.content);
      await this.record(
        {
          threadId,
          runId,
          type: "model.response",
          category: "model",
          visibility: "debug",
          payload: {
            modelCallPurpose: "memory_extraction",
            textSha256: sha256Text(responseText),
            textBytes: Buffer.byteLength(responseText, "utf8"),
            contentRedacted: true,
            model: `${model.provider}/${model.id}`,
            ...(response.stopReason ? { stopReason: response.stopReason } : {}),
            modelContextEnvelopeSha256: envelope.contentSha256,
            modelContextEnvelopeTurnIndex: envelope.turnIndex,
            modelContextMessageSetSha256: envelope.messageSetSha256,
            modelContextToolDefinitionSetSha256:
              envelope.toolDefinitionSetSha256,
          },
        },
        onEvent,
      );
      extractionUsage = mapModelUsage(response.usage);
      extractionUsageAccounting = createUsageAccounting(
        modelRefFromModel(model),
        extractionUsage,
      );
      budget.observeAuxiliaryUsage(
        extractionUsage,
        Date.now(),
        extractionUsageAccounting,
      );
      const proposals = parseMemoryProposalResponse(
        responseText,
        prompt.replacementCandidateIds,
      );
      const correctionTargets = new Map(
        correctionCandidates.map((fact) => [fact.id, fact]),
      );
      const knownIds = new Set(
        this.store.listMemories().map((fact) => fact.id),
      );
      let createdCount = 0;
      for (const proposal of proposals) {
        const replacementTargetIds = memoryReplacementTargetIds(proposal);
        const replacementTargets = replacementTargetIds.map((targetId) => {
          const target = correctionTargets.get(targetId);
          if (!target) {
            throw new Error(
              `Memory replacement target left extraction inventory: ${targetId}`,
            );
          }
          return target;
        });
        const firstTarget = replacementTargets[0];
        const scope = firstTarget?.scope ?? "agent";
        const effectiveAgentId =
          scope === "agent" ? (firstTarget?.agentId ?? agentId) : undefined;
        if (
          replacementTargets.some(
            (target) =>
              target.scope !== scope || target.agentId !== effectiveAgentId,
          )
        ) {
          throw new Error(
            "Memory consolidation targets must share scope and Agent",
          );
        }
        const fact = await this.store.proposeMemory(
          {
            ...proposal,
            scope,
            ...(effectiveAgentId ? { agentId: effectiveAgentId } : {}),
            threadId,
          },
          { type: "conversation", threadId, runId },
        );
        if (knownIds.has(fact.id)) continue;
        knownIds.add(fact.id);
        createdCount += 1;
        await this.record(
          {
            threadId,
            runId,
            type: "memory.proposed",
            category: "memory",
            visibility: "user",
            payload: {
              memoryId: fact.id,
              content: fact.content,
              category: fact.category,
              confidence: fact.confidence,
              scope: fact.scope,
              reviewIntervalDays: fact.reviewIntervalDays,
              ...(fact.agentId ? { agentId: fact.agentId } : {}),
              ...(fact.supersedesMemoryId
                ? { supersedesMemoryId: fact.supersedesMemoryId }
                : {}),
              ...(fact.consolidatesMemoryIds
                ? { consolidatesMemoryIds: fact.consolidatesMemoryIds }
                : {}),
            },
          },
          onEvent,
        );
      }
      await this.record(
        {
          threadId,
          runId,
          type: "memory.extraction.completed",
          category: "memory",
          visibility: "debug",
          payload: {
            proposed: proposals.length,
            created: createdCount,
            corrections: proposals.filter(
              (proposal) => proposal.supersedesMemoryId,
            ).length,
            consolidations: proposals.filter(
              (proposal) => proposal.consolidatesMemoryIds,
            ).length,
            usage: extractionUsage,
            usageAccounting: extractionUsageAccounting,
          },
        },
        onEvent,
      );
    } catch (error) {
      if (signal.aborted) throw error;
      await this.record(
        {
          threadId,
          runId,
          type: "memory.extraction.failed",
          category: "memory",
          visibility: "debug",
          payload: {
            message: error instanceof Error ? error.message : String(error),
            ...(extractionUsage ? { usage: extractionUsage } : {}),
            ...(extractionUsageAccounting
              ? { usageAccounting: extractionUsageAccounting }
              : {}),
          },
        },
        onEvent,
      );
    }
    budget.throwIfExhausted();
  }

  private async buildRunConversation(runId: string): Promise<string> {
    return (
      await this.store.listRunEvents(runId, 0, [
        "message.user",
        "message.assistant",
      ])
    )
      .flatMap((event): string[] => {
        if (
          !event.payload ||
          Array.isArray(event.payload) ||
          typeof event.payload !== "object"
        ) {
          return [];
        }
        const text = event.payload["text"];
        if (typeof text !== "string" || !text.trim()) return [];
        return [
          `${event.type === "message.user" ? "User" : "Assistant"}: ${text.trim()}`,
        ];
      })
      .join("\n\n")
      .slice(-12_000);
  }

  private async blockGoalForRunFailure(
    threadId: string,
    runId: string,
    message: string,
    onEvent?: EventSink,
  ): Promise<void> {
    const activeGoal = this.store.getThread(threadId).goal;
    if (!activeGoal || activeGoal.status !== "active") return;
    const evaluation: GoalEvaluation = {
      satisfied: false,
      blocker: "run_failed",
      reason:
        `The run failed before the goal could be verified: ${message}`.slice(
          0,
          1_000,
        ),
      evidence: "",
    };
    const goal = applyGoalEvaluation(activeGoal, evaluation, "", runId);
    await this.store.setGoal(threadId, goal);
    await this.record(
      {
        threadId,
        runId,
        type: "goal.evaluated",
        category: "goal",
        visibility: "user",
        payload: {
          status: goal.status,
          blocker: goal.blocker,
          reason: goal.reason,
          evidence: goal.evidence,
          satisfied: false,
          continuationCount: goal.continuationCount,
          noProgressCount: goal.noProgressCount,
        },
      },
      onEvent,
    );
  }

  private requireRun(threadId: string, runId: string): RunRecord {
    const run = this.store
      .listRuns(threadId)
      .find((candidate) => candidate.id === runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    return run;
  }

  private async buildVisibleConversation(threadId: string): Promise<string> {
    const events = await this.contextEvents.read(threadId);
    const checkpoint = latestValidContextCheckpoint(events);
    const messages = events
      .filter(
        (event) =>
          (!checkpoint || event.seq > checkpoint.toSeq) &&
          (event.type === "message.user" || event.type === "message.assistant"),
      )
      .slice(-30)
      .flatMap((event): string[] => {
        if (
          !event.payload ||
          Array.isArray(event.payload) ||
          typeof event.payload !== "object"
        ) {
          return [];
        }
        const text = event.payload["text"];
        if (typeof text !== "string" || !text.trim()) return [];
        const role = event.type === "message.user" ? "User" : "Assistant";
        return [`${role}: ${text.trim()}`];
      })
      .join("\n\n");
    const recent =
      messages.length <= 12_000 ? messages : messages.slice(-12_000);
    return [checkpoint ? formatContextCheckpoint(checkpoint) : "", recent]
      .filter(Boolean)
      .join("\n\n");
  }

  private async record(
    input: Parameters<LocalStore["appendEvent"]>[0],
    onEvent?: EventSink,
  ): Promise<RunEvent> {
    const event = await this.store.appendEvent(input);
    if (onEvent) {
      try {
        await onEvent(event);
      } catch {
        // A disconnected stream must not cancel durable agent execution.
      }
    }
    return event;
  }
  private async collectRunUsage(runId: string): Promise<Usage> {
    return this.store.aggregateRunUsage(runId);
  }
}

function turnPromptEvent(source: TurnSource) {
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
