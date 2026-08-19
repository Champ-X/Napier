import type { AgentProfile, RunRecord } from "@napier/contracts";

import {
  environmentDegradedExecution,
  restrictedReadOnlyExecution,
} from "./run-execution-tool-surface.js";

export function effectiveRunProfile(
  snapshot: AgentProfile,
  run: RunRecord,
): AgentProfile {
  const configuration = run.configuration;
  if (!configuration) return structuredClone(snapshot);
  if (configuration.agentRevision !== snapshot.revision) {
    throw new Error("Run configuration does not match the Agent revision");
  }
  return {
    ...structuredClone(snapshot),
    model: structuredClone(configuration.model),
    thinkingLevel: configuration.thinkingLevel,
    toolPolicy: configuration.toolPolicy,
    enabledTools: [...configuration.enabledTools],
    enabledSkills: [...configuration.enabledSkills],
    enabledSubagents: [...configuration.enabledSubagents],
    subagentLimits: structuredClone(configuration.subagentLimits),
    runLimits: structuredClone(configuration.runLimits),
    ...(modernRunConfiguration(configuration)
      ? {
          automaticRecovery: structuredClone(configuration.automaticRecovery),
        }
      : {}),
    ...(configuration.schemaVersion === 4 ||
    configuration.schemaVersion === 5 ||
    configuration.schemaVersion === 6 ||
    configuration.schemaVersion === 7 ||
    configuration.schemaVersion === 8
      ? {
          modelAdvisor: structuredClone(configuration.modelAdvisor),
        }
      : {}),
    ...(configuration.schemaVersion === 8
      ? {
          toolLoopGuard: structuredClone(configuration.toolLoopGuard),
        }
      : {}),
  };
}

export function modernRunConfiguration(
  configuration: RunRecord["configuration"],
): configuration is Extract<
  NonNullable<RunRecord["configuration"]>,
  { schemaVersion: 2 | 3 | 4 | 5 | 6 | 7 | 8 }
> {
  return (
    configuration !== undefined &&
    (configuration.schemaVersion === 2 ||
      configuration.schemaVersion === 3 ||
      configuration.schemaVersion === 4 ||
      configuration.schemaVersion === 5 ||
      configuration.schemaVersion === 6 ||
      configuration.schemaVersion === 7 ||
      configuration.schemaVersion === 8)
  );
}

export function runExecutionBoundary(
  configuration: RunRecord["configuration"],
): {
  degraded: boolean;
  restricted: boolean;
} {
  const mode = modernRunConfiguration(configuration)
    ? configuration.executionMode
    : "standard";
  return {
    degraded: environmentDegradedExecution(mode),
    restricted: restrictedReadOnlyExecution(mode),
  };
}
