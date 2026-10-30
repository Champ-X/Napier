import type { ExecutionPlan } from "@napier/contracts";
import {
  validToolFileReceipt,
  type ToolFileReceiptPayload,
} from "@napier/contracts/task-narrative";
import { canonicalJson, sha256 } from "./ed25519.js";
import { inspectWorkspaceFile } from "./task-deliverable-inspection.js";

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
  Pick<LocalStore, "workspaceRoot" | "listRuns" | "appendEventOnce">;

export interface RunBoundFileArtifact {
  operationId: string;
  path: string;
  fileSha256: string;
  fileBytes: number;
  toolName: ToolFileReceiptPayload["toolName"];
  action: ToolFileReceiptPayload["action"];
  materialization: ToolFileReceiptPayload["materialization"];
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
    const run = this.store
      .listRuns(owner.threadId)
      .find((entry) => entry.id === owner.runId);
    if (!run || run.status !== "running")
      return { status: "failed", reason: "artifact_registration_failed" };
    const result = await this.artifacts.register(
      owner,
      (artifact) => artifact.kind === "file" && artifact.path === output.path,
      (plan, artifactId, runId) => this.settle(plan, artifactId, runId, output),
    );
    if (
      result.reason !== "no_run_bound_plan" &&
      result.reason !== "no_matching_artifact"
    )
      return result;
    return this.registerToolFile(owner, output);
  }

  private async registerToolFile(
    owner: { threadId: string; runId: string },
    output: RunBoundFileArtifact,
  ): Promise<RunBoundFileArtifactRegistration> {
    const payload: ToolFileReceiptPayload = {
      ...owner,
      operationId: output.operationId,
      path: output.path,
      fileSha256: output.fileSha256,
      fileBytes: output.fileBytes,
      toolName: output.toolName,
      action: output.action,
      materialization: output.materialization,
      evidence: output.verifiedEvidence,
    };
    if (!validToolFileReceipt(payload))
      return { status: "failed", reason: "artifact_registration_failed" };
    try {
      const observed = await inspectWorkspaceFile(
        this.store.workspaceRoot,
        output.path,
      );
      if (
        observed.status !== "observed" ||
        observed.sha256 !== output.fileSha256 ||
        observed.sizeBytes !== output.fileBytes
      )
        throw new Error("Tool file is not the verified workspace version");
      await this.store.appendEventOnce(
        {
          ...owner,
          type: "artifact.tool_file_verified",
          category: "artifact",
          visibility: "user",
          payload,
        },
        {
          namespace: "tool-file-receipt-v1",
          key: sha256(
            canonicalJson({
              ...owner,
              toolName: output.toolName,
              operationId: output.operationId,
            }),
          ),
        },
      );
      return { status: "registered", reason: "artifact_registered" };
    } catch {
      return { status: "failed", reason: "artifact_registration_failed" };
    }
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
    typeof output.operationId !== "string" ||
    !output.operationId.trim() ||
    output.operationId.length > 256 ||
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
