import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Api, Model, MutableModels } from "@earendil-works/pi-ai";
import type {
  AgentProfile,
  RunEvent,
  RunRecord,
  SubagentLimits,
  SubagentRole,
  SubagentTask,
} from "@napier/contracts";
import { Type } from "typebox";

import { DEFAULT_SUBAGENT_LIMITS, normalizeSubagentLimits } from "./agents.js";
import {
  delegationIntentSha256,
  findReusableDelegation,
} from "./delegation-ledger.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import type { LocalStore } from "./store.js";
import type { DelegationDetails } from "./subagent-task-evidence.js";
import { SubagentTaskRunner } from "./subagent-task-runner.js";
import {
  createSubagentWorktreeApplyTool,
  SubagentWorktreeMutationManager,
} from "./subagent-worktree-mutation.js";
import { MAX_SUBAGENT_WORKTREE_WRITE_FILES } from "./subagent-worktree-files.js";
import { WriteLinkedTestVerificationRunner } from "./write-linked-test-verification.js";

export {
  delegateTaskCallArgumentsLedgerProjection,
  delegateTaskInputLedgerProjection,
  delegateTaskOutputLedgerProjection,
} from "./subagent-task-evidence.js";

const delegateTaskSchema = Type.Object({
  role: Type.Union([
    Type.Literal("researcher"),
    Type.Literal("reviewer"),
    Type.Literal("general"),
    Type.Literal("coder"),
  ]),
  description: Type.String({
    minLength: 1,
    maxLength: 180,
    description: "Short task label shown in the delegation ledger.",
  }),
  task: Type.String({
    minLength: 1,
    maxLength: 8_000,
    description:
      "Self-contained task with relevant paths, constraints, and expected evidence.",
  }),
  writePaths: Type.Optional(
    Type.Array(
      Type.String({
        minLength: 1,
        maxLength: 500,
        description:
          "Existing workspace-relative UTF-8 file that the coder may modify only inside its private worktree.",
      }),
      { minItems: 1, maxItems: MAX_SUBAGENT_WORKTREE_WRITE_FILES },
    ),
  ),
});

const DEFAULT_ROLES: SubagentRole[] = ["researcher", "reviewer", "general"];

type EventSink = (event: RunEvent) => Promise<void> | void;

export interface SubagentCoordinatorOptions {
  store: LocalStore;
  models: MutableModels;
  model: Model<Api>;
  run: RunRecord;
  profile: AgentProfile;
  sandbox: OsSandboxAdapter;
  worktreeOwnerId: string;
  parentSignal: AbortSignal;
  onEvent?: EventSink;
}

class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}

export class SubagentCoordinator {
  private readonly limits: SubagentLimits;
  private readonly enabledRoles: Set<SubagentRole>;
  private readonly semaphore: Semaphore;
  private readonly worktrees?: SubagentWorktreeMutationManager;
  private readonly runner: SubagentTaskRunner;
  private readonly reservedIntentSha256 = new Set<string>();
  private totalDelegations: number;

  constructor(private readonly options: SubagentCoordinatorOptions) {
    this.limits = normalizeSubagentLimits(
      options.profile.subagentLimits ??
        structuredClone(DEFAULT_SUBAGENT_LIMITS),
    );
    this.enabledRoles = new Set(
      options.profile.enabledSubagents ?? DEFAULT_ROLES,
    );
    if (this.enabledRoles.has("coder")) {
      if (
        options.profile.toolPolicy === "observe" ||
        !options.profile.enabledTools.includes("apply_patch") ||
        !options.profile.enabledTools.includes("lsp_diagnostics")
      ) {
        throw new Error(
          "Coder Subagents require workspace policy plus apply_patch and lsp_diagnostics",
        );
      }
      const tests = options.profile.enabledTools.includes("verify_workspace")
        ? new WriteLinkedTestVerificationRunner({
            workspaceRoot: options.store.workspaceRoot,
            sandbox: options.sandbox,
          })
        : undefined;
      this.worktrees = new SubagentWorktreeMutationManager({
        workspaceRoot: options.store.workspaceRoot,
        dataRoot: options.store.dataRoot,
        ownerId: options.worktreeOwnerId,
        sandbox: options.sandbox,
        ...(tests ? { tests } : {}),
      });
    }
    this.runner = new SubagentTaskRunner({
      store: options.store,
      models: options.models,
      model: options.model,
      run: options.run,
      limits: this.limits,
      parentSignal: options.parentSignal,
      ...(this.worktrees ? { worktrees: this.worktrees } : {}),
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    });
    this.semaphore = new Semaphore(this.limits.maxConcurrent);
    this.totalDelegations = options.store.listSubagentTasks(
      options.run.threadId,
      options.run.id,
    ).length;
  }

