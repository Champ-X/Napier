import type { ModelRef } from "@napier/contracts";
import type {
  ModelRole,
  ModelRoleRouteBinding,
  ModelRouteCredentialPool,
  ModelRoutePath,
  ModelRoutePolicyV2,
  ModelRouteTarget,
  ProviderEndpointDialect,
  ProviderEndpointProfile,
} from "@napier/contracts/model-route";

const MODEL_ROLES: readonly ModelRole[] = [
  "default",
  "fast",
  "reasoning",
  "vision",
  "subagent",
];
const MODEL_ROUTE_PATHS: readonly ModelRoutePath[] = [
  "interactive",
  "recovery",
  "automation",
  "workflow",
  "experiment",
];
const SUBAGENT_ROLES = [
  "researcher",
  "reviewer",
  "general",
  "coder",
] as const;
const ENDPOINT_DIALECTS = new Set<ProviderEndpointDialect>([
  "provider_default",
  "openai_completions",
  "openai_responses",
  "anthropic_messages",
]);
const SECRET_HEADER_NAME = /(?:^|[-_])(auth(?:orization)?|cookie|key|secret|token)(?:$|[-_])/iu;
const IDENTIFIER = /^[a-z][a-z0-9_-]{0,63}$/u;
const MODEL_ID = /^[^\u0000-\u0020\u007f<>]{1,200}$/u;
const CREDENTIAL_REFERENCE_ID = /^credential_[a-z0-9_-]{8,100}$/u;

export const DEFAULT_MODEL_ROUTE_RETRY_POLICY = Object.freeze({
  jitterRatio: 0.2,
  maxBackoffMs: 120_000,
});

export function normalizeModelRoutePolicy(
  input: ModelRoutePolicyV2,
): ModelRoutePolicyV2 {
  if (!input || typeof input !== "object" || input.schemaVersion !== 2) {
    throw new Error("Model route policy must use schema version 2");
  }
  assertExactKeys(input, "Model route policy", [
    "schemaVersion",
    "roles",
    "paths",
    "subagentRoles",
    "endpointProfiles",
    "credentialPools",
    "retryPolicy",
  ]);
  const endpointProfiles = normalizeEndpointProfiles(input.endpointProfiles);
  const credentialPools = normalizeCredentialPools(input.credentialPools);
  const endpointById = new Map(
    endpointProfiles.map((profile) => [profile.id, profile]),
  );
  const poolById = new Map(credentialPools.map((pool) => [pool.id, pool]));
  const roles = normalizeBindings(
    input.roles,
    MODEL_ROLES,
    "role",
    endpointById,
    poolById,
  );
  const paths = normalizeBindings(
    input.paths,
    MODEL_ROUTE_PATHS,
    "path",
    endpointById,
    poolById,
  );
  const subagentRoles = normalizeBindings(
    input.subagentRoles,
    SUBAGENT_ROLES,
    "Subagent role",
    endpointById,
    poolById,
  );
  const retryPolicy = normalizeRetryPolicy(input.retryPolicy);
  return {
    schemaVersion: 2,
    roles,
    ...(Object.keys(paths).length > 0 ? { paths } : {}),
    ...(Object.keys(subagentRoles).length > 0 ? { subagentRoles } : {}),
    ...(endpointProfiles.length > 0 ? { endpointProfiles } : {}),
    ...(credentialPools.length > 0 ? { credentialPools } : {}),
    retryPolicy,
  };
}

export function defaultModelRoutePolicy(model: ModelRef): ModelRoutePolicyV2 {
  return {
    schemaVersion: 2,
    roles: { default: { model: normalizeModelRef(model) } },
    retryPolicy: { ...DEFAULT_MODEL_ROUTE_RETRY_POLICY },
  };
}

function normalizeBindings<Key extends string>(
  input: Partial<Record<Key, ModelRoleRouteBinding>> | undefined,
  allowed: readonly Key[],
  label: string,
  endpointById: ReadonlyMap<string, ProviderEndpointProfile>,
  poolById: ReadonlyMap<string, ModelRouteCredentialPool>,
): Partial<Record<Key, ModelRoleRouteBinding>> {
  if (input === undefined) return {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`Model route ${label} bindings are invalid`);
  }
  const unknown = Object.keys(input).find(
    (key) => !allowed.includes(key as Key),
  );
  if (unknown) throw new Error(`Unknown Model route ${label}: ${unknown}`);
  const normalized: Partial<Record<Key, ModelRoleRouteBinding>> = {};
  for (const key of allowed) {
    const binding = input[key];
    if (binding) {
      normalized[key] = normalizeBinding(binding, endpointById, poolById);
    }
  }
  return normalized;
}

