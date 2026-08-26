import type { AgentProfile } from "@napier/contracts";

import { sha256 } from "./ed25519.js";
import { normalizeModelRoutePolicy } from "./model-route-profile.js";
import { createPromptVariableCatalog } from "./prompt-variables.js";
import { validateRunConfigurationFingerprint } from "./run-config.js";
import { normalizeToolLoopGuardPolicy } from "./tool-loop-guard.js";

export function assertReplayRunConfiguration(
  run: Record<string, unknown>,
  runId: string,
  agentProfilesByRevision: ReadonlyMap<number, AgentProfile>,
): void {
  if (run["configuration"] === undefined) return;
  const configuration = validateRunConfigurationFingerprint(
    run["configuration"],
  );
  if (
    (run["agentRevision"] !== undefined &&
      run["agentRevision"] !== configuration.agentRevision) ||
    (run["limits"] !== undefined &&
      JSON.stringify(run["limits"]) !==
        JSON.stringify(configuration.runLimits))
  ) {
    throw new Error(
      `Thread replay bundle run configuration conflicts with run: ${runId}`,
    );
  }
  if (
    configuration.schemaVersion !== 7 &&
    configuration.schemaVersion !== 8 &&
    configuration.schemaVersion !== 9
  ) {
    return;
  }
  const profile = agentProfilesByRevision.get(configuration.agentRevision);
  if (
    !profile ||
    configuration.systemPromptSha256 !== sha256(profile.systemPrompt) ||
    configuration.promptVariableCatalogSha256 !==
      createPromptVariableCatalog(profile.promptVariables).contentSha256
  ) {
    throw new Error(
      `Thread replay bundle Prompt configuration does not match Agent revision: ${runId}`,
    );
  }
  if (
    configuration.schemaVersion !== 7 &&
    JSON.stringify(configuration.toolLoopGuard) !==
      JSON.stringify(normalizeToolLoopGuardPolicy(profile.toolLoopGuard))
  ) {
    throw new Error(
      `Thread replay bundle schema-8 loop guard does not match Agent revision: ${runId}`,
    );
  }
  if (
    configuration.schemaVersion === 9 &&
    JSON.stringify(configuration.modelRoute) !==
      JSON.stringify(
        normalizeModelRoutePolicy(
          profile.modelRoute ?? {
            schemaVersion: 2,
            roles: { default: { model: configuration.model } },
          },
        ),
      )
  ) {
    throw new Error(
      `Thread replay bundle schema-9 Model Route does not match Agent revision: ${runId}`,
    );
  }
}
