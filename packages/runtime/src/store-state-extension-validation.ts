import { type ExecutionPlanBlueprintRecordOutcomeBaseline } from "@napier/contracts";
import { validateExecutionPlanBlueprintOutcomeBaseline } from "./execution-plan-blueprint-outcome-baseline.js";
import {
  MAX_EXTENSION_PACKAGE_ROLLOUT_CHANNELS,
  MAX_EXTENSION_PUBLISHER_TRUST_ANCHORS,
  validateExtensionPackageDependencyGraph,
  validateExtensionPackageHistory,
  validateExtensionPackageRolloutChannel,
  validateExtensionPublisherTrustAnchor,
  verifyBoundExtensionPackageTrust,
} from "./extension-packages.js";
import { validateExecutionPlanBlueprintRecommendationPolicyOverrideRetirementResult } from "./plan-blueprint-policy-retirement.js";
import { validateExecutionPlanBlueprintRecommendationPolicyOverride } from "./plan-blueprint-portfolio-model.js";
import { validateSkillPackageInstallation } from "./skill-packages.js";
import type { PersistedStoreState } from "./store-state.js";
import { validateThreadImportProvenance } from "./thread-import-provenance-validation.js";
import { validateExecutionPlanBlueprintRecord } from "./workflow-blueprints.js";
export function validatePersistedExtensionState(
  state: PersistedStoreState,
): void {
  validateThreads(state);
  validatePublisherTrustAnchors(state);
  const blueprintIds = validateBlueprints(state);
  validateBlueprintOutcomeBaselines(state, blueprintIds);
  validateRecommendationPolicyOverrides(state);
  validateRecommendationPolicyRetirements(state);
  validateSkillPackageInstallations(state);
  validateExtensionBindings(state);
  validateRolloutChannels(state);
}

function validateThreads(state: PersistedStoreState): void {
  const threadIds = new Set<string>();
  for (const thread of state.threads) {
    if (threadIds.has(thread.id)) {
      throw new Error(`Duplicate persisted Thread: ${thread.id}`);
    }
    threadIds.add(thread.id);
    if (thread.importProvenance !== undefined) {
      thread.importProvenance = validateThreadImportProvenance(
        thread,
        thread.importProvenance,
      );
    }
  }
}

function validatePublisherTrustAnchors(state: PersistedStoreState): void {
  if (
    state.extensionPublisherTrustAnchors.length >
    MAX_EXTENSION_PUBLISHER_TRUST_ANCHORS
  ) {
    throw new Error(
      "Persisted Extension publisher trust anchor limit is exceeded",
    );
  }
  const extensionPublisherAnchorIds = new Set<string>();
  const extensionPublisherKeyIds = new Set<string>();
  const extensionPublisherSigningSources = new Set<string>();
  for (const input of state.extensionPublisherTrustAnchors) {
    const anchor = validateExtensionPublisherTrustAnchor(input);
    const signingSource = anchor.signingSource?.variable;
    if (
      extensionPublisherAnchorIds.has(anchor.id) ||
      extensionPublisherKeyIds.has(anchor.keyId) ||
      (signingSource !== undefined &&
        extensionPublisherSigningSources.has(signingSource))
    ) {
      throw new Error(
        `Duplicate persisted Extension publisher trust anchor: ${anchor.id}`,
      );
    }
    extensionPublisherAnchorIds.add(anchor.id);
    extensionPublisherKeyIds.add(anchor.keyId);
    if (signingSource) extensionPublisherSigningSources.add(signingSource);
    Object.assign(input, anchor);
  }
}

function validateBlueprints(state: PersistedStoreState): Set<string> {
  const executionPlanBlueprintIds = new Set<string>();
  const activeExecutionPlanBlueprintHashes = new Set<string>();
  for (const input of state.executionPlanBlueprints) {
    const record = validateExecutionPlanBlueprintRecord(input);
    if (executionPlanBlueprintIds.has(record.id)) {
      throw new Error(
        `Duplicate persisted Execution Plan blueprint: ${record.id}`,
      );
    }
    executionPlanBlueprintIds.add(record.id);
    if (record.status === "active") {
      if (activeExecutionPlanBlueprintHashes.has(record.blueprintSha256)) {
        throw new Error(
          `Duplicate active Execution Plan blueprint hash: ${record.id}`,
        );
      }
      activeExecutionPlanBlueprintHashes.add(record.blueprintSha256);
    }
    Object.assign(input, record);
  }
  return executionPlanBlueprintIds;
}

function validateBlueprintOutcomeBaselines(
  state: PersistedStoreState,
  executionPlanBlueprintIds: Set<string>,
): void {
  const outcomeBaselineIds = new Set<string>();
  const outcomeBaselineKeys = new Set<string>();
  const latestOutcomeBaselineByRecord = new Map<
    string,
    ExecutionPlanBlueprintRecordOutcomeBaseline
  >();
  for (const input of state.executionPlanBlueprintOutcomeBaselines) {
    const baseline = validateExecutionPlanBlueprintOutcomeBaseline(input);
    const previous = latestOutcomeBaselineByRecord.get(baseline.recordId);
    const baselineKey = `${baseline.recordId}:${baseline.replayOutcomesSha256}:${baseline.contentSha256}`;
    if (
      outcomeBaselineIds.has(baseline.id) ||
      outcomeBaselineKeys.has(baselineKey) ||
      !executionPlanBlueprintIds.has(baseline.recordId) ||
      baseline.supersedesBaselineId !== previous?.id
    ) {
      throw new Error(
        `Persisted Execution Plan blueprint outcome baseline is invalid: ${baseline.id}`,
      );
    }
    outcomeBaselineIds.add(baseline.id);
    outcomeBaselineKeys.add(baselineKey);
    latestOutcomeBaselineByRecord.set(baseline.recordId, baseline);
    Object.assign(input, baseline);
  }
}

