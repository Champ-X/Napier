import type {
  AgentProfile,
  PromptVariableDefinition,
  ToolLoopGuardPolicy,
} from "@napier/contracts";

import { normalizePromptVariableDefinitions } from "./prompt-variables.js";
import { normalizeToolLoopGuardPolicy } from "./tool-loop-guard.js";

export function effectiveToolLoopGuardPolicy(
  profile: Pick<AgentProfile, "toolLoopGuard">,
): ToolLoopGuardPolicy {
  return normalizeToolLoopGuardPolicy(profile.toolLoopGuard);
}

export function optionalPromptVariableUpdate(
  current: AgentProfile["promptVariables"],
  requested: PromptVariableDefinition[],
): Pick<AgentProfile, "promptVariables"> | Record<string, never> {
  const normalized = normalizePromptVariableDefinitions(requested);
  const effectiveCurrent = normalizePromptVariableDefinitions(current);
  if (JSON.stringify(effectiveCurrent) === JSON.stringify(normalized)) {
    return current === undefined ? {} : { promptVariables: current };
  }
  if (current === undefined && normalized.length === 0) return {};
  return { promptVariables: normalized };
}

export function optionalToolLoopGuardUpdate(
  current: AgentProfile["toolLoopGuard"],
  requested: ToolLoopGuardPolicy,
): { toolLoopGuard?: ToolLoopGuardPolicy } {
  const normalized = normalizeToolLoopGuardPolicy(requested);
  const effectiveCurrent = normalizeToolLoopGuardPolicy(current);
  if (JSON.stringify(effectiveCurrent) === JSON.stringify(normalized)) {
    return current === undefined ? {} : { toolLoopGuard: current };
  }
  return { toolLoopGuard: normalized };
}
