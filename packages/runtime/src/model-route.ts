import type {
  Api,
  AssistantMessageEventStream,
  Credential,
  Model,
} from "@earendil-works/pi-ai";
import type { AgentProfile, CredentialReference, RunRecord } from "@napier/contracts";
import type {
  ModelRouteCandidate,
  ModelRouteCredentialHealth,
  ModelRoutePlan,
  ModelRoutePolicyV2,
  ModelRouteRequest,
  ModelRouteTarget,
  ProviderEndpointProfile,
  RouteFailureClass,
} from "@napier/contracts/model-route";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { EventSink } from "./event-sink.js";
import { createId } from "./ids.js";
import { appendRouteEvent } from "./model-route-evidence.js";
import { defaultModelRoutePolicy, normalizeModelRoutePolicy } from "./model-route-profile.js";
import {
  resolveModelRouteSelection,
  type ModelRouteResolutionSource,
} from "./model-route-resolution.js";
import {
  credentialHealth,
  modelRouteCredentialSlotId,
  type ModelRouteFailureUpdate,
  type ModelRouteStateRepository,
} from "./model-route-state.js";
import { cooldownDurationMs } from "./model-route-policy.js";
import { createModelRouteStream } from "./model-route-stream.js";
import type {
  ModelRouteAttemptContext,
  ResolvedRouteCandidate,
} from "./model-route-types.js";
import type { ModelRegistry } from "./models.js";
import type { LocalStore } from "./store.js";

export { classifyRouteFailure, routeCanFallback } from "./model-route-policy.js";
export type {
  ModelRouteAttemptContext,
  ResolvedRouteCandidate,
} from "./model-route-types.js";

const RETRYABLE_FAILURES = [
  "rate_limited",
  "provider_server",
  "network",
] as const satisfies readonly RouteFailureClass[];

export interface CreateModelRouteSessionInput {
  run: RunRecord;
  primary: Model<Api>;
  profile?: AgentProfile;
  request?: ModelRouteRequest;
  explicitPrimary?: boolean;
  subagentRole?: import("@napier/contracts").SubagentRole;
  onEvent?: EventSink;
}

/** Owns immutable plans while durable health and pool cursors live in Store. */
export class ModelRouter {
  private readonly routeState: ModelRouteStateRepository;

  constructor(
    private readonly store: LocalStore,
    private readonly registry: Pick<
      ModelRegistry,
      "resolveConfigured" | "credentialReferences"
    >,
    private readonly clock: () => number = Date.now,
    private readonly random: () => number = Math.random,
  ) {
    this.routeState = store.modelRouteStateRepository;
  }

  async createSession(input: CreateModelRouteSessionInput): Promise<ModelRouteSession> {
    const policy = normalizeModelRoutePolicy(
      input.profile?.modelRoute ??
        defaultModelRoutePolicy({
          provider: input.primary.provider,
          id: input.primary.id,
        }),
    );
    const selection = resolveModelRouteSelection({
      agentDefault: { provider: input.primary.provider, id: input.primary.id },
      policy,
      ...(input.request ? { request: input.request } : {}),
      source: input.run.source ?? "user",
      ...(input.explicitPrimary
        ? {
            explicitPrimary: {
              provider: input.primary.provider,
              id: input.primary.id,
            },
          }
        : {}),
      ...(input.subagentRole ? { subagentRole: input.subagentRole } : {}),
    });
    const resolved = await Promise.all(
      selection.targets.map((target, index) =>
        this.resolveCandidate(
          target,
          index === 0 ? input.primary : undefined,
          policy,
          selection.source,
        ),
      ),
    );
    const content = routePlanContent(
      input.run.id,
      selection,
      policy,
      resolved,
      this.clock,
    );
    const plan: ModelRoutePlan = {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    };
    await appendRouteEvent(
      this.store,
      input.run,
      "route_plan_created",
      plan,
      input.onEvent,
    );
    return new ModelRouteSession({
      store: this.store,
      router: this,
      run: input.run,
      plan,
      candidates: resolved,
      ...(input.onEvent ? { onEvent: input.onEvent } : {}),
    });
  }

