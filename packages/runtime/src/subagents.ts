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
import type { ModelRouteRequest } from "@napier/contracts/model-route";
import { Type } from "typebox";

import { DEFAULT_SUBAGENT_LIMITS, normalizeSubagentLimits } from "./agents.js";
import {
  delegationFailureContextSha256,
  delegationIntentSha256,
  findReusableDelegation,
} from "./delegation-ledger.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import type { LocalStore } from "./store.js";
import { InProcessSubagentProvider } from "./in-process-subagent-provider.js";
import { ModelRouter } from "./model-route.js";
import { resolveModelRouteSelection } from "./model-route-resolution.js";
import type { DelegationDetails } from "./subagent-task-evidence.js";
import { SubagentSupervisor } from "./subagent-supervisor.js";
import {
  createSubagentSupervisorTools,
  subagentRequestFromToolInput,
  type SubagentStartToolInput,
} from "./subagent-supervisor-tools.js";
import {
  createSubagentWorktreeApplyTool,
  SubagentWorktreeMutationManager,
} from "./subagent-worktree-mutation.js";
import { MAX_SUBAGENT_WORKTREE_WRITE_FILES } from "./subagent-worktree-files.js";
import { SUBAGENT_WORKTREE_FILE_TOOL_SCHEMA_SHA256 } from "./subagent-worktree-file-tool.js";
import { isSubagentSemanticLspToolName } from "./subagent-worktree-lsp-tools.js";
import { WriteLinkedTestVerificationRunner } from "./write-linked-test-verification.js";
import type { WorkspaceProcessManager } from "./workspace-processes.js";
import {
  TOOL_MINIMUM_DEADLINE_MS,
  type ToolMinimumDeadline,
} from "./tool-deadline-policy.js";

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
  }),
  task: Type.String({
    minLength: 1,
    maxLength: 8_000,
  }),
  writePaths: Type.Optional(
    Type.Array(
      Type.String({
        minLength: 1,
        maxLength: 500,
      }),
      { minItems: 1, maxItems: MAX_SUBAGENT_WORKTREE_WRITE_FILES },
    ),
  ),
  outputSchema: Type.Optional(Type.Unknown()),
});

const DEFAULT_ROLES: SubagentRole[] = ["researcher", "reviewer", "general"];
const SUBAGENT_DELEGATION_SETTLEMENT_BUFFER_MS = 30_000;

type EventSink = (event: RunEvent) => Promise<void> | void;

