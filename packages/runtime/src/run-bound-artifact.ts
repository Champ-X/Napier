import type { ArtifactManifestEntry, ExecutionPlan } from "@napier/contracts";

import { canonicalJson } from "./ed25519.js";
import { createPlanArtifactEventPayload } from "./plans.js";
import type { LocalStore } from "./store.js";

export type RunBoundArtifactStore = Pick<
  LocalStore,
  "appendEvent" | "getPlan" | "listEvents" | "listPlans" | "updatePlanArtifact"
>;

export interface RunBoundArtifactRegistration {
  status: "registered" | "skipped" | "failed";
  reason:
    | "artifact_registered"
    | "no_run_bound_plan"
    | "no_matching_artifact"
    | "artifact_not_expected"
    | "artifact_registration_failed";
  planId?: string;
  artifactId?: string;
}

export interface RunBoundArtifactAuthority {
  planId: string;
  artifactId: string;
}

export class RunBoundArtifactRegistrar {
  constructor(private readonly store: RunBoundArtifactStore) {}

  authorize(
    owner: { threadId: string; runId: string },
    matches: (artifact: ArtifactManifestEntry) => boolean,
  ): RunBoundArtifactAuthority | undefined {
    const resolved = this.resolve(owner, matches);
    return resolved.kind === "matched"
      ? {
          planId: resolved.plan.id,
          artifactId: resolved.artifact.id,
        }
      : undefined;
  }

  async register(
    owner: { threadId: string; runId: string },
    matches: (artifact: ArtifactManifestEntry) => boolean,
    settle: (
      plan: ExecutionPlan,
      artifactId: string,
      runId: string,
    ) => Promise<ExecutionPlan>,
  ): Promise<RunBoundArtifactRegistration> {
    const resolved = this.resolve(owner, matches);
    if (resolved.kind === "skipped") return resolved.registration;
    const { plan, artifact } = resolved;
    try {
      const verified = await settle(plan, artifact.id, owner.runId);
      return {
        status: "registered",
        reason: "artifact_registered",
        planId: verified.id,
        artifactId: artifact.id,
      };
    } catch {
      return (await settle(
        this.store.getPlan(plan.id),
        artifact.id,
        owner.runId,
      ).then(
        () => true,
        () => false,
      ))
        ? {
            status: "registered",
            reason: "artifact_registered",
            planId: plan.id,
            artifactId: artifact.id,
          }
        : {
            status: "failed",
            reason: "artifact_registration_failed",
            planId: plan.id,
            artifactId: artifact.id,
          };
    }
  }

  private runBoundPlan(owner: {
    threadId: string;
    runId: string;
  }): ExecutionPlan | undefined {
    const matches = this.store
      .listPlans(owner.threadId)
      .filter(
        (plan) =>
          plan.status === "active" &&
          plan.steps.some(
            (step) => step.status === "running" && step.runId === owner.runId,
          ),
      );
    return matches.length === 1 ? matches[0] : undefined;
  }

  private resolve(
    owner: { threadId: string; runId: string },
    matches: (artifact: ArtifactManifestEntry) => boolean,
  ):
    | {
        kind: "matched";
        plan: ExecutionPlan;
        artifact: ArtifactManifestEntry;
      }
    | {
        kind: "skipped";
        registration: RunBoundArtifactRegistration;
      } {
    const plan = this.runBoundPlan(owner);
    if (!plan) {
      return {
        kind: "skipped",
        registration: { status: "skipped", reason: "no_run_bound_plan" },
      };
    }
    const artifacts = plan.artifacts.filter(matches);
    if (artifacts.length !== 1) {
      return {
        kind: "skipped",
        registration: {
          status: "skipped",
          reason: "no_matching_artifact",
          planId: plan.id,
        },
      };
    }
    const artifact = artifacts[0]!;
    if (
      artifact.status !== "expected" ||
      (artifact.sourceRunId !== undefined &&
        artifact.sourceRunId !== owner.runId)
    ) {
      return {
        kind: "skipped",
        registration: {
          status: "skipped",
          reason: "artifact_not_expected",
          planId: plan.id,
          artifactId: artifact.id,
        },
      };
    }
    return { kind: "matched", plan, artifact };
  }
}

export function runBoundArtifactById(
  plan: ExecutionPlan,
  artifactId: string,
): ArtifactManifestEntry {
  const artifact = plan.artifacts.find(
    (candidate) => candidate.id === artifactId,
  );
  if (!artifact) throw new Error(`Artifact not found: ${artifactId}`);
  return artifact;
}

export async function ensureRunBoundArtifactEvent(
  store: RunBoundArtifactStore,
  plan: ExecutionPlan,
  artifact: ArtifactManifestEntry,
  runId: string,
): Promise<void> {
  const expected = createPlanArtifactEventPayload(plan, artifact);
  const latest = (await store.listEvents(plan.threadId))
    .filter(
      (event) =>
        event.type.startsWith("plan.artifact.") &&
        record(event.payload)?.["planId"] === plan.id &&
        record(event.payload)?.["artifactId"] === artifact.id,
    )
    .at(-1);
  if (
    latest?.type === `plan.artifact.${artifact.status}` &&
    canonicalJson(latest.payload) === canonicalJson(expected)
  ) {
    return;
  }
  await store.appendEvent({
    threadId: plan.threadId,
    runId,
    type: `plan.artifact.${artifact.status}`,
    category: "plan",
    visibility: "user",
    payload: expected,
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
