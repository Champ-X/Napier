import type { ExecutionPlan } from "@napier/contracts";

import {
  ensureRunBoundArtifactEvent,
  RunBoundArtifactRegistrar,
  type RunBoundArtifactRegistration,
  type RunBoundArtifactStore,
  runBoundArtifactById,
} from "./run-bound-artifact.js";

export type RunBoundUrlArtifactStore = RunBoundArtifactStore;

export interface RunBoundUrlArtifact {
  url: string;
  contentSha256: string;
  contentBytes: number;
  producedEvidence: string;
  verifiedEvidence: string;
}

export type RunBoundUrlArtifactRegistration = RunBoundArtifactRegistration;

export class RunBoundUrlArtifactRegistrar {
  private readonly artifacts: RunBoundArtifactRegistrar;

  constructor(private readonly store: RunBoundUrlArtifactStore) {
    this.artifacts = new RunBoundArtifactRegistrar(store);
  }

  async register(
    owner: { threadId: string; runId: string },
    source: RunBoundUrlArtifact,
  ): Promise<RunBoundUrlArtifactRegistration> {
    validateSource(source);
    return this.artifacts.register(
      owner,
      (artifact) => artifact.kind === "url" && artifact.path === source.url,
      (plan, artifactId, runId) => this.settle(plan, artifactId, runId, source),
    );
  }

  private async settle(
    plan: ExecutionPlan,
    artifactId: string,
    runId: string,
    source: RunBoundUrlArtifact,
  ): Promise<ExecutionPlan> {
    let current = plan;
    let artifact = runBoundArtifactById(current, artifactId);
    if (
      artifact.kind !== "url" ||
      artifact.path !== source.url ||
      (artifact.sourceRunId !== undefined && artifact.sourceRunId !== runId)
    ) {
      throw new Error("Run-bound URL Artifact identity changed");
    }
    if (artifact.status === "expected") {
      current = await this.store.updatePlanArtifact(current.id, artifact.id, {
        status: "produced",
        sourceRunId: runId,
        sizeBytes: source.contentBytes,
        evidence: source.producedEvidence,
      });
      artifact = runBoundArtifactById(current, artifactId);
      await ensureRunBoundArtifactEvent(this.store, current, artifact, runId);
    }
    if (artifact.status === "produced") {
      await ensureRunBoundArtifactEvent(this.store, current, artifact, runId);
      current = await this.store.updatePlanArtifact(current.id, artifact.id, {
        status: "verified",
        sourceRunId: runId,
        sha256: source.contentSha256,
        sizeBytes: source.contentBytes,
        evidence: source.verifiedEvidence,
      });
      artifact = runBoundArtifactById(current, artifactId);
      await ensureRunBoundArtifactEvent(this.store, current, artifact, runId);
    }
    if (
      artifact.status !== "verified" ||
      artifact.kind !== "url" ||
      artifact.path !== source.url ||
      artifact.sourceRunId !== runId ||
      artifact.sha256 !== source.contentSha256 ||
      artifact.sizeBytes !== source.contentBytes
    ) {
      throw new Error("Run-bound URL Artifact registration is incomplete");
    }
    await ensureRunBoundArtifactEvent(this.store, current, artifact, runId);
    return current;
  }
}

function validateSource(source: RunBoundUrlArtifact): void {
  const url = new URL(source.url);
  if (
    url.toString() !== source.url ||
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    !/^[a-f0-9]{64}$/u.test(source.contentSha256) ||
    !Number.isSafeInteger(source.contentBytes) ||
    source.contentBytes < 1 ||
    !source.producedEvidence.trim() ||
    !source.verifiedEvidence.trim()
  ) {
    throw new Error("Run-bound URL Artifact evidence is invalid");
  }
}
