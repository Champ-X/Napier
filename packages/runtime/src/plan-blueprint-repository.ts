import {
  type ExecutionPlan,
  type ExecutionPlanBlueprintRecord,
  type ExecutionPlanBlueprintRecordQualification,
  type ExecutionPlanBlueprintRecordReplay,
  type ExecutionPlanBlueprintRecordReplayHistory,
  type ExecutionPlanBlueprintRecordReplayHistoryVerification,
  type ExecutionPlanBlueprintRecordReplayOutcomes,
  type ExecutionPlanBlueprintRecordReplayOutcomesVerification,
  type SaveExecutionPlanBlueprintRequest,
  type SaveExecutionPlanBlueprintResult,
  type SetExecutionPlanBlueprintRecordStatusRequest
} from "@napier/contracts";
import {
  createExecutionPlanBlueprintRecordReplayHistory,
  createExecutionPlanBlueprintRecordReplayOutcome,
  createExecutionPlanBlueprintRecordReplayOutcomes,
  executionPlanBlueprintRecordReplayFromEvent
} from "./execution-plan-blueprint-replay-projection.js";
import {
  verifyExecutionPlanBlueprintRecordReplayHistoryProjection,
  verifyExecutionPlanBlueprintRecordReplayOutcomesProjection
} from "./execution-plan-blueprint-replay-verification.js";
import { createId,nowIso } from "./ids.js";
import type { StoreRepositoryHost } from "./store-repository-host.js";
import {
  createExecutionPlanBlueprintRecord,
  qualifyExecutionPlanBlueprintRecord as qualifyExecutionPlanBlueprintRecordProjection,
  setExecutionPlanBlueprintRecordStatus,
  validateExecutionPlanBlueprint
} from "./workflow-blueprints.js";



