import { ensureCurrentCapabilityBindings } from "./agent-capability-bindings.js";
import {
  createAgentProfileRevision,
  DEFAULT_RUN_LIMITS,
  DEFAULT_SUBAGENT_LIMITS,
  normalizeRunLimits,
  normalizeSubagentLimits,
  validateAgentProfileRevision,
} from "./agents.js";
import {
  DEFAULT_INBOUND_RETRY_POLICY,
  deriveInboundChannelPolicyTemplate,
  MAX_INBOUND_ATTEMPTS,
  MAX_INBOUND_RETRY_BASE_MS,
  MIN_INBOUND_RETRY_BASE_MS,
  normalizeInboundChannelAdapter,
  normalizeInboundRetryPolicy,
  normalizeInboundSignaturePolicy,
} from "./inbound-channel-policy.js";
import {
  DEFAULT_MEMORY_REVIEW_INTERVAL_DAYS,
  memoryReplacementTargetIds,
  memoryReviewDueAt,
  normalizeMemoryConsolidationIds,
  normalizeMemoryReviewInterval,
} from "./memory.js";
import { refreshPlanProjection } from "./plans.js";
import type { PersistedStoreState } from "./store-state.js";

const MEMORY_STATUSES = new Set([
  "proposed",
  "active",
  "stale",
  "rejected",
  "archived",
]);
export function normalizePersistedStoreState(
  state: PersistedStoreState,
  statePath: string,
): boolean {
  if (
    state.version !== 1 ||
    !Array.isArray(state.agents) ||
    !Array.isArray(state.threads) ||
    !Array.isArray(state.runs)
  ) {
    throw new Error(`Unsupported or invalid Napier state at ${statePath}`);
  }
  const migrateAgentRevisions = !Array.isArray(state.agentRevisions);
  normalizeWorkspaceCollections(state, migrateAgentRevisions);
  normalizeExtensionCollections(state);
  normalizeReceiptCollections(state);
  normalizeEvaluationCollections(state);
  normalizePlanningCollections(state);
  normalizeOperationalCollections(state);
  return migrateAgentRevisions;
}

function normalizeWorkspaceCollections(
  state: PersistedStoreState,
  migrateAgentRevisions: boolean,
): void {
  if (migrateAgentRevisions) state.agentRevisions = [];
  if (!Array.isArray(state.memories)) state.memories = [];
  if (!Array.isArray(state.subagents)) state.subagents = [];
}

function normalizeExtensionCollections(state: PersistedStoreState): void {
  if (!Array.isArray(state.extensions)) state.extensions = [];
  if (!Array.isArray(state.extensionPackageRolloutChannels)) {
    state.extensionPackageRolloutChannels = [];
  }
  if (!Array.isArray(state.extensionPublisherTrustAnchors)) {
    state.extensionPublisherTrustAnchors = [];
  }
  if (!Array.isArray(state.skillPackageInstallations)) {
    state.skillPackageInstallations = [];
  }
}

function normalizeEvaluationCollections(state: PersistedStoreState): void {
  if (!Array.isArray(state.evaluations)) state.evaluations = [];
  if (!Array.isArray(state.evaluationAdjudications)) {
    state.evaluationAdjudications = [];
  }
  if (!Array.isArray(state.evaluationReviewerBallots)) {
    state.evaluationReviewerBallots = [];
  }
  if (!Array.isArray(state.evaluationConsensusResolutions)) {
    state.evaluationConsensusResolutions = [];
  }
  if (!Array.isArray(state.evaluationCasebooks)) {
    state.evaluationCasebooks = [];
  }
  if (!Array.isArray(state.evaluationCasebookQualificationExecutions)) {
    state.evaluationCasebookQualificationExecutions = [];
  }
  if (!Array.isArray(state.evaluationQualificationBaselines)) {
    state.evaluationQualificationBaselines = [];
  }
  if (!Array.isArray(state.evaluationSuites)) state.evaluationSuites = [];
  if (!Array.isArray(state.evaluationSuiteExecutions)) {
    state.evaluationSuiteExecutions = [];
  }
}

