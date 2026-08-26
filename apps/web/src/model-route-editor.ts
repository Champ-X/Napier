import type {
  AgentProfile,
  CredentialReference,
  ModelRef,
  ModelSummary,
  SubagentRole,
  UpdateAgentProfileRequest,
} from "@napier/contracts";
import type {
  ModelRole,
  ModelRoleRouteBinding,
  ModelRoutePath,
  ModelRoutePolicyV2,
  ModelRouteTarget,
} from "@napier/contracts/model-route";

export const MODEL_ROUTE_ROLES: readonly ModelRole[] = [
  "default",
  "fast",
  "reasoning",
  "vision",
  "subagent",
];
export const MODEL_ROUTE_PATHS: readonly ModelRoutePath[] = [
  "interactive",
  "recovery",
  "automation",
  "workflow",
  "experiment",
];
export const MODEL_ROUTE_SUBAGENTS: readonly SubagentRole[] = [
  "researcher",
  "reviewer",
  "general",
  "coder",
];

export type ModelRouteBindingGroup = "roles" | "paths" | "subagentRoles";
export type ModelRouteBindingKey = ModelRole | ModelRoutePath | SubagentRole;

export function createModelRouteDraft(agent: AgentProfile): ModelRoutePolicyV2 {
  return agent.modelRoute
    ? structuredClone(agent.modelRoute)
    : {
        schemaVersion: 2,
        roles: { default: { model: structuredClone(agent.model) } },
        retryPolicy: { jitterRatio: 0.2, maxBackoffMs: 120_000 },
      };
}

export function modelRouteSavePatch(
  hadRoute: boolean,
  enabled: boolean,
  policy: ModelRoutePolicyV2,
): Pick<UpdateAgentProfileRequest, "modelRoute" | "clearModelRoute"> {
  if (enabled) return { modelRoute: structuredClone(policy) };
  return hadRoute ? { clearModelRoute: true } : {};
}

export function routeBinding(
  policy: ModelRoutePolicyV2,
  group: ModelRouteBindingGroup,
  key: ModelRouteBindingKey,
): ModelRoleRouteBinding | undefined {
  return (policy[group] as Record<string, ModelRoleRouteBinding> | undefined)?.[
    key
  ];
}

export function updateRouteBinding(
  policy: ModelRoutePolicyV2,
  group: ModelRouteBindingGroup,
  key: ModelRouteBindingKey,
  binding: ModelRoleRouteBinding | undefined,
): ModelRoutePolicyV2 {
  const next = structuredClone(policy);
  const bindings = { ...(next[group] ?? {}) } as Record<
    string,
    ModelRoleRouteBinding
  >;
  if (binding) bindings[key] = binding;
  else delete bindings[key];
  if (group === "roles" || Object.keys(bindings).length > 0) {
    Object.assign(next, { [group]: bindings });
  } else {
    delete next[group];
  }
  return next;
}

export function updateRouteTarget(
  binding: ModelRoleRouteBinding,
  index: number | "primary",
  patch: Partial<
    Omit<ModelRouteTarget, "endpointProfileId" | "credentialPoolId">
  > & {
    endpointProfileId?: string | undefined;
    credentialPoolId?: string | undefined;
  },
): ModelRoleRouteBinding {
  const next = structuredClone(binding);
  const apply = (target: ModelRouteTarget): void => {
    Object.assign(target, patch);
    if (Object.hasOwn(patch, "endpointProfileId") && !patch.endpointProfileId) {
      delete target.endpointProfileId;
    }
    if (Object.hasOwn(patch, "credentialPoolId") && !patch.credentialPoolId) {
      delete target.credentialPoolId;
    }
  };
  if (index === "primary") {
    apply(next);
    return next;
  }
  const targets = [...(next.fallbackTargets ?? [])];
  const target = { ...targets[index]! };
  apply(target);
  targets[index] = target;
  next.fallbackTargets = targets;
  return next;
}

export function routeModelKey(model: ModelRef): string {
  return `${model.provider}/${model.id}`;
}

export function routeModelFromKey(key: string): ModelRef | undefined {
  const separator = key.indexOf("/");
  return separator > 0 && separator < key.length - 1
    ? { provider: key.slice(0, separator), id: key.slice(separator + 1) }
    : undefined;
}

export function replaceRouteTargetModel(
  target: ModelRouteTarget,
  model: ModelRef,
  policy: ModelRoutePolicyV2,
): ModelRouteTarget {
  const endpoint = policy.endpointProfiles?.find(
    (profile) => profile.id === target.endpointProfileId,
  );
  const pool = policy.credentialPools?.find(
    (candidate) => candidate.id === target.credentialPoolId,
  );
  return {
    model,
    ...(endpoint?.providerId === model.provider
      ? { endpointProfileId: endpoint.id }
      : {}),
    ...(pool?.providerId === model.provider
      ? { credentialPoolId: pool.id }
      : {}),
  };
}

export function removeModelRouteReference(
  policy: ModelRoutePolicyV2,
  field: "endpointProfileId" | "credentialPoolId",
  id: string,
): ModelRoutePolicyV2 {
  const next = structuredClone(policy);
  for (const group of ["roles", "paths", "subagentRoles"] as const) {
    for (const binding of Object.values(next[group] ?? {})) {
      if (!binding) continue;
      if (binding[field] === id) delete binding[field];
      for (const target of binding.fallbackTargets ?? []) {
        if (target[field] === id) delete target[field];
      }
    }
  }
  return next;
}

