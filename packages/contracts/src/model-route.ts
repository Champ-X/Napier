import type { ModelRef, SubagentRole } from "./execution-core.js";

export type ModelRole =
  | "default"
  | "fast"
  | "reasoning"
  | "vision"
  | "subagent";

export type ModelRoutePath =
  | "interactive"
  | "recovery"
  | "automation"
  | "workflow"
  | "experiment";

export type ProviderEndpointDialect =
  | "provider_default"
  | "openai_completions"
  | "openai_responses"
  | "anthropic_messages";

export interface ProviderEndpointProfile {
  id: string;
  providerId: string;
  kind: "direct" | "gateway";
  baseUrl: string;
  modelId?: string;
  dialect: ProviderEndpointDialect;
  headers?: Record<string, string>;
}

export interface ModelRouteCredentialPool {
  id: string;
  providerId: string;
  strategy: "round_robin";
  credentialReferenceIds?: string[];
}

export interface ModelRouteTarget {
  model: ModelRef;
  endpointProfileId?: string;
  credentialPoolId?: string;
}

export type RouteFailureClass =
  | "rate_limited"
  | "provider_server"
  | "network"
  | "context"
  | "authentication"
  | "billing"
  | "tool_dialect"
  | "cancelled"
  | "unknown";

export type ModelRouteCredentialHealth =
  | "unknown"
  | "healthy"
  | "cooling_down"
  | "unavailable";

export type ModelRouteSideEffectState = "none" | "known" | "unknown";

export interface ModelRouteRequest {
  role?: ModelRole;
  fallbackModels?: ModelRef[];
  subagentRoles?: Partial<Record<SubagentRole, ModelRoleRouteBinding>>;
}

export interface ModelRoleRouteBinding {
  model: ModelRef;
  fallbackModels?: ModelRef[];
  endpointProfileId?: string;
  credentialPoolId?: string;
  fallbackTargets?: ModelRouteTarget[];
}

export interface ModelRoutePolicyV2 {
  schemaVersion: 2;
  roles: Partial<Record<ModelRole, ModelRoleRouteBinding>>;
  paths?: Partial<Record<ModelRoutePath, ModelRoleRouteBinding>>;
  subagentRoles?: Partial<Record<SubagentRole, ModelRoleRouteBinding>>;
  endpointProfiles?: ProviderEndpointProfile[];
  credentialPools?: ModelRouteCredentialPool[];
  retryPolicy?: {
    jitterRatio: number;
    maxBackoffMs: number;
  };
}

export interface ModelRouteCandidate {
  providerId: string;
  modelId: string;
  sourceModelId?: string;
  credentialSlotId?: string;
  credentialHealth: ModelRouteCredentialHealth;
  cooldownUntil?: string;
  credentialPoolId?: string;
  endpointProfileId?: string;
  endpointKind?: ProviderEndpointProfile["kind"];
  dialect?: ProviderEndpointDialect;
  selectionReason?:
    | "explicit"
    | "role"
    | "path"
    | "subagent_role"
    | "agent_default";
}

export interface ModelRoutePlan {
  kind: "napier.model-route-plan";
  schemaVersion: 2;
  id: string;
  runId: string;
  role: ModelRole;
  path: ModelRoutePath;
  resolutionSource:
    | "explicit"
    | "role"
    | "path"
    | "subagent_role"
    | "agent_default";
  candidates: ModelRouteCandidate[];
  retryPolicy: {
    maxAttemptsPerStep: number;
    retryableFailureClasses: RouteFailureClass[];
    jitterRatio: number;
    maxBackoffMs: number;
  };
  fallbackPolicy: {
    requireNoVisibleOutput: true;
    requireNoSideEffects: true;
    allowCrossProvider: boolean;
  };
  evidencePolicy: {
    recordEveryAttempt: true;
    attributeServingModel: true;
    recordCredentialSecrets: false;
  };
  createdAt: string;
  contentSha256: string;
}

export interface ModelRouteAttempt {
  kind: "napier.model-route-attempt";
  schemaVersion: 1;
  routePlanId: string;
  attemptId: string;
  attempt: number;
  stepAttempt: number;
  providerId: string;
  modelId: string;
  credentialSlotId?: string;
  credentialHealth: ModelRouteCredentialHealth;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  visibleOutputProduced: boolean;
  sideEffectState: ModelRouteSideEffectState;
  outcome?: "success" | "retryable" | "terminal";
  failureClass?: RouteFailureClass;
  fallbackFromAttempt?: number;
  fallbackReason?: RouteFailureClass;
  retryFromAttempt?: number;
  retryReason?: RouteFailureClass;
  retryDelayMs?: number;
  bufferedThinkingBytes?: number;
  diagnosticSha256?: string;
  providerHint?: string;
  retryAfterMs?: number;
  backoffMs?: number;
  contentSha256: string;
}