function normalizeBinding(
  input: ModelRoleRouteBinding,
  endpointById: ReadonlyMap<string, ProviderEndpointProfile>,
  poolById: ReadonlyMap<string, ModelRouteCredentialPool>,
): ModelRoleRouteBinding {
  assertExactKeys(input, "Model route binding", [
    "model",
    "fallbackModels",
    "endpointProfileId",
    "credentialPoolId",
    "fallbackTargets",
  ]);
  const model = normalizeModelRef(input.model);
  const primary = normalizeTarget(
    {
      model,
      ...(input.endpointProfileId
        ? { endpointProfileId: normalizeIdentifier(input.endpointProfileId) }
        : {}),
      ...(input.credentialPoolId
        ? { credentialPoolId: normalizeIdentifier(input.credentialPoolId) }
        : {}),
    },
    endpointById,
    poolById,
  );
  const fallbackTargets = [
    ...(input.fallbackModels ?? []).map((fallback) => ({ model: fallback })),
    ...(input.fallbackTargets ?? []),
  ].map((target) => normalizeTarget(target, endpointById, poolById));
  if (fallbackTargets.length > 4) {
    throw new Error("Model route binding supports at most 4 fallbacks");
  }
  assertUniqueTargets([primary, ...fallbackTargets]);
  return {
    model: primary.model,
    ...(primary.endpointProfileId
      ? { endpointProfileId: primary.endpointProfileId }
      : {}),
    ...(primary.credentialPoolId
      ? { credentialPoolId: primary.credentialPoolId }
      : {}),
    ...(fallbackTargets.length > 0 ? { fallbackTargets } : {}),
  };
}

function normalizeTarget(
  input: ModelRouteTarget,
  endpointById: ReadonlyMap<string, ProviderEndpointProfile>,
  poolById: ReadonlyMap<string, ModelRouteCredentialPool>,
): ModelRouteTarget {
  assertExactKeys(input, "Model route target", [
    "model",
    "endpointProfileId",
    "credentialPoolId",
  ]);
  const model = normalizeModelRef(input.model);
  const endpointProfileId = input.endpointProfileId
    ? normalizeIdentifier(input.endpointProfileId)
    : undefined;
  const credentialPoolId = input.credentialPoolId
    ? normalizeIdentifier(input.credentialPoolId)
    : undefined;
  const endpoint = endpointProfileId
    ? endpointById.get(endpointProfileId)
    : undefined;
  const pool = credentialPoolId ? poolById.get(credentialPoolId) : undefined;
  if (endpointProfileId && !endpoint) {
    throw new Error(`Model route endpoint profile is missing: ${endpointProfileId}`);
  }
  if (credentialPoolId && !pool) {
    throw new Error(`Model route credential pool is missing: ${credentialPoolId}`);
  }
  if (endpoint && endpoint.providerId !== model.provider) {
    throw new Error("Model route endpoint provider does not match its model");
  }
  if (pool && pool.providerId !== model.provider) {
    throw new Error("Model route credential pool provider does not match its model");
  }
  return {
    model,
    ...(endpointProfileId ? { endpointProfileId } : {}),
    ...(credentialPoolId ? { credentialPoolId } : {}),
  };
}