  hasEnabledRoles(): boolean {
    return this.enabledRoles.size > 0;
  }

  createTools(): AgentTool[] {
    return [
      this.createTool(),
      ...(this.worktrees
        ? [createSubagentWorktreeApplyTool(this.worktrees)]
        : []),
    ];
  }

  createTool(): AgentTool<typeof delegateTaskSchema, DelegationDetails> {
    return {
      name: "delegate_task",
      label: "Delegate task",
      description: [
        "Delegate a substantial independent investigation, review, or path-scoped coding task to an isolated subagent.",
        `Available roles: ${[...this.enabledRoles].join(", ")}.`,
        `Run budget: at most ${this.limits.maxTotal} total and ${this.limits.maxConcurrent} concurrent delegations.`,
        "Coder tasks require explicit existing writePaths and return an unmerged one-use worktree preview.",
        "Do not delegate trivial work or tasks that require the parent conversation.",
      ].join(" "),
      parameters: delegateTaskSchema,
      execute: async (_toolCallId, input, signal) => {
        if (!this.enabledRoles.has(input.role)) {
          throw new Error(`Subagent role is disabled: ${input.role}`);
        }
        if (
          (input.role === "coder" && !input.writePaths) ||
          (input.role !== "coder" && input.writePaths !== undefined)
        ) {
          throw new Error(
            "Only coder Subagents require explicit existing writePaths",
          );
        }
        const prompt = input.task.trim();
        const reusable = findReusableDelegation(
          this.options.store.listSubagentTasks(this.options.run.threadId),
          input.role,
          prompt,
        );
        if (reusable) {
          throw new Error(
            `Delegation intent already has durable ${reusable.status} task ${reusable.id}; reuse it instead of delegating again`,
          );
        }
        const intentSha256 = delegationIntentSha256(input.role, prompt);
        if (this.reservedIntentSha256.has(intentSha256)) {
          throw new Error(
            "Delegation intent is already being created; reuse the durable task instead",
          );
        }
        if (this.totalDelegations >= this.limits.maxTotal) {
          throw new Error(
            `Subagent total budget exhausted (${this.limits.maxTotal})`,
          );
        }
        this.totalDelegations += 1;
        this.reservedIntentSha256.add(intentSha256);
        let task: SubagentTask;
        try {
          task = await this.options.store.createSubagentTask({
            threadId: this.options.run.threadId,
            runId: this.options.run.id,
            role: input.role,
            description: input.description.trim(),
            prompt,
            model: {
              provider: this.options.model.provider,
              id: this.options.model.id,
            },
          });
        } catch (error) {
          this.totalDelegations -= 1;
          throw error;
        } finally {
          this.reservedIntentSha256.delete(intentSha256);
        }
        await this.emit("subagent.queued", task, {
          taskId: task.id,
          role: task.role,
          description: task.description,
          status: task.status,
        });
        return this.semaphore.run(() =>
          this.runner.execute(task, task.prompt, signal, input.writePaths),
        );
      },
    };
  }

  private async emit(
    type: string,
    task: SubagentTask,
    payload: unknown,
  ): Promise<void> {
    const event = await this.options.store.appendEvent({
      threadId: task.threadId,
      runId: task.runId,
      type,
      category: "subagent",
      visibility: "user",
      payload: toJsonValue(payload),
    });
    if (this.options.onEvent) {
      try {
        await this.options.onEvent(event);
      } catch {
        // Delegation persists even when the live stream disconnects.
      }
    }
  }
}

function toJsonValue(value: unknown): import("@napier/contracts").JsonValue {
  try {
    return JSON.parse(
      JSON.stringify(value),
    ) as import("@napier/contracts").JsonValue;
  } catch {
    return String(value);
  }
}