export class PlanBlueprintRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  listPlans(threadId: string): ExecutionPlan[] {
      this.host.assertInitialized();
      this.host.getThread(threadId);
      return structuredClone(
        this.host.state.plans
          .filter((plan) => plan.threadId === threadId)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      );
    }

  getPlan(planId: string): ExecutionPlan {
      this.host.assertInitialized();
      const plan = this.host.state.plans.find((candidate) => candidate.id === planId);
      if (!plan) throw new Error(`Plan not found: ${planId}`);
      return structuredClone(plan);
    }

  listExecutionPlanBlueprints(
      status?: ExecutionPlanBlueprintRecord["status"],
    ): ExecutionPlanBlueprintRecord[] {
      this.host.assertInitialized();
      return structuredClone(
        this.host.state.executionPlanBlueprints
          .filter((record) => (status ? record.status === status : true))
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      );
    }

  getExecutionPlanBlueprintRecord(
      recordId: string,
    ): ExecutionPlanBlueprintRecord {
      this.host.assertInitialized();
      const record = this.host.state.executionPlanBlueprints.find(
        (candidate) => candidate.id === recordId,
      );
      if (!record) {
        throw new Error(`Execution plan blueprint not found: ${recordId}`);
      }
      return structuredClone(record);
    }

  async saveExecutionPlanBlueprint(
      threadId: string,
      request: SaveExecutionPlanBlueprintRequest,
    ): Promise<SaveExecutionPlanBlueprintResult> {
      this.host.assertInitialized();
      this.host.getThread(threadId);
      const blueprint = validateExecutionPlanBlueprint(request.blueprint);
      return this.host.stateQueue.run(async () => {
        const existing = this.host.state.executionPlanBlueprints.find(
          (record) =>
            record.status === "active" &&
            record.blueprintSha256 === blueprint.contentSha256,
        );
        if (existing) {
          return {
            record: structuredClone(existing),
            created: false,
          };
        }
        const record = createExecutionPlanBlueprintRecord({
          id: createId("blueprint"),
          blueprint,
          createdByThreadId: threadId,
          createdAt: nowIso(),
          ...(request.name ? { name: request.name } : {}),
          ...(request.description !== undefined
            ? { description: request.description }
            : {}),
        });
        this.host.state.executionPlanBlueprints.push(record);
        await this.host.persistState();
        return {
          record: structuredClone(record),
          created: true,
        };
      });
    }

  async setExecutionPlanBlueprintRecordStatus(
      recordId: string,
      request: SetExecutionPlanBlueprintRecordStatusRequest,
    ): Promise<ExecutionPlanBlueprintRecord> {
      this.host.assertInitialized();
      return this.host.stateQueue.run(async () => {
        const index = this.host.state.executionPlanBlueprints.findIndex(
          (candidate) => candidate.id === recordId,
        );
        const current = this.host.state.executionPlanBlueprints[index];
        if (!current) {
          throw new Error(`Execution plan blueprint not found: ${recordId}`);
        }
        const updated = setExecutionPlanBlueprintRecordStatus(
          current,
          request.status,
          nowIso(),
        );
        this.host.state.executionPlanBlueprints[index] = updated;
        await this.host.persistState();
        return structuredClone(updated);
      });
    }

  async qualifyExecutionPlanBlueprintRecord(
      recordId: string,
    ): Promise<ExecutionPlanBlueprintRecordQualification> {
      this.host.assertInitialized();
      return qualifyExecutionPlanBlueprintRecordProjection(this.host, recordId);
    }

  async getExecutionPlanBlueprintRecordReplayHistory(
      recordId: string,
    ): Promise<ExecutionPlanBlueprintRecordReplayHistory> {
      this.host.assertInitialized();
      this.getExecutionPlanBlueprintRecord(recordId);
      const replays: ExecutionPlanBlueprintRecordReplay[] = [];
      for (const thread of this.host.state.threads) {
        const events = await this.host.listEvents(thread.id);
        for (const event of events) {
          const replay = executionPlanBlueprintRecordReplayFromEvent(
            event,
            recordId,
          );
          if (replay) replays.push(replay);
        }
      }
      return createExecutionPlanBlueprintRecordReplayHistory(recordId, replays);
    }

  async verifyExecutionPlanBlueprintRecordReplayHistory(
      recordId: string,
      input: unknown,
    ): Promise<ExecutionPlanBlueprintRecordReplayHistoryVerification> {
      this.host.assertInitialized();
      this.getExecutionPlanBlueprintRecord(recordId);
      const observed =
        await this.getExecutionPlanBlueprintRecordReplayHistory(recordId);
      return verifyExecutionPlanBlueprintRecordReplayHistoryProjection(
        input,
        recordId,
        observed,
      );
    }

  async getExecutionPlanBlueprintRecordReplayOutcomes(
      recordId: string,
    ): Promise<ExecutionPlanBlueprintRecordReplayOutcomes> {
      this.host.assertInitialized();
      this.getExecutionPlanBlueprintRecord(recordId);
      const history =
        await this.getExecutionPlanBlueprintRecordReplayHistory(recordId);
      const outcomes = history.replays.map((replay) =>
        createExecutionPlanBlueprintRecordReplayOutcome(
          replay,
          this.host.state.plans.find((plan) => plan.id === replay.planId),
        ),
      );
      return createExecutionPlanBlueprintRecordReplayOutcomes(
        recordId,
        history.contentSha256,
        outcomes,
      );
    }

  async verifyExecutionPlanBlueprintRecordReplayOutcomes(
      recordId: string,
      input: unknown,
    ): Promise<ExecutionPlanBlueprintRecordReplayOutcomesVerification> {
      this.host.assertInitialized();
      this.getExecutionPlanBlueprintRecord(recordId);
      const observed =
        await this.getExecutionPlanBlueprintRecordReplayOutcomes(recordId);
      return verifyExecutionPlanBlueprintRecordReplayOutcomesProjection(
        input,
        recordId,
        observed,
      );
    }
}
