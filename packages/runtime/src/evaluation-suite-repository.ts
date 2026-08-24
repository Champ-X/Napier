import {
  type CreateEvaluationSuiteRequest,
  type EvaluationSuite,
  type EvaluationSuiteExecution,
  type UpdateEvaluationSuiteRequest,
} from "@napier/contracts";
import {
  createEvaluationSuiteRecord,
  updateEvaluationSuiteRecord,
} from "./evaluation-suites.js";
import {
  assertEvaluationSuiteRuns,
  validateEvaluationSuiteExecution,
} from "./evaluation-suite-validation.js";

import type { StoreRepositoryHost } from "./store-repository-host.js";

export class EvaluationSuiteRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  listEvaluationSuites(threadId: string): EvaluationSuite[] {
    this.host.assertInitialized();
    this.host.getThread(threadId);
    return structuredClone(
      this.host.state.evaluationSuites
        .filter((suite) => suite.threadId === threadId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  getEvaluationSuite(suiteId: string): EvaluationSuite {
    this.host.assertInitialized();
    const suite = this.host.state.evaluationSuites.find(
      (candidate) => candidate.id === suiteId,
    );
    if (!suite) throw new Error(`Evaluation suite not found: ${suiteId}`);
    return structuredClone(suite);
  }

  async createEvaluationSuite(
    threadId: string,
    request: CreateEvaluationSuiteRequest,
  ): Promise<EvaluationSuite> {
    this.host.assertInitialized();
    const thread = this.host.getThread(threadId);
    const suite = createEvaluationSuiteRecord(
      threadId,
      request,
      this.host.getAgent(thread.agentId).model,
    );
    return this.host.stateQueue.run(async () => {
      assertEvaluationSuiteRuns(this.host.state.runs, suite);
      this.host.state.evaluationSuites.push(suite);
      await this.host.persistState();
      return structuredClone(suite);
    });
  }

  async updateEvaluationSuite(
    suiteId: string,
    request: UpdateEvaluationSuiteRequest,
  ): Promise<EvaluationSuite> {
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const index = this.host.state.evaluationSuites.findIndex(
        (candidate) => candidate.id === suiteId,
      );
      const current = this.host.state.evaluationSuites[index];
      if (!current) throw new Error(`Evaluation suite not found: ${suiteId}`);
      const updated = updateEvaluationSuiteRecord(current, request);
      assertEvaluationSuiteRuns(this.host.state.runs, updated);
      this.host.state.evaluationSuites[index] = updated;
      if (updated.revision !== current.revision) await this.host.persistState();
      return structuredClone(updated);
    });
  }

  listEvaluationSuiteExecutions(
    threadId: string,
    suiteId?: string,
  ): EvaluationSuiteExecution[] {
    this.host.assertInitialized();
    this.host.getThread(threadId);
    return structuredClone(
      this.host.state.evaluationSuiteExecutions
        .filter(
          (execution) =>
            execution.threadId === threadId &&
            (!suiteId || execution.suiteId === suiteId),
        )
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt)),
    );
  }

  async saveEvaluationSuiteExecution(
    execution: EvaluationSuiteExecution,
  ): Promise<EvaluationSuiteExecution> {
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      validateEvaluationSuiteExecution(
        execution,
        this.host.state.evaluationSuites,
        this.host.state.evaluations,
        this.host.state.runs,
      );
      if (
        this.host.state.evaluationSuiteExecutions.some(
          (candidate) => candidate.id === execution.id,
        )
      ) {
        throw new Error(
          `Evaluation suite execution already exists: ${execution.id}`,
        );
      }
      this.host.state.evaluationSuiteExecutions.push(
        structuredClone(execution),
      );
      const suiteExecutions = this.host.state.evaluationSuiteExecutions
        .filter((candidate) => candidate.suiteId === execution.suiteId)
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
      if (suiteExecutions.length > 20) {
        const removeIds = new Set(
          suiteExecutions
            .slice(0, suiteExecutions.length - 20)
            .map((candidate) => candidate.id),
        );
        this.host.state.evaluationSuiteExecutions =
          this.host.state.evaluationSuiteExecutions.filter(
            (candidate) => !removeIds.has(candidate.id),
          );
      }
      await this.host.persistState();
      return structuredClone(execution);
    });
  }
}