  resolveConfigured(ref: import("@napier/contracts").ModelRef): Promise<Model<Api> | undefined> {
    return this.registry.resolveConfigured(ref);
  }

  availableCandidates(candidates: readonly ResolvedRouteCandidate[]): ResolvedRouteCandidate[] {
    const now = this.clock();
    const available = candidates.filter((candidate) => {
      const health = this.routeState.health(candidate.descriptor);
      return !health?.cooldownUntil || Date.parse(health.cooldownUntil) <= now;
    });
    return available.length > 0 ? available : [candidates[0]!];
  }

  async markFailure(
    candidate: ModelRouteCandidate,
    failureClass: RouteFailureClass,
    hints: Omit<ModelRouteFailureUpdate, "failureClass"> = {},
    retryPolicy: ModelRoutePlan["retryPolicy"] = {
      maxAttemptsPerStep: 1,
      retryableFailureClasses: [...RETRYABLE_FAILURES],
      jitterRatio: 0.2,
      maxBackoffMs: 120_000,
    },
  ): Promise<{ cooldownUntil?: string; backoffMs: number }> {
    const duration = Math.max(
      cooldownDurationMs(failureClass),
      hints.retryAfterMs ?? 0,
    );
    const jitter = duration * retryPolicy.jitterRatio * this.random();
    const backoffMs = Math.min(
      retryPolicy.maxBackoffMs,
      Math.round(duration + jitter),
    );
    const cooldownUntil =
      backoffMs > 0
        ? new Date(this.clock() + backoffMs).toISOString()
        : undefined;
    await this.routeState.recordFailure(candidate, {
      failureClass,
      ...(cooldownUntil ? { cooldownUntil } : {}),
      ...hints,
    });
    return { ...(cooldownUntil ? { cooldownUntil } : {}), backoffMs };
  }

  async markSuccess(candidate: ModelRouteCandidate): Promise<void> {
    await this.routeState.recordSuccess(candidate);
  }

  candidateHealth(candidate: ModelRouteCandidate): {
    credentialHealth: ModelRouteCredentialHealth;
    cooldownUntil?: string;
  } {
    const health = this.routeState.health(candidate);
    if (!health) return { credentialHealth: candidate.credentialHealth };
    if (health.cooldownUntil && Date.parse(health.cooldownUntil) > this.clock()) {
      return {
        credentialHealth: "cooling_down",
        cooldownUntil: health.cooldownUntil,
      };
    }
    return { credentialHealth: health.health };
  }

  private async resolveCandidate(
    target: ModelRouteTarget,
    primary: Model<Api> | undefined,
    policy: ModelRoutePolicyV2,
    selectionReason: ModelRouteResolutionSource,
  ): Promise<ResolvedRouteCandidate> {
    const source =
      primary && primary.provider === target.model.provider && primary.id === target.model.id
        ? primary
        : await this.registry.resolveConfigured(target.model);
    if (!source) {
      throw new Error(
        `Model route candidate must use a live model: ${target.model.provider}/${target.model.id}`,
      );
    }
    const endpoint = policy.endpointProfiles?.find(
      (profile) => profile.id === target.endpointProfileId,
    );
    const pool = policy.credentialPools?.find(
      (candidate) => candidate.id === target.credentialPoolId,
    );
    const activeReferences = this.store
      .listCredentialReferences()
      .filter(
        (reference) =>
          reference.providerId === target.model.provider &&
          reference.status === "active",
      );
    if (!pool && activeReferences.length > 1) {
      throw new Error(
        `Model route target requires an explicit credential pool: ${target.model.provider}`,
      );
    }
    const model = applyEndpointProfile(source, endpoint);
    const reference = pool
      ? await this.routeState.reserveCredential(pool, {
          modelId: model.id,
          ...(endpoint ? { endpointProfileId: endpoint.id } : {}),
        })
      : activeReferences[0];
    const credential = reference
      ? await this.registry.credentialReferences?.readReference(reference.id)
      : undefined;
    if (pool && (!reference || !credential)) {
      throw new Error(`Model route credential pool is unavailable: ${pool.id}`);
    }
    const descriptor = describeCandidate(
      target,
      model,
      reference,
      endpoint,
      selectionReason,
    );
    const apiKey = apiKeyCredential(credential);
    return {
      model,
      descriptor,
      streamOptions: {
        ...(apiKey ? { apiKey } : {}),
        ...(endpoint?.headers ? { headers: endpoint.headers } : {}),
      },
    };
  }
}