function normalizeReceiptCollections(state: PersistedStoreState): void {
  if (!Array.isArray(state.receiptTrustAnchors)) {
    state.receiptTrustAnchors = [];
  }
  if (!Array.isArray(state.receiptTrustAnchorDirectorySubscriptions)) {
    state.receiptTrustAnchorDirectorySubscriptions = [];
  }
  if (
    !Array.isArray(
      state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions,
    )
  ) {
    state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions =
      [];
  }
  if (
    !Array.isArray(
      state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions,
    )
  ) {
    state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions =
      [];
  }
  if (
    !Array.isArray(
      state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines,
    )
  ) {
    state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines =
      [];
  }
  if (
    !Array.isArray(state.receiptTrustAnchorDirectoryQuorumPromotionBaselines)
  ) {
    state.receiptTrustAnchorDirectoryQuorumPromotionBaselines = [];
  }
  if (
    !Array.isArray(
      state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines,
    )
  ) {
    state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines =
      [];
  }
  if (
    !Array.isArray(state.receiptTrustAnchorDirectoryQuorumActivationDecisions)
  ) {
    state.receiptTrustAnchorDirectoryQuorumActivationDecisions = [];
  }
  if (
    !Array.isArray(state.receiptTrustAnchorDirectoryQuorumActivationSelections)
  ) {
    state.receiptTrustAnchorDirectoryQuorumActivationSelections =
      state.receiptTrustAnchorDirectoryQuorumActivationSelection === undefined
        ? []
        : [state.receiptTrustAnchorDirectoryQuorumActivationSelection];
  }
}

function normalizePlanningCollections(state: PersistedStoreState): void {
  if (!Array.isArray(state.automaticRecoveryAssessments)) {
    state.automaticRecoveryAssessments = [];
  }
  if (!Array.isArray(state.automaticRecoveryAttempts)) {
    state.automaticRecoveryAttempts = [];
  }
  if (!Array.isArray(state.plans)) state.plans = [];
  state.plans = state.plans.map((plan) => refreshPlanProjection(plan));
  if (!Array.isArray(state.executionPlanBlueprints)) {
    state.executionPlanBlueprints = [];
  }
  if (!Array.isArray(state.executionPlanBlueprintOutcomeBaselines)) {
    state.executionPlanBlueprintOutcomeBaselines = [];
  }
  if (
    !Array.isArray(state.executionPlanBlueprintRecommendationPolicyOverrides)
  ) {
    state.executionPlanBlueprintRecommendationPolicyOverrides = [];
  }
  if (
    !Array.isArray(
      state.executionPlanBlueprintRecommendationPolicyOverrideRetirements,
    )
  ) {
    state.executionPlanBlueprintRecommendationPolicyOverrideRetirements = [];
  }
}

function normalizeOperationalCollections(state: PersistedStoreState): void {
  if (!Array.isArray(state.credentials)) state.credentials = [];
  if (!Array.isArray(state.schedules)) state.schedules = [];
  if (!Array.isArray(state.channels)) state.channels = [];
  if (!Array.isArray(state.inboundDeliveries)) {
    state.inboundDeliveries = [];
  }
}

export function validatePersistedWorkspaceState(
  state: PersistedStoreState,
  migrateAgentRevisions: boolean,
): void {
  normalizeInboundState(state);
  validateMemoryRecords(state);
  validateMemoryReplacementLinks(state);
  validateAgentState(state, migrateAgentRevisions);
}

function normalizeInboundState(state: PersistedStoreState): void {
  for (const channel of state.channels) {
    channel.adapter = normalizeInboundChannelAdapter(channel.adapter);
    channel.retryPolicy = channel.retryPolicy
      ? normalizeInboundRetryPolicy(channel.retryPolicy)
      : structuredClone(DEFAULT_INBOUND_RETRY_POLICY);
    channel.signaturePolicy = normalizeInboundSignaturePolicy(
      channel.signaturePolicy,
    );
    channel.policyTemplate = deriveInboundChannelPolicyTemplate(
      channel.retryPolicy,
      channel.signaturePolicy,
    );
  }
  for (const delivery of state.inboundDeliveries) {
    const channelPolicy =
      state.channels.find((channel) => channel.id === delivery.channelId)
        ?.retryPolicy ?? DEFAULT_INBOUND_RETRY_POLICY;
    if (!Number.isInteger(delivery.attemptCount) || delivery.attemptCount < 0) {
      delivery.attemptCount =
        delivery.status === "accepted" || delivery.status === "retrying"
          ? 0
          : 1;
    }
    if (
      !Number.isInteger(delivery.maxAttempts) ||
      delivery.maxAttempts < delivery.attemptCount ||
      delivery.maxAttempts > MAX_INBOUND_ATTEMPTS
    ) {
      delivery.maxAttempts = Math.max(
        channelPolicy.maxAttempts,
        delivery.attemptCount,
      );
    }
    if (
      !Number.isInteger(delivery.retryBaseMs) ||
      delivery.retryBaseMs < MIN_INBOUND_RETRY_BASE_MS ||
      delivery.retryBaseMs > MAX_INBOUND_RETRY_BASE_MS
    ) {
      delivery.retryBaseMs = channelPolicy.baseDelayMs;
    }
  }
}

