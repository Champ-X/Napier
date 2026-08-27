import type {
  CancelSubagentHubTaskRequestV1,
  ReviveSubagentHubTaskRequestV1,
  SteerSubagentHubTaskRequestV1,
  SubagentHubActionResultV1,
  SubagentHubControlAvailabilityV1,
} from "@napier/contracts/subagent-hub";
import type { SubagentTask } from "@napier/contracts/subagent-supervisor";

import { nowIso } from "./ids.js";
import type { LocalStore } from "./store.js";
import type { SubagentCoordinator } from "./subagents.js";

interface Registration {
  coordinator: Pick<
    SubagentCoordinator,
    "steerTask" | "cancelTask" | "reviveTask" | "reviveUnavailableReason"
  >;
  runId: string;
  threadId: string;
  registeredAt: number;
}

export class SubagentHubControlService {
  private readonly registrations = new Map<string, Registration>();
  private nextRegistration = 0;

  constructor(private readonly store: LocalStore) {}

  register(
    threadId: string,
    runId: string,
    coordinator: Registration["coordinator"] | undefined,
  ): () => void {
    if (!coordinator) return () => {};
    const registration = {
      coordinator,
      runId,
      threadId,
      registeredAt: this.nextRegistration++,
    };
    this.registrations.set(runId, registration);
    return () => {
      if (this.registrations.get(runId) === registration) {
        this.registrations.delete(runId);
      }
    };
  }

  availability(task: SubagentTask): SubagentHubControlAvailabilityV1 {
    this.prune();
    const active = task.status === "pending" || task.status === "running";
    const executionAvailable = this.registrations.has(task.runId);
    const revival = this.revivalRegistration(task);
    if (active && executionAvailable) {
      return { steer: true, cancel: true, revive: false };
    }
    const reviveUnavailable =
      revival?.coordinator.reviveUnavailableReason(task);
    if (!active && revival && !reviveUnavailable) {
      return { steer: false, cancel: false, revive: true };
    }
    return {
      steer: false,
      cancel: false,
      revive: false,
      unavailableReason: active
        ? "execution_unavailable"
        : (reviveUnavailable ??
          (task.role === "coder" && !task.writePaths
            ? "coder_write_scope_unavailable"
            : "parent_run_not_running")),
    };
  }

  async steer(
    threadId: string,
    taskId: string,
    request: SteerSubagentHubTaskRequestV1,
  ): Promise<SubagentHubActionResultV1> {
    const task = this.task(threadId, taskId);
    const registration = this.registrations.get(task.runId);
    if (!registration) throw new Error("Subagent execution is unavailable");
    const message = await registration.coordinator.steerTask(
      task.id,
      request.expectedTaskRevision,
      { kind: request.messageKind, text: request.text },
    );
    return result("steer", task, { messageId: message.id });
  }

  async cancel(
    threadId: string,
    taskId: string,
    request: CancelSubagentHubTaskRequestV1,
  ): Promise<SubagentHubActionResultV1> {
    const task = this.task(threadId, taskId);
    const registration = this.registrations.get(task.runId);
    if (!registration) throw new Error("Subagent execution is unavailable");
    await registration.coordinator.cancelTask(
      task.id,
      request.expectedTaskRevision,
      request.reason,
    );
    return result("cancel", task);
  }

  async revive(
    threadId: string,
    taskId: string,
    request: ReviveSubagentHubTaskRequestV1,
  ): Promise<SubagentHubActionResultV1> {
    const task = this.task(threadId, taskId);
    const registration = this.revivalRegistration(task);
    if (!registration) {
      throw new Error("No active parent Run can revive this Subagent");
    }
    const handle = await registration.coordinator.reviveTask(
      task,
      request.expectedTaskRevision,
    );
    return result("revive", task, {
      taskId: handle.taskId,
      executionId: handle.executionId,
    });
  }

  private task(threadId: string, taskId: string): SubagentTask {
    const task = this.store
      .listSubagentTasks(threadId)
      .find((candidate) => candidate.id === taskId);
    if (!task) throw new Error("Subagent task not found");
    return task;
  }

  private revivalRegistration(task: SubagentTask): Registration | undefined {
    if (
      task.status === "pending" ||
      task.status === "running" ||
      (task.role === "coder" && !task.writePaths)
    ) {
      return undefined;
    }
    return [...this.registrations.values()]
      .filter(
        (registration) =>
          registration.threadId === task.threadId &&
          this.store
            .listRuns(task.threadId)
            .some(
              (run) =>
                run.id === registration.runId && run.status === "running",
            ),
      )
      .sort((left, right) => right.registeredAt - left.registeredAt)[0];
  }

  private prune(): void {
    for (const [runId, registration] of this.registrations) {
      const run = this.store
        .listRuns(registration.threadId)
        .find((candidate) => candidate.id === runId);
      const activeTask = this.store
        .listSubagentTasks(registration.threadId, runId)
        .some((task) => task.status === "pending" || task.status === "running");
      if (run?.status !== "running" && !activeTask) {
        this.registrations.delete(runId);
      }
    }
  }
}

function result(
  action: SubagentHubActionResultV1["action"],
  source: SubagentTask,
  override: { taskId?: string; executionId?: string; messageId?: string } = {},
): SubagentHubActionResultV1 {
  return {
    kind: "napier.subagent-hub-action-result",
    schemaVersion: 1,
    action,
    sourceTaskId: source.id,
    sourceTaskRevision: source.revision,
    taskId: override.taskId ?? source.id,
    ...(override.executionId ? { executionId: override.executionId } : {}),
    ...(override.messageId ? { messageId: override.messageId } : {}),
    acceptedAt: nowIso(),
  };
}
