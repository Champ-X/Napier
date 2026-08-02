import type { ArtifactManifestEntry, ExecutionPlan } from "@napier/contracts";

import type { EventSink } from "./event-sink.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import {
  createWorkspaceArtifactDriftRequest,
  createWorkspaceArtifactVerificationRequest,
  inspectWorkspaceArtifactDrift,
} from "./plan-tools.js";
import { createPlanArtifactEventPayload } from "./plans.js";
import type { LocalStore } from "./store.js";
import type { WorkflowExecutionContext } from "./workflow-context.js";

export const WORKFLOW_ARTIFACTS_SETTLED_EVENT = "workflow.artifacts.settled";
export const WORKFLOW_ARTIFACTS_FAILED_EVENT = "workflow.artifacts.failed";

export interface WorkflowArtifactSettlementOutcome {
  complete: boolean;
  artifactCount: number;
  verifiedCount: number;
  missingCount: number;
  failedCount: number;
  artifactSetSha256: string;
}

export class ExecutionPlanWorkflowArtifactSettlement {
  constructor(private readonly store: LocalStore) {}

  async settleTerminal(
    context: WorkflowExecutionContext,
  ): Promise<"completed" | "blocked" | "cancelled"> {
    let settlement;
    try {
      settlement = await this.settle({
        threadId: context.threadId,
        planId: context.plan.id,
        manifestSha256: context.manifest.contentSha256,
        ...(context.signal ? { signal: context.signal } : {}),
        ...(context.onEvent ? { onEvent: context.onEvent } : {}),
      });
    } catch (error) {
      if (context.signal?.aborted) return "cancelled";
      throw error;
    }
    if (context.signal?.aborted) return "cancelled";
    context.plan = this.store.getPlan(context.plan.id);
    if (!settlement.complete) return "blocked";
    if (context.plan.status !== "completed") {
      throw new Error("Workflow Artifact settlement did not complete its Plan");
    }
    return "completed";
  }

  async settle(options: {
    threadId: string;
    planId: string;
    manifestSha256: string;
    signal?: AbortSignal;
    onEvent?: EventSink;
  }): Promise<WorkflowArtifactSettlementOutcome> {
    let plan = this.store.getPlan(options.planId);
    if (plan.threadId !== options.threadId) {
      throw new Error("Workflow Artifact Plan does not belong to the Thread");
    }
    if (plan.artifacts.length === 0) {
      return outcome(plan, 0);
    }
    let failedCount = 0;
    for (const declared of plan.artifacts) {
      options.signal?.throwIfAborted();
      const artifact = plan.artifacts.find(
        (candidate) => candidate.id === declared.id,
      )!;
      try {
        plan = await this.settleArtifact(
          plan,
          artifact,
          options.signal,
          options.onEvent,
        );
      } catch (error) {
        options.signal?.throwIfAborted();
        plan = this.store.getPlan(options.planId);
        failedCount += 1;
        await this.appendUnique(
          {
            threadId: options.threadId,
            runId: createId("runctl"),
            type: WORKFLOW_ARTIFACTS_FAILED_EVENT,
            category: "plan",
            visibility: "user",
            payload: {
              schemaVersion: 1,
              planId: plan.id,
              manifestSha256: options.manifestSha256,
              artifactId: artifact.id,
              artifactCount: plan.artifacts.length,
              artifactSetSha256: artifactSetSha256(plan.artifacts),
              errorCode: artifactFailureCode(error),
              diagnosticSha256: sha256(errorMessage(error)),
            },
          },
          options.onEvent,
        );
      }
      options.signal?.throwIfAborted();
    }
    plan = this.store.getPlan(options.planId);
    const result = outcome(plan, failedCount);
    await this.appendUnique(
      {
        threadId: options.threadId,
        runId: createId("runctl"),
        type: result.complete
          ? WORKFLOW_ARTIFACTS_SETTLED_EVENT
          : WORKFLOW_ARTIFACTS_FAILED_EVENT,
        category: "plan",
        visibility: "user",
        payload: {
          schemaVersion: 1,
          planId: plan.id,
          manifestSha256: options.manifestSha256,
          artifactCount: result.artifactCount,
          verifiedCount: result.verifiedCount,
          missingCount: result.missingCount,
          failedCount: result.failedCount,
          artifactSetSha256: result.artifactSetSha256,
          planRevision: plan.revision,
          complete: result.complete,
        },
      },
      options.onEvent,
    );
    return result;
  }

