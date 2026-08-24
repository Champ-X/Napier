import type { Api, AssistantMessageEventStream, Model } from "@earendil-works/pi-ai";
import type { ModelRef, RunRecord } from "@napier/contracts";
import type {
  ModelRouteCandidate,
  ModelRouteCredentialHealth,
  ModelRoutePlan,
  ModelRouteRequest,
  ModelRole,
  RouteFailureClass,
} from "@napier/contracts/model-route";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { EventSink } from "./event-sink.js";
import { createId } from "./ids.js";
import { appendRouteEvent } from "./model-route-evidence.js";
import { cooldownDurationMs } from "./model-route-policy.js";
import { createModelRouteStream } from "./model-route-stream.js";
import type { ModelRegistry } from "./models.js";
import type { LocalStore } from "./store.js";

export { classifyRouteFailure, routeCanFallback } from "./model-route-policy.js";

const RETRYABLE_FAILURES = [
  "rate_limited",
  "provider_server",
  "network",
] as const satisfies readonly RouteFailureClass[];
const MAX_ROUTE_CANDIDATES = 5;

export interface ResolvedRouteCandidate {
  descriptor: ModelRouteCandidate;
  model: Model<Api>;
}

interface CandidateCooldown {
  until: number;
  failureClass: RouteFailureClass;
}

export interface CreateModelRouteSessionInput {
  run: RunRecord;
  primary: Model<Api>;
  request?: ModelRouteRequest;
  onEvent?: EventSink;
}

export interface ModelRouteInvocation {
  candidate: Model<Api>;
  source: AssistantMessageEventStream;
}

/**
 * Owns route health across Runs while each Session owns one immutable plan.
 * Cooldowns contain identifiers and timestamps only; credentials never enter
 * route evidence or process-local health state.
 */
export class ModelRouter {
  private readonly cooldowns = new Map<string, CandidateCooldown>();

  constructor(
    private readonly store: LocalStore,
    private readonly registry: Pick<ModelRegistry, "resolveConfigured">,
    private readonly clock: () => number = Date.now,
  ) {}

  async createSession(
    input: CreateModelRouteSessionInput,
  ): Promise<ModelRouteSession> {
    const role = input.request?.role ?? "default";
    const refs = uniqueCandidates(
      { provider: input.primary.provider, id: input.primary.id },
      input.request?.fallbackModels ?? [],
    );
    const resolved = await Promise.all(
      refs.map(async (ref, index): Promise<ResolvedRouteCandidate> => {
        const model =
          index === 0
            ? input.primary
            : await this.registry.resolveConfigured(ref);
        if (!model) {
          throw new Error(
            `Model route candidate must use a live model: ${ref.provider}/${ref.id}`,
          );
        }
        return { model, descriptor: this.describeCandidate(ref) };
      }),
    );
    const content = routePlanContent(input.run.id, role, resolved, this.clock);
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

  resolveConfigured(ref: ModelRef): Promise<Model<Api> | undefined> {
    return this.registry.resolveConfigured(ref);
  }

  availableCandidates(
    candidates: readonly ResolvedRouteCandidate[],
  ): ResolvedRouteCandidate[] {
    const now = this.clock();
    const available = candidates.filter((candidate) => {
      const cooldown = this.cooldowns.get(candidateKey(candidate.descriptor));
      if (!cooldown) return true;
      if (cooldown.until > now) return false;
      this.cooldowns.delete(candidateKey(candidate.descriptor));
      return true;
    });
    return available.length > 0 ? available : [candidates[0]!];
  }

  markFailure(
    candidate: ModelRouteCandidate,
    failureClass: RouteFailureClass,
  ): void {
    const duration = cooldownDurationMs(failureClass);
    if (duration === 0) return;
    this.cooldowns.set(candidateKey(candidate), {
      until: this.clock() + duration,
      failureClass,
    });
  }

  candidateHealth(candidate: ModelRouteCandidate): {
    credentialHealth: ModelRouteCredentialHealth;
    cooldownUntil?: string;
  } {
    const cooldown = this.cooldowns.get(candidateKey(candidate));
    if (!cooldown || cooldown.until <= this.clock()) {
      if (cooldown) this.cooldowns.delete(candidateKey(candidate));
      return { credentialHealth: candidate.credentialHealth };
    }
    return {
      credentialHealth: "cooling_down",
      cooldownUntil: new Date(cooldown.until).toISOString(),
    };
  }

  private describeCandidate(ref: ModelRef): ModelRouteCandidate {
    const credential = this.store.getActiveCredentialReference(ref.provider);
    return {
      providerId: ref.provider,
      modelId: ref.id,
      ...(credential
        ? { credentialSlotId: `slot_${sha256(credential.id).slice(0, 20)}` }
        : {}),
      credentialHealth: credentialHealth(credential?.availability),
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

  stream(input: {
    signal: AbortSignal;
    invoke(model: Model<Api>): Promise<AssistantMessageEventStream>;
  }): AssistantMessageEventStream {
    return createModelRouteStream(
      this.options,
      input,
      () => ++this.attempt,
    );
  }
}

function routePlanContent(
  runId: string,
  role: ModelRole,
  candidates: readonly ResolvedRouteCandidate[],
  clock: () => number,
) {
  return {
    kind: "napier.model-route-plan" as const,
    schemaVersion: 1 as const,
    id: createId("route"),
    runId,
    role,
    candidates: candidates.map((candidate) => candidate.descriptor),
    retryPolicy: {
      maxAttemptsPerStep: candidates.length,
      retryableFailureClasses: [...RETRYABLE_FAILURES],
    },
    fallbackPolicy: {
      requireNoVisibleOutput: true as const,
      requireNoSideEffects: true as const,
      allowCrossProvider:
        new Set(candidates.map((candidate) => candidate.model.provider)).size >
        1,
    },
    evidencePolicy: {
      recordEveryAttempt: true as const,
      attributeServingModel: true as const,
      recordCredentialSecrets: false as const,
    },
    createdAt: new Date(clock()).toISOString(),
  };
}

function uniqueCandidates(
  primary: ModelRef,
  fallbacks: readonly ModelRef[],
): ModelRef[] {
  if (fallbacks.length > MAX_ROUTE_CANDIDATES - 1) {
    throw new Error(
      `Model route supports at most ${String(MAX_ROUTE_CANDIDATES - 1)} fallback models`,
    );
  }
  const candidates = [primary, ...fallbacks].map(normalizeModelRef);
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = `${candidate.provider}/${candidate.id}`;
    if (seen.has(key)) {
      throw new Error(`Model route candidate is duplicated: ${key}`);
    }
    seen.add(key);
  }
  return candidates;
}

function normalizeModelRef(ref: ModelRef): ModelRef {
  const provider = ref.provider.trim().toLowerCase();
  const id = ref.id.trim();
  if (
    !/^[a-z][a-z0-9_-]{0,63}$/u.test(provider) ||
    !id ||
    id.length > 200 ||
    /[\u0000-\u001f\u007f<>\s]/u.test(id)
  ) {
    throw new Error("Model route candidate is invalid");
  }
  return { provider, id };
}

function credentialHealth(
  availability: string | undefined,
): ModelRouteCredentialHealth {
  if (availability === "available") return "healthy";
  if (availability === "missing" || availability === "error") {
    return "unavailable";
  }
  return "unknown";
}

function candidateKey(candidate: ModelRouteCandidate): string {
  return (
    candidate.credentialSlotId ?? `${candidate.providerId}/${candidate.modelId}`
  );
}