function validateRecommendationPolicyOverrides(
  state: PersistedStoreState,
): void {
  const recommendationPolicyOverrideFamilies = new Set<string>();
  for (const input of state.executionPlanBlueprintRecommendationPolicyOverrides) {
    const override =
      validateExecutionPlanBlueprintRecommendationPolicyOverride(input);
    if (recommendationPolicyOverrideFamilies.has(override.familySha256)) {
      throw new Error(
        `Duplicate persisted Execution Plan blueprint recommendation policy override: ${override.familySha256}`,
      );
    }
    recommendationPolicyOverrideFamilies.add(override.familySha256);
    Object.assign(input, override);
  }
}

function validateRecommendationPolicyRetirements(
  state: PersistedStoreState,
): void {
  const recommendationPolicyOverrideRetirementHashes = new Set<string>();
  for (const input of state.executionPlanBlueprintRecommendationPolicyOverrideRetirements) {
    const retirement =
      validateExecutionPlanBlueprintRecommendationPolicyOverrideRetirementResult(
        input,
      );
    if (
      recommendationPolicyOverrideRetirementHashes.has(retirement.contentSha256)
    ) {
      throw new Error(
        `Duplicate persisted Execution Plan blueprint recommendation policy override retirement: ${retirement.contentSha256}`,
      );
    }
    recommendationPolicyOverrideRetirementHashes.add(retirement.contentSha256);
    Object.assign(input, retirement);
  }
}

function validateSkillPackageInstallations(state: PersistedStoreState): void {
  const skillPackageInstallationIds = new Set<string>();
  let activeSkillPackageInstallationCount = 0;
  for (const input of state.skillPackageInstallations) {
    const installation = validateSkillPackageInstallation(input);
    if (skillPackageInstallationIds.has(installation.id)) {
      throw new Error(
        `Duplicate persisted Skill package installation: ${installation.id}`,
      );
    }
    skillPackageInstallationIds.add(installation.id);
    if (installation.status === "active") {
      activeSkillPackageInstallationCount += 1;
    }
    Object.assign(input, installation);
  }
  if (activeSkillPackageInstallationCount > 1) {
    throw new Error("Multiple active Skill package installations are invalid");
  }
  for (const installation of state.skillPackageInstallations) {
    if (
      installation.replacesInstallationId &&
      !skillPackageInstallationIds.has(installation.replacesInstallationId)
    ) {
      throw new Error(
        `Persisted Skill package replacement target is missing: ${installation.id}`,
      );
    }
    if (
      installation.replacedByInstallationId &&
      !skillPackageInstallationIds.has(installation.replacedByInstallationId)
    ) {
      throw new Error(
        `Persisted Skill package replacement successor is missing: ${installation.id}`,
      );
    }
  }
}

function validateExtensionBindings(state: PersistedStoreState): void {
  for (const extension of state.extensions) {
    if (
      (extension.provenance.source === "signed_package") !==
      Boolean(extension.packageBinding)
    ) {
      throw new Error(
        `Persisted Extension package provenance is invalid: ${extension.id}`,
      );
    }
    if (
      extension.packageHistory !== undefined &&
      !Array.isArray(extension.packageHistory)
    ) {
      throw new Error(
        `Persisted Extension package history is invalid: ${extension.id}`,
      );
    }
    if (extension.packageBinding && extension.packageHistory === undefined) {
      extension.packageHistory = [];
    }
    if (extension.packageBinding || extension.packageHistory !== undefined) {
      extension.packageHistory = validateExtensionPackageHistory(
        extension,
        state.extensionPublisherTrustAnchors,
      );
    }
    const verification = verifyBoundExtensionPackageTrust(
      extension,
      state.extensionPublisherTrustAnchors,
    );
    if (
      verification &&
      verification.status !== "trusted" &&
      verification.status !== "revoked" &&
      verification.status !== "expired"
    ) {
      throw new Error(
        `Persisted signed Extension package is invalid: ${extension.id}: ${verification.reason}`,
      );
    }
  }
  validateExtensionPackageDependencyGraph(
    state.extensions,
    state.extensionPublisherTrustAnchors,
  );
}

function validateRolloutChannels(state: PersistedStoreState): void {
  if (
    state.extensionPackageRolloutChannels.length >
    MAX_EXTENSION_PACKAGE_ROLLOUT_CHANNELS
  ) {
    throw new Error(
      "Persisted Extension package rollout channel limit is exceeded",
    );
  }
  const rolloutChannelIds = new Set<string>();
  const rolloutChannelNames = new Set<string>();
  for (const input of state.extensionPackageRolloutChannels) {
    const channel = validateExtensionPackageRolloutChannel(
      input,
      state.extensionPublisherTrustAnchors,
    );
    if (
      rolloutChannelIds.has(channel.id) ||
      rolloutChannelNames.has(channel.normalizedName)
    ) {
      throw new Error(
        `Duplicate persisted Extension package rollout channel: ${channel.id}`,
      );
    }
    rolloutChannelIds.add(channel.id);
    rolloutChannelNames.add(channel.normalizedName);
    Object.assign(input, channel);
  }
}
