import type {
  ModelRef,
  RunInvocationSource,
  SubagentRole,
} from "@napier/contracts";
import type {
  ModelRole,
  ModelRoleRouteBinding,
  ModelRoutePath,
  ModelRoutePolicyV2,
  ModelRouteRequest,
  ModelRouteTarget,
} from "@napier/contracts/model-route";

import { normalizeModelRoutePolicy } from "./model-route-profile.js";

export type ModelRouteResolutionSource =
  | "explicit"
  | "role"
  | "path"
  | "subagent_role"
  | "agent_default";

export interface ResolvedModelRouteSelection {
  role: ModelRole;
  path: ModelRoutePath;
  source: ModelRouteResolutionSource;
  targets: ModelRouteTarget[];
}

export function resolveModelRouteSelection(input: {
  agentDefault: ModelRef;
  policy?: ModelRoutePolicyV2;
  request?: ModelRouteRequest;
  source: RunInvocationSource;
  explicitPrimary?: ModelRef;
  subagentRole?: SubagentRole;
}): ResolvedModelRouteSelection {
  const policy = input.policy
    ? normalizeModelRoutePolicy(input.policy)
    : undefined;
  const role =
    input.request?.role ?? (input.subagentRole ? "subagent" : "default");
  const path = routePath(input.source);
  let source: ModelRouteResolutionSource = "agent_default";
  let binding: ModelRoleRouteBinding | undefined;

  if (
    input.subagentRole &&
    input.request?.subagentRoles?.[input.subagentRole]
  ) {
    source = "subagent_role";
    binding = input.request.subagentRoles[input.subagentRole];
  } else if (
    input.subagentRole &&
    policy?.subagentRoles?.[input.subagentRole]
  ) {
    source = "subagent_role";
    binding = policy.subagentRoles[input.subagentRole];
  } else if (input.request?.role && policy?.roles[input.request.role]) {
    source = "role";
    binding = policy.roles[input.request.role];
  } else if (policy?.paths?.[path]) {
    source = "path";
    binding = policy.paths[path];
  } else if (policy?.roles[role]) {
    source = "role";
    binding = policy.roles[role];
  }

  const configuredBinding = binding ?? { model: input.agentDefault };
  const targets =
    input.explicitPrimary &&
    sameModel(input.explicitPrimary, configuredBinding.model)
      ? bindingTargets(configuredBinding)
      : input.explicitPrimary
        ? [{ model: structuredClone(input.explicitPrimary) }]
        : bindingTargets(configuredBinding);
  if (input.explicitPrimary) source = "explicit";
  if (input.request?.fallbackModels) {
    targets.push(
      ...input.request.fallbackModels.map((model) => ({
        model: structuredClone(model),
      })),
    );
  }
  return { role, path, source, targets: uniqueTargets(targets) };
}

export function routePath(source: RunInvocationSource): ModelRoutePath {
  if (source === "user") return "interactive";
  if (source === "recovery") return "recovery";
  if (source === "schedule" || source === "channel") return "automation";
  if (
    source === "workflow" ||
    source === "workflow_reuse" ||
    source === "workflow_simulation"
  ) {
    return "workflow";
  }
  return "experiment";
}

function bindingTargets(binding: ModelRoleRouteBinding): ModelRouteTarget[] {
  return [
    {
      model: structuredClone(binding.model),
      ...(binding.endpointProfileId
        ? { endpointProfileId: binding.endpointProfileId }
        : {}),
      ...(binding.credentialPoolId
        ? { credentialPoolId: binding.credentialPoolId }
        : {}),
    },
    ...(binding.fallbackTargets?.map((target) => structuredClone(target)) ??
      binding.fallbackModels?.map((model) => ({
        model: structuredClone(model),
      })) ??
      []),
  ];
}

function uniqueTargets(
  targets: readonly ModelRouteTarget[],
): ModelRouteTarget[] {
  const seen = new Set<string>();
  const unique: ModelRouteTarget[] = [];
  for (const target of targets) {
    const key = `${target.model.provider}/${target.model.id}/${target.endpointProfileId ?? ""}/${target.credentialPoolId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(target);
  }
  if (unique.length > 5) {
    throw new Error("Model route supports at most 5 candidates");
  }
  return unique;
}

function sameModel(left: ModelRef, right: ModelRef): boolean {
  return left.provider === right.provider && left.id === right.id;
}