interface ModelRouteSessionOptions {
  store: LocalStore;
  router: ModelRouter;
  run: RunRecord;
  plan: ModelRoutePlan;
  candidates: ResolvedRouteCandidate[];
  onEvent?: EventSink;
}

export class ModelRouteSession {
  private attempt = 0;

  constructor(private readonly options: ModelRouteSessionOptions) {}

  get plan(): ModelRoutePlan {
    return structuredClone(this.options.plan);
  }

  get primary(): Model<Api> {
    return this.options.candidates[0]!.model;
  }

  stream(input: {
    signal: AbortSignal;
    invoke(
      model: Model<Api>,
      context?: ModelRouteAttemptContext,
    ): Promise<AssistantMessageEventStream>;
  }): AssistantMessageEventStream {
    return createModelRouteStream(this.options, input, () => ++this.attempt);
  }
}

function routePlanContent(
  runId: string,
  selection: ReturnType<typeof resolveModelRouteSelection>,
  policy: ModelRoutePolicyV2,
  candidates: readonly ResolvedRouteCandidate[],
  clock: () => number,
) {
  return {
    kind: "napier.model-route-plan" as const,
    schemaVersion: 2 as const,
    id: createId("route"),
    runId,
    role: selection.role,
    path: selection.path,
    resolutionSource: selection.source,
    candidates: candidates.map((candidate) => candidate.descriptor),
    retryPolicy: {
      maxAttemptsPerStep: candidates.length,
      retryableFailureClasses: [...RETRYABLE_FAILURES],
      jitterRatio: policy.retryPolicy!.jitterRatio,
      maxBackoffMs: policy.retryPolicy!.maxBackoffMs,
    },
    fallbackPolicy: {
      requireNoVisibleOutput: true as const,
      requireNoSideEffects: true as const,
      allowCrossProvider:
        new Set(candidates.map((candidate) => candidate.model.provider)).size > 1,
    },
    evidencePolicy: {
      recordEveryAttempt: true as const,
      attributeServingModel: true as const,
      recordCredentialSecrets: false as const,
    },
    createdAt: new Date(clock()).toISOString(),
  };
}

function describeCandidate(
  target: ModelRouteTarget,
  model: Model<Api>,
  credential: CredentialReference | undefined,
  endpoint: ProviderEndpointProfile | undefined,
  selectionReason: ModelRouteResolutionSource,
): ModelRouteCandidate {
  return {
    providerId: target.model.provider,
    modelId: model.id,
    ...(model.id !== target.model.id ? { sourceModelId: target.model.id } : {}),
    ...(credential
      ? { credentialSlotId: modelRouteCredentialSlotId(credential.id) }
      : {}),
    credentialHealth: credentialHealth(credential?.availability),
    ...(target.credentialPoolId
      ? { credentialPoolId: target.credentialPoolId }
      : {}),
    ...(endpoint
      ? {
          endpointProfileId: endpoint.id,
          endpointKind: endpoint.kind,
          dialect: endpoint.dialect,
        }
      : {}),
    selectionReason,
  };
}

function applyEndpointProfile(
  model: Model<Api>,
  profile: ProviderEndpointProfile | undefined,
): Model<Api> {
  if (!profile) return model;
  const api =
    profile.dialect === "openai_completions"
      ? "openai-completions"
      : profile.dialect === "openai_responses"
        ? "openai-responses"
        : profile.dialect === "anthropic_messages"
          ? "anthropic-messages"
          : model.api;
  return {
    ...model,
    api,
    id: profile.modelId ?? model.id,
    baseUrl: profile.baseUrl,
    ...(profile.headers
      ? { headers: { ...model.headers, ...profile.headers } }
      : {}),
  } as Model<Api>;
}

function apiKeyCredential(credential: Credential | undefined): string | undefined {
  return credential?.type === "api_key" ? credential.key : undefined;
}