export interface SubagentCoordinatorOptions {
  store: LocalStore;
  models: MutableModels;
  model: Model<Api>;
  modelRouter?: ModelRouter;
  modelRouteRequest?: ModelRouteRequest;
  run: RunRecord;
  profile: AgentProfile;
  sandbox: OsSandboxAdapter;
  processes?: WorkspaceProcessManager | undefined;
  createInheritedTools?: () => AgentTool[];
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
  private readonly supervisor: SubagentSupervisor;
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
        ...(options.processes ? { processes: options.processes } : {}),
        debuggerOwner: {
          threadId: options.run.threadId,
          runId: options.run.id,
        },
        enableCandidateDebugger:
          options.profile.enabledTools.includes("node_debugger"),
        enableCandidateVerification:
          options.profile.enabledTools.includes("verify_workspace"),
        enableCandidateCommand:
          options.profile.enabledTools.includes("run_command"),
        enabledSemanticLspTools: options.profile.enabledTools.filter(
          isSubagentSemanticLspToolName,
        ),
        ...(tests ? { tests } : {}),
      });
    }
    this.semaphore = new Semaphore(this.limits.maxConcurrent);
    this.supervisor = new SubagentSupervisor(
      new InProcessSubagentProvider({
        store: options.store,
        models: options.models,
        ...(options.modelRouter ? { modelRouter: options.modelRouter } : {}),
        defaultModel: options.model,
        profile: options.profile,
        run: options.run,
        limits: this.limits,
        parentSignal: options.parentSignal,
        schedule: (operation) => this.semaphore.run(operation),
        ...(this.worktrees ? { worktrees: this.worktrees } : {}),
        ...(options.createInheritedTools
          ? { createInheritedTools: options.createInheritedTools }
          : {}),
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      }),
    );
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

  createSupervisorTools(): AgentTool[] {
    return createSubagentSupervisorTools({
      providerId: "in_process",
      supervisor: this.supervisor,
      start: (request, signal) => this.startTask(request, signal),
      collectResult: collectedSupervisorToolResult,
    }).map((tool) =>
      tool.name === "subagent_collect"
        ? ({
            ...tool,
            [TOOL_MINIMUM_DEADLINE_MS]: this.delegationDeadlineMs(),
          } as AgentTool & ToolMinimumDeadline)
        : tool,
    );
  }

  async steerTask(
    taskId: string,
    expectedTaskRevision: number,
    input: { kind: "steering" | "input"; text: string },
  ) {
    const task = this.boundTask(taskId, expectedTaskRevision);
    return this.supervisor.send(taskHandle(task), input);
  }

  async cancelTask(
    taskId: string,
    expectedTaskRevision: number,
    reason: string,
  ): Promise<void> {
    const task = this.boundTask(taskId, expectedTaskRevision);
    await this.supervisor.cancel(taskHandle(task), reason);
  }

  async reviveTask(source: SubagentTask, expectedTaskRevision: number) {
    const current = this.options.store
      .listSubagentTasks(source.threadId)
      .find((task) => task.id === source.id);
    if (!current || current.revision !== expectedTaskRevision) {
      throw new Error("Subagent task revision changed; refresh and retry");
    }
    if (current.status === "pending" || current.status === "running") {
      throw new Error("Subagent task is not terminal");
    }
    if (current.role === "coder" && !current.writePaths) {
      throw new Error("Coder Subagent write scope is unavailable");
    }
    return this.startTask({
      role: current.role,
      description: current.description,
      task: current.prompt,
      ...(current.writePaths ? { writePaths: [...current.writePaths] } : {}),
      ...(current.outputSchema ? { outputSchema: current.outputSchema } : {}),
      revivedFromTaskId: current.id,
    });
  }

  reviveUnavailableReason(
    source: SubagentTask,
  ):
    | "delegation_budget_exhausted"
    | "role_disabled"
    | "coder_write_scope_unavailable"
    | undefined {
    if (!this.enabledRoles.has(source.role)) return "role_disabled";
    if (this.totalDelegations >= this.limits.maxTotal) {
      return "delegation_budget_exhausted";
    }
    if (source.role === "coder" && !source.writePaths) {
      return "coder_write_scope_unavailable";
    }
    return undefined;
  }

  createTool(): AgentTool<typeof delegateTaskSchema, DelegationDetails> {
    return {
      name: "delegate_task",
      label: "Delegate task",
      description: [
        "Delegate substantial independent research, review, or scoped coding.",
        `Roles: ${[...this.enabledRoles].join(", ")}.`,
        `Run budget: at most ${this.limits.maxTotal} total and ${this.limits.maxConcurrent} concurrent delegations.`,
        "description is a short ledger label; task must be self-contained with paths, constraints, and evidence.",
        "Only coder uses writePaths listing every created, changed, deleted, or moved endpoint; returns an isolated unmerged one-use worktree preview.",
      ].join(" "),
      parameters: delegateTaskSchema,
      [TOOL_MINIMUM_DEADLINE_MS]: this.delegationDeadlineMs(),
      execute: async (_toolCallId, input, signal) =>
        collectedToolResult(
          await this.supervisor.collect(await this.startTask(input, signal)),
        ),
    } as AgentTool<typeof delegateTaskSchema, DelegationDetails> &
      ToolMinimumDeadline;
  }

  private delegationDeadlineMs(): number {
    return this.limits.timeoutMs + SUBAGENT_DELEGATION_SETTLEMENT_BUFFER_MS;
  }

  private async startTask(input: SubagentStartToolInput, signal?: AbortSignal) {
    if (!this.enabledRoles.has(input.role)) {
      throw new Error(`Subagent role is disabled: ${input.role}`);
    }
    if (
      (input.role === "coder" && !input.writePaths) ||
      (input.role !== "coder" && input.writePaths !== undefined)
    ) {
      throw new Error("Only coder Subagents require explicit writePaths");
    }
    const prompt = input.task.trim();
    const failureContextSha256 =
      input.role === "coder"
        ? coderFailureContextSha256(this.options.profile, {
            ...this.subagentModel(input.role),
          })
        : undefined;
    const reusable = input.revivedFromTaskId
      ? undefined
      : findReusableDelegation(
          this.options.store.listSubagentTasks(this.options.run.threadId),
          input.role,
          prompt,
          ...(failureContextSha256 ? [{ failureContextSha256 }] : []),
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
    try {
      const request = subagentRequestFromToolInput(input, {
        threadId: this.options.run.threadId,
        runId: this.options.run.id,
        ...(this.options.modelRouteRequest
          ? { modelRoute: this.options.modelRouteRequest }
          : {}),
      });
      return await this.supervisor.start(request, {
        ...(signal ? { signal } : {}),
        ...(failureContextSha256 ? { failureContextSha256 } : {}),
      });
    } catch (error) {
      this.totalDelegations -= 1;
      throw error;
    } finally {
      this.reservedIntentSha256.delete(intentSha256);
    }
  }

  private boundTask(taskId: string, expectedTaskRevision: number) {
    const task = this.options.store
      .listSubagentTasks(this.options.run.threadId, this.options.run.id)
      .find((candidate) => candidate.id === taskId);
    if (!task) throw new Error("Subagent execution is unavailable");
    if (task.revision !== expectedTaskRevision) {
      throw new Error("Subagent task revision changed; refresh and retry");
    }
    if (task.status !== "pending" && task.status !== "running") {
      throw new Error("Subagent task is not active");
    }
    return task;
  }

  private subagentModel(role: SubagentRole) {
    return resolveModelRouteSelection({
      agentDefault: {
        provider: this.options.model.provider,
        id: this.options.model.id,
      },
      ...(this.options.profile.modelRoute
        ? { policy: this.options.profile.modelRoute }
        : {}),
      ...(this.options.modelRouteRequest
        ? { request: this.options.modelRouteRequest }
        : {}),
      source: this.options.run.source ?? "user",
      subagentRole: role,
    }).targets[0]!.model;
  }
}

