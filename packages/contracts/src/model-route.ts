import type { ModelRef, SubagentRole } from "./execution-core.js";

export type ModelRole =
  | "default"
  | "fast"
  | "reasoning"
  | "vision"
  | "subagent";

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
}

export interface ModelRouteCandidate {
  providerId: string;
  modelId: string;
  credentialSlotId?: string;
  credentialHealth: ModelRouteCredentialHealth;
  cooldownUntil?: string;
}

export interface ModelRoutePlan {
  kind: "napier.model-route-plan";
  schemaVersion: 1;
  id: string;
  runId: string;
  role: ModelRole;
  candidates: ModelRouteCandidate[];
  retryPolicy: {
    maxAttemptsPerStep: number;
    retryableFailureClasses: RouteFailureClass[];
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
  diagnosticSha256?: string;
  contentSha256: string;
}
