import type { ExecutionPlan } from "@napier/contracts";

import { canonicalJson } from "./ed25519.js";
import { createWorkspaceArtifactVerificationRequest } from "./plan-tools.js";
import { createPlanArtifactEventPayload } from "./plans.js";
import type { LocalStore } from "./store.js";

export type RunBoundFileArtifactStore = Pick<
  LocalStore,
  | "appendEvent"
  | "getPlan"
  | "listEvents"
  | "listPlans"
  | "updatePlanArtifact"
  | "workspaceRoot"
>;

export interface RunBoundFileArtifact {
  path: string;
  fileSha256: string;
  fileBytes: number;
  producedEvidence: string;
  verifiedEvidence: string;
}

export interface RunBoundFileArtifactRegistration {
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

export class RunBoundFileArtifactRegistrar {
  constructor(private readonly store: RunBoundFileArtifactStore) {}

  async register(
    owner: { threadId: string; runId: string },
    output: RunBoundFileArtifact,
  ): Promise<RunBoundFileArtifactRegistration> {
    validateOutput(output);
    const plan = this.runBoundPlan(owner);
    if (!plan) return { status: "skipped", reason: "no_run_bound_plan" };
    const matches = plan.artifacts.filter(
      (artifact) => artifact.kind === "file" && artifact.path === output.path,
    );
    if (matches.length !== 1) {
      return {
        status: "skipped",
        reason: "no_matching_artifact",
        planId: plan.id,
      };
    }
    const artifact = matches[0]!;
    if (
      artifact.status !== "expected" ||
      (artifact.sourceRunId !== undefined &&
        artifact.sourceRunId !== owner.runId)
    ) {
      return {
        status: "skipped",
        reason: "artifact_not_expected",
        planId: plan.id,
        artifactId: artifact.id,
      };
    }
    try {
      const verified = await this.settle(
        plan,
        artifact.id,
        owner.runId,
        output,
      );
      return {
        status: "registered",
        reason: "artifact_registered",
        planId: verified.id,
        artifactId: artifact.id,
      };
    } catch {
      return (await this.retry(plan.id, artifact.id, owner.runId, output))
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

  private async settle(
    plan: ExecutionPlan,
    artifactId: string,
    runId: string,
    output: RunBoundFileArtifact,
  ): Promise<ExecutionPlan> {
    let current = plan;
    let artifact = artifactById(current, artifactId);
    if (artifact.sourceRunId !== undefined && artifact.sourceRunId !== runId) {
      throw new Error("Run-bound file Artifact belongs to another Run");
    }
    if (artifact.status === "expected") {
      current = await this.store.updatePlanArtifact(current.id, artifact.id, {
        status: "produced",
        sourceRunId: runId,
        sizeBytes: output.fileBytes,
        evidence: output.producedEvidence,
      });
      artifact = artifactById(current, artifactId);
      await this.ensureEvent(current, artifact, runId);
    }
    if (artifact.status === "produced") {
      await this.ensureEvent(current, artifact, runId);
      const verification = await createWorkspaceArtifactVerificationRequest(
        this.store.workspaceRoot,
        artifact,
        {
          sourceRunId: runId,
          evidence: output.verifiedEvidence,
        },
      );
      if (
        verification.sha256 !== output.fileSha256 ||
        verification.sizeBytes !== output.fileBytes
      ) {
        throw new Error("Run-bound file changed before Plan verification");
      }
      current = await this.store.updatePlanArtifact(
        current.id,
        artifact.id,
        verification,
      );
      artifact = artifactById(current, artifactId);
      await this.ensureEvent(current, artifact, runId);
    }
    if (
      artifact.status !== "verified" ||
      artifact.sourceRunId !== runId ||
      artifact.sha256 !== output.fileSha256 ||
      artifact.sizeBytes !== output.fileBytes
    ) {
      throw new Error("Run-bound file Artifact registration is incomplete");
    }
    await this.ensureEvent(current, artifact, runId);
    return current;
  }

  private async retry(
    planId: string,
    artifactId: string,
    runId: string,
    output: RunBoundFileArtifact,
  ): Promise<boolean> {
    return this.settle(this.store.getPlan(planId), artifactId, runId, output)
      .then(() => true)
      .catch(() => false);
  }

  private async ensureEvent(
    plan: ExecutionPlan,
    artifact: ExecutionPlan["artifacts"][number],
    runId: string,
  ): Promise<void> {
    const expected = createPlanArtifactEventPayload(plan, artifact);
    const latest = (await this.store.listEvents(plan.threadId))
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
    await this.store.appendEvent({
      threadId: plan.threadId,
      runId,
      type: `plan.artifact.${artifact.status}`,
      category: "plan",
      visibility: "user",
      payload: expected,
    });
  }
}

function artifactById(plan: ExecutionPlan, artifactId: string) {
  const artifact = plan.artifacts.find(
    (candidate) => candidate.id === artifactId,
  );
  if (!artifact) throw new Error(`Artifact not found: ${artifactId}`);
  return artifact;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function validateOutput(output: RunBoundFileArtifact): void {
  if (
    !output.path ||
    output.path.length > 500 ||
    !/^[a-f0-9]{64}$/u.test(output.fileSha256) ||
    !Number.isSafeInteger(output.fileBytes) ||
    output.fileBytes < 1 ||
    !output.producedEvidence.trim() ||
    !output.verifiedEvidence.trim()
  ) {
    throw new Error("Run-bound file Artifact evidence is invalid");
  }
}