function normalizeEndpointProfiles(
  inputs: readonly ProviderEndpointProfile[] | undefined,
): ProviderEndpointProfile[] {
  if (inputs === undefined) return [];
  if (!Array.isArray(inputs) || inputs.length > 32) {
    throw new Error("Model route endpoint profiles are invalid");
  }
  const profiles = inputs.map((input) => {
    assertExactKeys(input, "Model route endpoint profile", [
      "id",
      "providerId",
      "kind",
      "baseUrl",
      "modelId",
      "dialect",
      "headers",
    ]);
    const id = normalizeIdentifier(input.id);
    const providerId = normalizeIdentifier(input.providerId);
    if (input.kind !== "direct" && input.kind !== "gateway") {
      throw new Error(`Model route endpoint kind is invalid: ${id}`);
    }
    if (!ENDPOINT_DIALECTS.has(input.dialect)) {
      throw new Error(`Model route endpoint dialect is invalid: ${id}`);
    }
    return {
      id,
      providerId,
      kind: input.kind,
      baseUrl: normalizeEndpointUrl(input.baseUrl),
      ...(input.modelId ? { modelId: normalizeModelId(input.modelId) } : {}),
      dialect: input.dialect,
      ...(input.headers ? { headers: normalizeHeaders(input.headers) } : {}),
    };
  });
  assertUnique(profiles.map((profile) => profile.id), "endpoint profile");
  return profiles.sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeCredentialPools(
  inputs: readonly ModelRouteCredentialPool[] | undefined,
): ModelRouteCredentialPool[] {
  if (inputs === undefined) return [];
  if (!Array.isArray(inputs) || inputs.length > 32) {
    throw new Error("Model route credential pools are invalid");
  }
  const pools = inputs.map((input) => {
    assertExactKeys(input, "Model route credential pool", [
      "id",
      "providerId",
      "strategy",
      "credentialReferenceIds",
    ]);
    const id = normalizeIdentifier(input.id);
    const providerId = normalizeIdentifier(input.providerId);
    if (input.strategy !== "round_robin") {
      throw new Error(`Model route credential pool strategy is invalid: ${id}`);
    }
    if (
      input.credentialReferenceIds !== undefined &&
      (!Array.isArray(input.credentialReferenceIds) ||
        input.credentialReferenceIds.length < 2 ||
        input.credentialReferenceIds.length > 16 ||
        input.credentialReferenceIds.some(
          (referenceId: string) => !CREDENTIAL_REFERENCE_ID.test(referenceId),
        ))
    ) {
      throw new Error(`Model route credential pool members are invalid: ${id}`);
    }
    if (input.credentialReferenceIds) {
      assertUnique(input.credentialReferenceIds, "credential reference");
    }
    return {
      id,
      providerId,
      strategy: input.strategy,
      ...(input.credentialReferenceIds
        ? { credentialReferenceIds: [...input.credentialReferenceIds] }
        : {}),
    };
  });
  assertUnique(pools.map((pool) => pool.id), "credential pool");
  assertUnique(pools.map((pool) => pool.providerId), "credential pool provider");
  return pools.sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeRetryPolicy(
  input: ModelRoutePolicyV2["retryPolicy"],
): NonNullable<ModelRoutePolicyV2["retryPolicy"]> {
  if (input === undefined) return { ...DEFAULT_MODEL_ROUTE_RETRY_POLICY };
  assertExactKeys(input, "Model route retry policy", [
    "jitterRatio",
    "maxBackoffMs",
  ]);
  if (
    !Number.isFinite(input.jitterRatio) ||
    input.jitterRatio < 0 ||
    input.jitterRatio > 0.5 ||
    !Number.isSafeInteger(input.maxBackoffMs) ||
    input.maxBackoffMs < 1_000 ||
    input.maxBackoffMs > 300_000
  ) {
    throw new Error("Model route retry policy is invalid");
  }
  return {
    jitterRatio: input.jitterRatio,
    maxBackoffMs: input.maxBackoffMs,
  };
}

function normalizeHeaders(
  input: Record<string, string>,
): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Model route endpoint headers are invalid");
  }
  const entries = Object.entries(input);
  if (entries.length > 20) {
    throw new Error("Model route endpoint headers are invalid");
  }
  const normalized: Record<string, string> = {};
  for (const [rawName, rawValue] of entries) {
    const name = rawName.trim().toLowerCase();
    if (
      !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(name) ||
      SECRET_HEADER_NAME.test(name) ||
      typeof rawValue !== "string" ||
      rawValue.length > 1_000 ||
      /[\u0000\r\n]/u.test(rawValue) ||
      Object.hasOwn(normalized, name)
    ) {
      throw new Error("Model route endpoint headers are invalid or secret-bearing");
    }
    normalized[name] = rawValue.trim();
  }
  return Object.fromEntries(
    Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function normalizeEndpointUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Model route endpoint URL is invalid");
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Model route endpoint URL is invalid");
  }
  return url.toString().replace(/\/$/u, "");
}

function normalizeModelRef(input: ModelRef): ModelRef {
  if (!input || typeof input !== "object") {
    throw new Error("Model route model is invalid");
  }
  assertExactKeys(input, "Model route model", ["provider", "id"]);
  return {
    provider: normalizeIdentifier(input.provider),
    id: normalizeModelId(input.id),
  };
}

function normalizeIdentifier(value: string): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!IDENTIFIER.test(normalized)) {
    throw new Error(`Model route identifier is invalid: ${String(value)}`);
  }
  return normalized;
}

function normalizeModelId(value: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!MODEL_ID.test(normalized)) throw new Error("Model route model ID is invalid");
  return normalized;
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Model route ${label} is duplicated`);
  }
}

function assertUniqueTargets(targets: readonly ModelRouteTarget[]): void {
  const keys = targets.map(
    (target) =>
      `${target.model.provider}/${target.model.id}/${target.endpointProfileId ?? ""}/${target.credentialPoolId ?? ""}`,
  );
  assertUnique(keys, "target");
}

function assertExactKeys(
  value: unknown,
  label: string,
  allowed: readonly string[],
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknown) throw new Error(`${label} has unsupported field: ${unknown}`);
}
