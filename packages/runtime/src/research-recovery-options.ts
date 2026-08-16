import type { RunEvent, RunRecord } from "@napier/contracts";

import { capabilityPresetForOriginRun } from "./agent-capability-override.js";
import type { RunPromptOptions } from "./agent-runtime-options.js";
import { authorizeInternalResearchRecovery } from "./internal-research-recovery-authorization.js";
import {
  prepareSkillContinuationSnapshot,
  SKILL_CONTINUATION_SNAPSHOT,
} from "./skill-load-replay.js";
import { isSkillCatalogBinding } from "./skill-load-contracts.js";
import { loadWorkspaceSkills } from "./skills.js";
import { runIntentFor } from "./run-intents.js";

export async function prepareManualSkillRecoveryOptions(
  workspaceRoot: string,
  interrupted: RunRecord,
  events: readonly RunEvent[],
  options: RunPromptOptions,
): Promise<RunPromptOptions> {
  options = withRecoveryIntent(options, events, interrupted.id);
  const preset = capabilityPresetForOriginRun(events, interrupted.id);
  const firstClassSkillLoading = events.some(
    (event) =>
      event.runId === interrupted.id &&
      event.type === "context.skills" &&
      isSkillCatalogBinding(event.payload),
  );
  if (!firstClassSkillLoading) return options;
  const continuation = await prepareSkillContinuationSnapshot(
    workspaceRoot,
    interrupted,
    events,
    options.signal,
  );
  const recoveryOptions = {
    ...options,
    ...(preset ? { capabilityPreset: preset } : {}),
    ...(interrupted.agentRevision === undefined
      ? {}
      : { agentRevision: interrupted.agentRevision }),
    ...(continuation.snapshot
      ? { [SKILL_CONTINUATION_SNAPSHOT]: continuation.snapshot }
      : {}),
  };
  return preset === "research"
    ? authorizeInternalResearchRecovery(recoveryOptions)
    : recoveryOptions;
}

export async function prepareAutomaticSkillRecoveryOptions(
  workspaceRoot: string,
  interrupted: RunRecord,
  events: readonly RunEvent[],
  options: RunPromptOptions,
): Promise<RunPromptOptions> {
  options = withRecoveryIntent(options, events, interrupted.id);
  const preset = capabilityPresetForOriginRun(events, interrupted.id);
  const firstClassSkillLoading = events.some(
    (event) =>
      event.type === "context.skills" && isSkillCatalogBinding(event.payload),
  );
  const continuation = firstClassSkillLoading
    ? await prepareSkillContinuationSnapshot(
        workspaceRoot,
        interrupted,
        events,
        options.signal,
      )
    : { bound: false as const };
  if (
    !continuation.bound &&
    interrupted.configuration &&
    interrupted.configuration.schemaVersion >= 3 &&
    "skillCatalogSha256" in interrupted.configuration
  ) {
    const current = await loadWorkspaceSkills(
      workspaceRoot,
      interrupted.configuration.enabledSkills,
    );
    if (
      current.fingerprint.contentSha256 !==
      interrupted.configuration.skillCatalogSha256
    ) {
      throw new Error(
        "Interrupted Run Skill catalog changed since interruption",
      );
    }
  }
  const recoveryOptions = {
    ...options,
    ...(preset ? { capabilityPreset: preset } : {}),
    ...(!preset && interrupted.agentRevision !== undefined
      ? { agentRevision: interrupted.agentRevision }
      : {}),
    ...(continuation.snapshot
      ? { [SKILL_CONTINUATION_SNAPSHOT]: continuation.snapshot }
      : {}),
  };
  return preset === "research"
    ? authorizeInternalResearchRecovery(recoveryOptions)
    : recoveryOptions;
}

function withRecoveryIntent(
  options: RunPromptOptions,
  events: readonly RunEvent[],
  runId: string,
): RunPromptOptions {
  const intentId = runIntentFor(events, runId);
  return intentId && options.recovery
    ? { ...options, recovery: { ...options.recovery, intentId } }
    : options;
}