function taskHandle(task: SubagentTask) {
  if (!task.providerId || !task.executionId) {
    throw new Error("Subagent execution is unavailable");
  }
  return {
    kind: "napier.subagent-handle" as const,
    schemaVersion: 1 as const,
    providerId: task.providerId,
    taskId: task.id,
    executionId: task.executionId,
  };
}

export function coderFailureContextSha256(
  profile: Pick<AgentProfile, "enabledTools" | "toolPolicy">,
  model: SubagentTask["model"],
): string {
  return delegationFailureContextSha256({
    role: "coder",
    model,
    toolSchemaSha256: delegationIntentSha256(
      "coder",
      JSON.stringify({
        candidateFileSchemaSha256: SUBAGENT_WORKTREE_FILE_TOOL_SCHEMA_SHA256,
        enabledTools: profile.enabledTools.slice().sort(),
        toolPolicy: profile.toolPolicy,
      }),
    ),
  });
}

function collectedToolResult(
  collected: Awaited<ReturnType<SubagentSupervisor["collect"]>>,
): {
  content: Array<{ type: "text"; text: string }>;
  details: DelegationDetails;
} {
  if (collected.status !== "completed") {
    if (
      collected.task.stopReason === "cancelled" &&
      collected.task.startedAt === undefined
    ) {
      throw new Error("Subagent task cancelled before start");
    }
    throw new Error(
      `Delegation ${collected.task.id} ${collected.status}: ${collected.task.error ?? "Subagent did not complete"}`,
    );
  }
  const value = collected.providerResult;
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Subagent provider result is unavailable");
  }
  return value as unknown as {
    content: Array<{ type: "text"; text: string }>;
    details: DelegationDetails;
  };
}

function collectedSupervisorToolResult(
  collected: Awaited<ReturnType<SubagentSupervisor["collect"]>>,
) {
  const task = collected.task;
  return {
    content: [
      {
        type: "text" as const,
        text:
          collected.status === "completed"
            ? `Subagent ${task.id} completed; inspect structured details for its output.`
            : `Subagent ${task.id} ended ${collected.status}: ${task.error ?? "no diagnostic"}`,
      },
    ],
    details: {
      kind: collected.kind,
      schemaVersion: collected.schemaVersion,
      handle: collected.handle,
      status: collected.status,
      taskId: task.id,
      role: task.role,
      stopReason: task.stopReason ?? null,
      ...(task.error ? { error: task.error } : {}),
      ...(collected.outcome ? { outcome: collected.outcome } : {}),
      ...(collected.output !== undefined ? { output: collected.output } : {}),
      ...(collected.outputSchemaSha256
        ? { outputSchemaSha256: collected.outputSchemaSha256 }
        : {}),
    },
  };
}
