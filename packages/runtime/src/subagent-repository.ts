import type { RunRecord, SubagentTask, ThreadRecord } from "@napier/contracts";

import { createId, nowIso } from "./ids.js";
import {
  createSubagentTaskRecord,
  finishSubagentTaskRecord,
  setSubagentSupervisorStatusRecord,
  startSubagentTaskRecord,
  type CreateSubagentTaskInput,
  type FinishSubagentTaskInput,
} from "./subagent-store-records.js";

const TERMINAL_STATUSES = new Set<SubagentTask["status"]>([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);

export interface SubagentRepositoryState {
  threads: readonly ThreadRecord[];
  runs: readonly RunRecord[];
  subagents: SubagentTask[];
}

export interface SubagentRepositoryMutation<T> {
  value: T;
  changed: boolean;
}

export interface SubagentRepositoryHost {
  assertReady(): void;
  read(): SubagentRepositoryState;
  mutate<T>(
    operation: (
      state: SubagentRepositoryState,
    ) => SubagentRepositoryMutation<T>,
  ): Promise<T>;
}

/** Owns the Subagent aggregate while LocalStore remains a compatibility facade. */
export class SubagentRepository {
  constructor(private readonly host: SubagentRepositoryHost) {}

  list(threadId: string, runId?: string): SubagentTask[] {
    this.host.assertReady();
    return structuredClone(
      this.host
        .read()
        .subagents.filter(
          (task) =>
            task.threadId === threadId && (!runId || task.runId === runId),
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  create(input: CreateSubagentTaskInput): Promise<SubagentTask> {
    this.host.assertReady();
    return this.host.mutate((state) => {
      if (!state.threads.some((thread) => thread.id === input.threadId)) {
        throw new Error(`Thread not found: ${input.threadId}`);
      }
      const run = state.runs.find((candidate) => candidate.id === input.runId);
      if (!run || run.threadId !== input.threadId) {
        throw new Error(
          `Run ${input.runId} does not belong to thread ${input.threadId}`,
        );
      }
      if (run.status !== "running") {
        throw new Error(`Cannot delegate from run in ${run.status} state`);
      }
      const task = createSubagentTaskRecord(input, createId("task"), nowIso());
      state.subagents.push(task);
      return changed(task);
    });
  }

  start(taskId: string): Promise<SubagentTask> {
    return this.update(taskId, (task) =>
      startSubagentTaskRecord(task, nowIso()),
    );
  }

  progress(
    taskId: string,
    input: {
      stepDelta?: number;
      turnDelta?: number;
      usage?: SubagentTask["usage"];
    },
  ): Promise<SubagentTask> {
    return this.update(taskId, (task) => {
      task.stepCount += Math.max(0, input.stepDelta ?? 0);
      task.turnCount += Math.max(0, input.turnDelta ?? 0);
      if (input.usage) task.usage = structuredClone(input.usage);
      task.revision += 1;
    });
  }

  finish(
    taskId: string,
    input: FinishSubagentTaskInput,
  ): Promise<SubagentTask> {
    return this.update(taskId, (task) =>
      finishSubagentTaskRecord(task, input, nowIso()),
    );
  }

  setSupervisorStatus(
    taskId: string,
    status: NonNullable<SubagentTask["supervisorStatus"]>,
  ): Promise<SubagentTask> {
    return this.update(taskId, (task) =>
      setSubagentSupervisorStatusRecord(task, status),
    );
  }

  private update(
    taskId: string,
    operation: (task: SubagentTask) => void,
  ): Promise<SubagentTask> {
    this.host.assertReady();
    return this.host.mutate((state) => {
      const task = state.subagents.find((candidate) => candidate.id === taskId);
      if (!task) throw new Error(`Subagent task not found: ${taskId}`);
      if (TERMINAL_STATUSES.has(task.status)) return unchanged(task);
      operation(task);
      return changed(task);
    });
  }
}

function changed(task: SubagentTask): SubagentRepositoryMutation<SubagentTask> {
  return { value: structuredClone(task), changed: true };
}

function unchanged(
  task: SubagentTask,
): SubagentRepositoryMutation<SubagentTask> {
  return { value: structuredClone(task), changed: false };
}

export type {
  CreateSubagentTaskInput,
  FinishSubagentTaskInput,
} from "./subagent-store-records.js";