export function parseEndpointHeaders(value: string): Record<string, string> {
  return Object.fromEntries(
    value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf(":");
        return separator < 1
          ? [line, ""]
          : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );
}

export function formatEndpointHeaders(
  headers: Record<string, string> | undefined,
): string {
  return Object.entries(headers ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");
}

export function modelRouteDraftError(
  policy: ModelRoutePolicyV2,
  models: readonly ModelSummary[],
  credentials: readonly CredentialReference[],
): string | undefined {
  if (policy.schemaVersion !== 2) return "schema";
  const endpoints = policy.endpointProfiles ?? [];
  const pools = policy.credentialPools ?? [];
  if (endpoints.length > 32 || pools.length > 32) return "capacity";
  if (!unique(endpoints.map((profile) => profile.id))) return "endpoint-id";
  if (!unique(pools.map((pool) => pool.id))) return "pool-id";
  if (!unique(pools.map((pool) => pool.providerId))) return "pool-provider";
  if (endpoints.some((profile) => !validEndpoint(profile))) return "endpoint";
  if (pools.some((pool) => !validPool(pool, credentials))) return "pool";
  const bindings = [
    ...Object.values(policy.roles),
    ...Object.values(policy.paths ?? {}),
    ...Object.values(policy.subagentRoles ?? {}),
  ].filter((binding): binding is ModelRoleRouteBinding => Boolean(binding));
  if (
    bindings.some((binding) => !validBinding(binding, endpoints, pools, models))
  ) {
    return "binding";
  }
  const retry = policy.retryPolicy;
  if (
    retry &&
    (!Number.isFinite(retry.jitterRatio) ||
      retry.jitterRatio < 0 ||
      retry.jitterRatio > 0.5 ||
      !Number.isSafeInteger(retry.maxBackoffMs) ||
      retry.maxBackoffMs < 1_000 ||
      retry.maxBackoffMs > 300_000)
  )
    return "retry";
  return undefined;
}

function validBinding(
  binding: ModelRoleRouteBinding,
  endpoints: NonNullable<ModelRoutePolicyV2["endpointProfiles"]>,
  pools: NonNullable<ModelRoutePolicyV2["credentialPools"]>,
  models: readonly ModelSummary[],
): boolean {
  const targets: ModelRouteTarget[] = [
    binding,
    ...(binding.fallbackTargets ?? []),
  ];
  if (targets.length > 5) return false;
  const identities = targets.map((target) =>
    [
      target.model.provider,
      target.model.id,
      target.endpointProfileId ?? "",
      target.credentialPoolId ?? "",
    ].join("/"),
  );
  return (
    unique(identities) &&
    targets.every((target) => {
      const endpoint = endpoints.find(
        (profile) => profile.id === target.endpointProfileId,
      );
      const pool = pools.find(
        (candidate) => candidate.id === target.credentialPoolId,
      );
      return (
        validModel(target.model, models) &&
        (!target.endpointProfileId ||
          endpoint?.providerId === target.model.provider) &&
        (!target.credentialPoolId || pool?.providerId === target.model.provider)
      );
    })
  );
}

function validEndpoint(
  profile: NonNullable<ModelRoutePolicyV2["endpointProfiles"]>[number],
): boolean {
  if (!identifier(profile.id) || !identifier(profile.providerId)) return false;
  let url: URL;
  try {
    url = new URL(profile.baseUrl.trim());
  } catch {
    return false;
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    Boolean(url.username || url.password || url.search || url.hash)
  )
    return false;
  return Object.entries(profile.headers ?? {}).every(
    ([name, value]) =>
      /^[a-z0-9][a-z0-9-]{0,63}$/iu.test(name.trim()) &&
      !/(?:^|[-_])(auth(?:orization)?|cookie|key|secret|token)(?:$|[-_])/iu.test(
        name,
      ) &&
      value.length <= 1_000 &&
      !/[\u0000\r\n]/u.test(value),
  );
}

function validPool(
  pool: NonNullable<ModelRoutePolicyV2["credentialPools"]>[number],
  credentials: readonly CredentialReference[],
): boolean {
  const members = pool.credentialReferenceIds;
  return (
    identifier(pool.id) &&
    identifier(pool.providerId) &&
    (!members ||
      (members.length >= 2 &&
        members.length <= 16 &&
        unique(members) &&
        members.every((id) =>
          credentials.some(
            (credential) =>
              credential.id === id &&
              credential.providerId === pool.providerId &&
              credential.status === "active",
          ),
        )))
  );
}

function validModel(model: ModelRef, models: readonly ModelSummary[]): boolean {
  return (
    identifier(model.provider) &&
    /^[^\u0000-\u0020\u007f<>]{1,200}$/u.test(model.id) &&
    (!models.some(
      (candidate) =>
        candidate.provider === model.provider && candidate.id === model.id,
    ) ||
      models.some(
        (candidate) =>
          candidate.provider === model.provider &&
          candidate.id === model.id &&
          candidate.configured,
      ))
  );
}

function identifier(value: string): boolean {
  return /^[a-z][a-z0-9_-]{0,63}$/u.test(value.trim());
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}
