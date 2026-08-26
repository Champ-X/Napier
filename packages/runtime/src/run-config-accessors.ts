import type {
  AutomaticRecoveryPolicy,
  RunConfigurationFingerprint,
  RunExecutionMode,
} from "@napier/contracts";

import {
  DEFAULT_AUTOMATIC_RECOVERY_POLICY,
  DEFAULT_MODEL_ADVISOR_POLICY,
  normalizeModelAdvisorPolicy,
} from "./agents.js";
import { normalizeModelRoutePolicy } from "./model-route-profile.js";
import { normalizeToolLoopGuardPolicy } from "./tool-loop-guard.js";

export function fingerprintAutomaticRecovery(
  fingerprint: RunConfigurationFingerprint,
): AutomaticRecoveryPolicy {
  return "automaticRecovery" in fingerprint
    ? structuredClone(fingerprint.automaticRecovery)
    : structuredClone(DEFAULT_AUTOMATIC_RECOVERY_POLICY);
}

export function fingerprintExecutionMode(
  fingerprint: RunConfigurationFingerprint,
): RunExecutionMode {
  return "executionMode" in fingerprint
    ? fingerprint.executionMode
    : "standard";
}

export function fingerprintSkillCatalogSha256(
  fingerprint: RunConfigurationFingerprint,
): string {
  return "skillCatalogSha256" in fingerprint
    ? fingerprint.skillCatalogSha256
    : "";
}

export function fingerprintModelAdvisor(
  fingerprint: RunConfigurationFingerprint,
) {
  return "modelAdvisor" in fingerprint
    ? normalizeModelAdvisorPolicy(fingerprint.modelAdvisor)
    : structuredClone(DEFAULT_MODEL_ADVISOR_POLICY);
}

export function fingerprintPromptVariableHashes(
  fingerprint: RunConfigurationFingerprint,
) {
  return "promptVariableCatalogSha256" in fingerprint
    ? {
        promptVariableCatalogSha256: fingerprint.promptVariableCatalogSha256,
        resolvedSystemPromptSha256: fingerprint.resolvedSystemPromptSha256,
      }
    : null;
}

export function fingerprintToolLoopGuard(
  fingerprint: RunConfigurationFingerprint,
) {
  return "toolLoopGuard" in fingerprint
    ? normalizeToolLoopGuardPolicy(fingerprint.toolLoopGuard)
    : normalizeToolLoopGuardPolicy(undefined);
}

export function fingerprintModelRoute(
  fingerprint: RunConfigurationFingerprint,
) {
  return fingerprint.schemaVersion === 9
    ? normalizeModelRoutePolicy(fingerprint.modelRoute)
    : undefined;
}
