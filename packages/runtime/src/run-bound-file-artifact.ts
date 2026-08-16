import type { ExecutionPlan } from "@napier/contracts";

import { createWorkspaceArtifactVerificationRequest } from "./plan-tools.js";
import {
  ensureRunBoundArtifactEvent,
  RunBoundArtifactRegistrar,
  type RunBoundArtifactRegistration,
  type RunBoundArtifactStore,
  runBoundArtifactById,
} from "./run-bound-artifact.js";
import type { LocalStore } from "./store.js";

export type RunBoundFileArtifactStore = RunBoundArtifactStore &
  Pick<LocalStore, "workspaceRoot">;

export interface RunBoundFileArtifact {
  path: string;
  fileSha256: string;
  fileBytes: number;
  producedEvidence: string;
  verifiedEvidence: string;
}

export type RunBoundFileArtifactRegistration = RunBoundArtifactRegistration;

export class RunBoundFileArtifactRegistrar {
  private readonly artifacts: RunBoundArtifactRegistrar;

  constructor(private readonly store: RunBoundFileArtifactStore) {
    this.artifacts = new RunBoundArtifactRegistrar(store);
  }

  async register(
    owner: { threadId: string; runId: string },
    output: RunBoundFileArtifact,
  ): Promise<RunBoundFileArtifactRegistration> {
    validateOutput(output);
    return this.artifacts.register(
      owner,
      (artifact) => artifact.kind === "file" && artifact.path === output.path,
      (plan, artifactId, runId) => this.settle(plan, artifactId, runId, output),
    );
  }

  private async settle(
    plan: ExecutionPlan,
    artifactId: string,
    runId: string,
    output: RunBoundFileArtifact,
  ): Promise<ExecutionPlan> {
    let current = plan;
    let artifact = runBoundArtifactById(current, artifactId);
    if (artifact.sourceRunId !== undefined && artifact.sourceRunId !== runId) {
      throw new Error("Run-bound file Artifact belongs to another Run");
    }
    if (artifact.status === "expected" || artifact.status === "candidate") {
      current = await this.store.updatePlanArtifact(current.id, artifact.id, {
        status: "produced",
        sourceRunId: runId,
        sizeBytes: output.fileBytes,
        evidence: output.producedEvidence,
      });
      artifact = runBoundArtifactById(current, artifactId);
      await ensureRunBoundArtifactEvent(this.store, current, artifact, runId);
    }
    if (artifact.status === "produced") {
      await ensureRunBoundArtifactEvent(this.store, current, artifact, runId);
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
      artifact = runBoundArtifactById(current, artifactId);
      await ensureRunBoundArtifactEvent(this.store, current, artifact, runId);
    }
    if (
      artifact.status !== "verified" ||
      artifact.sourceRunId !== runId ||
      artifact.sha256 !== output.fileSha256 ||
      artifact.sizeBytes !== output.fileBytes
    ) {
      throw new Error("Run-bound file Artifact registration is incomplete");
    }
    await ensureRunBoundArtifactEvent(this.store, current, artifact, runId);
    return current;
  }
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