function validateMemoryRecords(state: PersistedStoreState): void {
  for (const memory of state.memories) {
    if (!MEMORY_STATUSES.has(memory.status)) {
      throw new Error(`Invalid persisted memory status: ${memory.status}`);
    }
    memory.reviewIntervalDays = normalizeMemoryReviewInterval(
      memory.reviewIntervalDays ?? DEFAULT_MEMORY_REVIEW_INTERVAL_DAYS,
    );
    if (memory.consolidatesMemoryIds !== undefined) {
      if (!Array.isArray(memory.consolidatesMemoryIds)) {
        throw new Error(`Invalid persisted memory consolidation: ${memory.id}`);
      }
      memory.consolidatesMemoryIds = normalizeMemoryConsolidationIds(
        memory.consolidatesMemoryIds,
      );
    }
    memoryReplacementTargetIds(memory);
    if (!Number.isSafeInteger(memory.useCount) || memory.useCount < 0) {
      memory.useCount = 0;
    }
    if (memory.status === "active") {
      memory.reviewedAt ??= memory.updatedAt;
      memory.reviewDueAt ??= memoryReviewDueAt(
        memory.reviewedAt,
        memory.reviewIntervalDays,
      );
    }
    for (const timestamp of [
      memory.reviewedAt,
      memory.reviewDueAt,
      memory.lastUsedAt,
    ]) {
      if (timestamp && !Number.isFinite(Date.parse(timestamp))) {
        throw new Error(`Invalid persisted memory timestamp: ${memory.id}`);
      }
    }
  }
}

function validateMemoryReplacementLinks(state: PersistedStoreState): void {
  for (const memory of state.memories) {
    const replacementTargetIds = memoryReplacementTargetIds(memory);
    for (const targetId of replacementTargetIds) {
      const target = state.memories.find(
        (candidate) => candidate.id === targetId,
      );
      if (!target) {
        throw new Error(
          `Persisted memory replacement target is missing: ${memory.id}`,
        );
      }
      if (target.scope !== memory.scope || target.agentId !== memory.agentId) {
        throw new Error(
          `Persisted memory replacement scope is invalid: ${memory.id}`,
        );
      }
      if (
        memory.status !== "proposed" &&
        memory.status !== "rejected" &&
        (target.status !== "archived" ||
          target.supersededByMemoryId !== memory.id)
      ) {
        throw new Error(
          `Persisted memory replacement settlement is invalid: ${memory.id}`,
        );
      }
    }
    if (memory.supersededByMemoryId) {
      const replacement = state.memories.find(
        (candidate) => candidate.id === memory.supersededByMemoryId,
      );
      if (
        !replacement ||
        !memoryReplacementTargetIds(replacement).includes(memory.id)
      ) {
        throw new Error(
          `Persisted memory supersession link is invalid: ${memory.id}`,
        );
      }
    }
  }
}

function validateAgentState(
  state: PersistedStoreState,
  migrateAgentRevisions: boolean,
): void {
  for (const agent of state.agents) {
    if (!Number.isInteger(agent.revision) || agent.revision < 1) {
      agent.revision = 1;
    }
    agent.runLimits = normalizeRunLimits(
      agent.runLimits ?? structuredClone(DEFAULT_RUN_LIMITS),
    );
    agent.subagentLimits = normalizeSubagentLimits(
      agent.subagentLimits ?? structuredClone(DEFAULT_SUBAGENT_LIMITS),
    );
  }
  if (migrateAgentRevisions) {
    state.agentRevisions = state.agents.map((agent) =>
      createAgentProfileRevision(agent, { source: "migrated" }),
    );
  }
  const agentRevisionKeys = new Set<string>();
  for (const input of state.agentRevisions) {
    const revision = validateAgentProfileRevision(input);
    const agent = state.agents.find(
      (candidate) => candidate.id === revision.agentId,
    );
    if (!agent || revision.revision > agent.revision) {
      throw new Error(
        `Persisted Agent revision references an invalid Agent: ${revision.agentId}@${revision.revision}`,
      );
    }
    const key = `${revision.agentId}:${revision.revision}`;
    if (agentRevisionKeys.has(key)) {
      throw new Error(`Duplicate persisted Agent revision: ${key}`);
    }
    agentRevisionKeys.add(key);
    Object.assign(input, revision);
  }
  for (const agent of state.agents) {
    const current = state.agentRevisions.find(
      (revision) =>
        revision.agentId === agent.id && revision.revision === agent.revision,
    );
    if (!current || JSON.stringify(current.profile) !== JSON.stringify(agent)) {
      throw new Error(
        `Persisted Agent current revision is missing: ${agent.id}@${agent.revision}`,
      );
    }
  }
  state.agentCapabilityBindings = ensureCurrentCapabilityBindings(
    state.agentCapabilityBindings,
    state.agents,
    state.agentRevisions,
  );
}
