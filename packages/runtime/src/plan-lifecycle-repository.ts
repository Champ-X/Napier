import {
  type CreateExecutionPlanFromBlueprintRecordRequest,
  type CreateExecutionPlanRequest,
  type ExecutionPlan,
  type ExecutionPlanBlueprintRecord,
  type ExecutionPlanBlueprintRecordPreview,
  type ExecutionPlanBlueprintRecordQualification,
  type ExecutionPlanBlueprintRecordReplayEventVerification,
  type ReplanExecutionPlanRequest,
  type RunEvent,
  type UpdateArtifactManifestRequest,
  type VerifyExecutionPlanBlueprintRecordReplayEventRequest
} from "@napier/contracts";
import {
  withExecutionPlanBlueprintRecordPreviewHash
} from "./execution-plan-blueprint-replay-projection.js";
import {
  verifyExecutionPlanBlueprintRecordReplayEventProjection
} from "./execution-plan-blueprint-replay-verification.js";
import { createId,nowIso } from "./ids.js";
import {
  createExecutionPlan,
  recoverCompletedPlanStep as recoverCompletedPlanStepProjection,
  replanExecutionPlan,
  transitionPlanStep,
  updateArtifactManifest,
  type InternalPlanStepRequest
} from "./plans.js";
import {
  storeSha256 as sha256
} from "./store-hashing.js";
import type { StoreRepositoryHost } from "./store-repository-host.js";
import {
  executionPlanRequestFromBlueprint
} from "./workflow-blueprints.js";