  private async settleArtifact(
    plan: ExecutionPlan,
    artifact: ArtifactManifestEntry,
    signal?: AbortSignal,
    onEvent?: EventSink,
  ): Promise<ExecutionPlan> {
    signal?.throwIfAborted();
    if (artifact.kind !== "file" && artifact.kind !== "directory") {
      throw new Error("Workflow Artifact kind is unsupported");
    }
    if (artifact.status === "superseded") {
      throw new Error("Workflow declared Artifact was superseded");
    }
    if (artifact.status === "verified") {
      const drift = await inspectWorkspaceArtifactDrift(
        this.store.workspaceRoot,
        artifact,
      );
      signal?.throwIfAborted();
      if (drift.result === "current") {
        await this.ensureArtifactEvent(plan, artifact, onEvent);
        signal?.throwIfAborted();
        return plan;
      }
      const missing = await createWorkspaceArtifactDriftRequest(
        this.store.workspaceRoot,
        artifact,
        {
          evidence:
            "Workflow settlement found declared Artifact workspace drift.",
        },
      );
      signal?.throwIfAborted();
      const updated = await this.store.updatePlanArtifact(
        plan.id,
        artifact.id,
        missing,
      );
      await this.ensureArtifactEvent(
        updated,
        artifactById(updated, artifact.id),
        onEvent,
      );
      signal?.throwIfAborted();
      return updated;
    }
    let verification;
    try {
      verification = await createWorkspaceArtifactVerificationRequest(
        this.store.workspaceRoot,
        artifact,
        {
          evidence:
            "Workflow settlement verified current declared Artifact bytes.",
        },
      );
      signal?.throwIfAborted();
    } catch (error) {
      signal?.throwIfAborted();
      if (!isMissingFileError(error)) throw error;
      const missing = await this.markMissing(
        plan,
        artifact,
        "Workflow settlement could not find the declared Artifact.",
        onEvent,
      );
      signal?.throwIfAborted();
      return missing;
    }
    let current = plan;
    let observed = artifact;
    if (artifact.status !== "produced") {
      current = await this.store.updatePlanArtifact(plan.id, artifact.id, {
        status: "produced",
        evidence: "Workflow settlement observed declared Artifact bytes.",
        ...(verification.sizeBytes !== undefined
          ? { sizeBytes: verification.sizeBytes }
          : {}),
      });
      observed = artifactById(current, artifact.id);
      await this.ensureArtifactEvent(current, observed, onEvent);
      signal?.throwIfAborted();
    } else {
      await this.ensureArtifactEvent(current, observed, onEvent);
      signal?.throwIfAborted();
    }
    let currentVerification;
    try {
      currentVerification = await createWorkspaceArtifactVerificationRequest(
        this.store.workspaceRoot,
        observed,
        {
          evidence:
            "Workflow settlement verified current declared Artifact bytes.",
        },
      );
      signal?.throwIfAborted();
    } catch (error) {
      signal?.throwIfAborted();
      if (!isMissingFileError(error)) throw error;
      const missing = await this.markMissing(
        current,
        observed,
        "Workflow settlement lost the declared Artifact before verification.",
        onEvent,
      );
      signal?.throwIfAborted();
      return missing;
    }
    const verified = await this.store.updatePlanArtifact(
      current.id,
      artifact.id,
      currentVerification,
    );
    await this.ensureArtifactEvent(
      verified,
      artifactById(verified, artifact.id),
      onEvent,
    );
    signal?.throwIfAborted();
    return verified;
  }

  private async markMissing(
    plan: ExecutionPlan,
    artifact: ArtifactManifestEntry,
    evidence: string,
    onEvent?: EventSink,
  ): Promise<ExecutionPlan> {
    if (artifact.status === "missing") {
      await this.ensureArtifactEvent(plan, artifact, onEvent);
      return plan;
    }
    const updated = await this.store.updatePlanArtifact(plan.id, artifact.id, {
      status: "missing",
      evidence,
    });
    await this.ensureArtifactEvent(
      updated,
      artifactById(updated, artifact.id),
      onEvent,
    );
    return updated;
  }

  private async ensureArtifactEvent(
    plan: ExecutionPlan,
    artifact: ArtifactManifestEntry,
    onEvent?: EventSink,
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
    await this.append(
      {
        threadId: plan.threadId,
        runId: artifact.sourceRunId ?? createId("runctl"),
        type: `plan.artifact.${artifact.status}`,
        category: "plan",
        visibility: "user",
        payload: expected,
      },
      onEvent,
    );
  }

  private async appendUnique(
    input: Parameters<LocalStore["appendEvent"]>[0],
    onEvent?: EventSink,
  ): Promise<void> {
    const expected = canonicalJson(input.payload);
    const exists = (await this.store.listEvents(input.threadId)).some(
      (event) =>
        event.type === input.type && canonicalJson(event.payload) === expected,
    );
    if (!exists) await this.append(input, onEvent);
  }

  private async append(
    input: Parameters<LocalStore["appendEvent"]>[0],
    onEvent?: EventSink,
  ): Promise<void> {
    const event = await this.store.appendEvent(input);
    if (!onEvent) return;
    try {
      await onEvent(event);
    } catch {
      // Durable settlement evidence survives a disconnected observer.
    }
  }
}

function outcome(
  plan: ExecutionPlan,
  failedCount: number,
): WorkflowArtifactSettlementOutcome {
  const verifiedCount = plan.artifacts.filter(
    (artifact) => artifact.status === "verified",
  ).length;
  const missingCount = plan.artifacts.filter(
    (artifact) => artifact.status === "missing",
  ).length;
  return {
    complete: verifiedCount === plan.artifacts.length && failedCount === 0,
    artifactCount: plan.artifacts.length,
    verifiedCount,
    missingCount,
    failedCount,
    artifactSetSha256: artifactSetSha256(plan.artifacts),
  };
}

function artifactSetSha256(artifacts: ArtifactManifestEntry[]): string {
  return sha256(
    canonicalJson(
      artifacts.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        pathSha256: sha256(artifact.path),
        status: artifact.status,
        sha256: artifact.sha256 ?? null,
        sizeBytes: artifact.sizeBytes ?? null,
      })),
    ),
  );
}

function artifactById(
  plan: ExecutionPlan,
  artifactId: string,
): ArtifactManifestEntry {
  const artifact = plan.artifacts.find(
    (candidate) => candidate.id === artifactId,
  );
  if (!artifact) throw new Error("Workflow Artifact disappeared from Plan");
  return artifact;
}

function artifactFailureCode(error: unknown): string {
  if (isMissingFileError(error)) return "missing";
  const message = errorMessage(error);
  if (/drift/iu.test(message)) return "drifted";
  if (/limit|exceed|large/iu.test(message)) return "limit";
  if (/escape|symlink|symbolic|outside/iu.test(message)) {
    return "scope_denied";
  }
  return "verification_failed";
}

function isMissingFileError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