function normalizeOptionalSha256(
  value: string | undefined,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

export class PlanLifecycleRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  async verifyExecutionPlanBlueprintRecordReplayEvent(
      recordId: string,
      request: VerifyExecutionPlanBlueprintRecordReplayEventRequest,
    ): Promise<ExecutionPlanBlueprintRecordReplayEventVerification> {
      this.host.assertInitialized();
      this.host.getExecutionPlanBlueprintRecord(recordId);
      const threadExists = this.host.state.threads.some(
        (thread) => thread.id === request.threadId,
      );
      const events = threadExists ? await this.host.listEvents(request.threadId) : [];
      return verifyExecutionPlanBlueprintRecordReplayEventProjection(
        recordId,
        request,
        events,
      );
    }

  async previewPlanFromBlueprintRecord(
      threadId: string,
      request: CreateExecutionPlanFromBlueprintRecordRequest,
    ): Promise<ExecutionPlanBlueprintRecordPreview> {
      this.host.assertInitialized();
      this.host.getThread(threadId);
      const qualification = await this.host.qualifyExecutionPlanBlueprintRecord(
        request.recordId,
      );
      const hasOpenPlan = this.host.state.plans.some(
        (candidate) =>
          candidate.threadId === threadId &&
          (candidate.status === "active" || candidate.status === "blocked"),
      );
      const base = {
        threadId,
        recordId: request.recordId,
        qualification,
        hasOpenPlan,
      };
      if (qualification.status !== "qualified") {
        return withExecutionPlanBlueprintRecordPreviewHash({
          ...base,
          status: "not_qualified",
          diagnostics: qualification.diagnostics,
        });
      }
      const record = this.host.state.executionPlanBlueprints.find(
        (candidate) => candidate.id === request.recordId,
      );
      if (!record || record.status !== "active") {
        return withExecutionPlanBlueprintRecordPreviewHash({
          ...base,
          status: "not_qualified",
          diagnostics: ["record_missing"],
        });
      }
      if (hasOpenPlan) {
        return withExecutionPlanBlueprintRecordPreviewHash({
          ...base,
          status: "blocked",
          diagnostics: ["thread_has_open_plan"],
        });
      }
      return withExecutionPlanBlueprintRecordPreviewHash({
        ...base,
        status: "ready",
        diagnostics: [],
        plan: createExecutionPlan(
          threadId,
          executionPlanRequestFromBlueprint(record.blueprint, request.objective),
        ),
      });
    }

  async createPlanFromBlueprintRecord(
      threadId: string,
      request: CreateExecutionPlanFromBlueprintRecordRequest,
    ): Promise<{
      plan: ExecutionPlan;
      record: ExecutionPlanBlueprintRecord;
      qualification: ExecutionPlanBlueprintRecordQualification;
      event: RunEvent;
      previewSha256: string;
    }> {
      this.host.assertInitialized();
      this.host.getThread(threadId);
      const preview = await this.host.previewPlanFromBlueprintRecord(
        threadId,
        request,
      );
      if (preview.status !== "ready") {
        throw new Error(
          `Execution plan blueprint record is not ready: ${preview.status}`,
        );
      }
      const expectedPreviewSha256 = normalizeOptionalSha256(
        request.expectedPreviewSha256,
        "Execution plan blueprint preview hash",
      );
      if (
        expectedPreviewSha256 !== undefined &&
        expectedPreviewSha256 !== preview.previewSha256
      ) {
        throw new Error("Execution plan blueprint preview hash mismatch");
      }
      return this.host.stateQueue.run(async () => {
        const record = this.host.state.executionPlanBlueprints.find(
          (candidate) => candidate.id === request.recordId,
        );
        if (!record || record.status !== "active") {
          throw new Error(
            `Execution plan blueprint not found: ${request.recordId}`,
          );
        }
        const plan = createExecutionPlan(
          threadId,
          executionPlanRequestFromBlueprint(record.blueprint, request.objective),
        );
        if (
          this.host.state.plans.some(
            (candidate) =>
              candidate.threadId === threadId &&
              (candidate.status === "active" || candidate.status === "blocked"),
          )
        ) {
          throw new Error("Thread already has an open execution plan");
        }
        this.host.state.plans.push(plan);
        const currentThread = this.host.mutableThread(threadId);
        const event: RunEvent = {
          id: createId("event"),
          threadId,
          runId: createId("runctl"),
          seq: currentThread.eventCount + 1,
          type: "plan.created",
          category: "plan",
          visibility: "user",
          createdAt: nowIso(),
          payload: {
            planId: plan.id,
            objective: plan.objective,
            status: plan.status,
            stepCount: plan.steps.length,
            artifactCount: plan.artifacts.length,
            criticalPathStepIds: plan.criticalPathStepIds,
            readyStepIds: plan.readyStepIds,
            blockedStepIds: plan.blockedStepIds,
            activePhaseIndex: plan.activePhaseIndex,
            parallelReadyStepIds: plan.parallelReadyStepIds,
            phaseWaveCount: plan.phaseWaves.length,
            phaseProjectionSha256: plan.phaseProjectionSha256,
            blueprintRecordId: record.id,
            blueprintSha256: record.blueprintSha256,
            blueprintSourcePlanId: record.sourcePlanId,
            blueprintSourcePlanRevision: record.sourcePlanRevision,
            blueprintSourceArchiveSha256: record.sourcePlanArchiveSha256,
            blueprintQualificationStatus: preview.qualification.status,
            blueprintQualificationSha256: sha256(
              JSON.stringify(preview.qualification),
            ),
            blueprintQualificationDiagnosticsSha256: sha256(
              JSON.stringify(preview.qualification.diagnostics),
            ),
            blueprintPreviewSha256: preview.previewSha256,
          },
        };
        currentThread.eventCount = event.seq;
        currentThread.updatedAt = event.createdAt;
        await this.host.persistState(event);
        return {
          plan: structuredClone(plan),
          record: structuredClone(record),
          qualification: structuredClone(preview.qualification),
          event: structuredClone(event),
          previewSha256: preview.previewSha256,
        };
      });
    }

  async createPlan(
      threadId: string,
      request: CreateExecutionPlanRequest,
    ): Promise<ExecutionPlan> {
      this.host.assertInitialized();
      this.host.getThread(threadId);
      const plan = createExecutionPlan(threadId, request);
      return this.host.stateQueue.run(async () => {
        if (
          this.host.state.plans.some(
            (candidate) =>
              candidate.threadId === threadId && candidate.status === "active",
          )
        ) {
          throw new Error("Thread already has an active execution plan");
        }
        this.host.state.plans.push(plan);
        await this.host.persistState();
        return structuredClone(plan);
      });
    }

  async replanPlan(
      planId: string,
      request: ReplanExecutionPlanRequest,
    ): Promise<ExecutionPlan> {
      this.host.assertInitialized();
      return this.host.stateQueue.run(async () => {
        const index = this.host.state.plans.findIndex(
          (candidate) => candidate.id === planId,
        );
        const current = this.host.state.plans[index];
        if (!current) throw new Error(`Plan not found: ${planId}`);
        const updated = replanExecutionPlan(current, request);
        this.host.state.plans[index] = updated;
        if (updated.revision !== current.revision) await this.host.persistState();
        return structuredClone(updated);
      });
    }

  async transitionPlanStep(
      planId: string,
      stepId: string,
      request: InternalPlanStepRequest,
    ): Promise<ExecutionPlan> {
      this.host.assertInitialized();
      return this.host.stateQueue.run(async () => {
        const index = this.host.state.plans.findIndex(
          (candidate) => candidate.id === planId,
        );
        const current = this.host.state.plans[index];
        if (!current) throw new Error(`Plan not found: ${planId}`);
        if (request.action === "start") {
          if (!request.runId) {
            throw new Error("Starting a plan step requires a runId");
          }
          const run = this.host.state.runs.find(
            (candidate) => candidate.id === request.runId,
          );
          if (
            !run ||
            run.threadId !== current.threadId ||
            run.status !== "running"
          ) {
            throw new Error(
              "Plan steps must start in a running run from the same thread",
            );
          }
        }
        const updated = transitionPlanStep(current, stepId, request);
        this.host.state.plans[index] = updated;
        if (updated.revision !== current.revision) await this.host.persistState();
        return structuredClone(updated);
      });
    }

  async recoverCompletedWorkflowPlanStep(
      planId: string,
      stepId: string,
      runId: string,
      evidence: string,
    ): Promise<ExecutionPlan> {
      this.host.assertInitialized();
      return this.host.stateQueue.run(async () => {
        const index = this.host.state.plans.findIndex(
          (candidate) => candidate.id === planId,
        );
        const current = this.host.state.plans[index];
        if (!current) throw new Error(`Plan not found: ${planId}`);
        const run = this.host.state.runs.find((candidate) => candidate.id === runId);
        if (
          !run ||
          run.threadId !== current.threadId ||
          run.source !== "workflow" ||
          (run.status !== "completed" && run.status !== "interrupted")
        ) {
          throw new Error(
            "Recovered Workflow completion requires its completed or interrupted Run",
          );
        }
        const updated = recoverCompletedPlanStepProjection(
          current,
          stepId,
          runId,
          evidence,
        );
        this.host.state.plans[index] = updated;
        await this.host.persistState();
        return structuredClone(updated);
      });
    }

  async updatePlanArtifact(
      planId: string,
      artifactId: string,
      request: UpdateArtifactManifestRequest,
    ): Promise<ExecutionPlan> {
      this.host.assertInitialized();
      return this.host.stateQueue.run(async () => {
        const index = this.host.state.plans.findIndex(
          (candidate) => candidate.id === planId,
        );
        const current = this.host.state.plans[index];
        if (!current) throw new Error(`Plan not found: ${planId}`);
        if (request.sourceRunId) {
          const run = this.host.state.runs.find(
            (candidate) => candidate.id === request.sourceRunId,
          );
          if (!run || run.threadId !== current.threadId) {
            throw new Error(
              "Artifact sourceRunId must belong to the plan thread",
            );
          }
        }
        const updated = updateArtifactManifest(current, artifactId, request);
        this.host.state.plans[index] = updated;
        if (updated.revision !== current.revision) await this.host.persistState();
        return structuredClone(updated);
      });
    }
}
