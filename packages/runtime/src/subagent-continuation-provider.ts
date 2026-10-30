import type { SubagentTask } from "@napier/contracts";
import type { SubagentHandle, SubagentMessage } from "@napier/contracts/subagent-supervisor";
import type { SubagentProviderOptions } from "./subagent-provider-options.js";
import { createProcessLeaseOwnerId } from "./ids.js";
import { SubagentExecutionControl } from "./subagent-execution-control.js";
import { SubagentTaskRunner } from "./subagent-task-runner.js";
import type { PreparedSubagentChildContinuation, SubagentChildContinuationAssessment,
  SubagentChildContinuationAuthorization } from "./subagent-continuation-types.js";

type RunnerResult = Awaited<ReturnType<SubagentTaskRunner["execute"]>>;
export interface SubagentContinuationLaunch {
  kind: "started" | "existing";
  handle: SubagentHandle;
}
export interface SubagentActiveExecution {
  handle: SubagentHandle;
  control: SubagentExecutionControl;
  abort: AbortController;
  settled: Promise<{ result?: RunnerResult; error?: unknown }>;
}

/** Claim only after scheduler admission. An existing claim never grants another worker a lease. */
export async function launchSubagentContinuation(input: {
  options: SubagentProviderOptions;
  prepared: PreparedSubagentChildContinuation;
  assessment: SubagentChildContinuationAssessment;
  authorization: SubagentChildContinuationAuthorization;
  assertParentBudgetAvailable?: () => void;
  register(execution: SubagentActiveExecution): void;
  delivered(task: SubagentTask, message: SubagentMessage): Promise<void>;
}): Promise<SubagentContinuationLaunch> {
  const { options, assessment } = input;
  if (assessment.targetParentRunId !== options.run.id || assessment.threadId !== options.run.threadId)
    throw new Error("Child continuation belongs to another provider parent");
  const source = options.store.listSubagentTasks(assessment.threadId).find((task) => task.id === assessment.sourceTaskId);
  if (!source) throw new Error("Child continuation source is unavailable");
  const model = options.modelRouter
    ? await options.modelRouter.resolveConfigured(source.model)
    : options.models.getModel(source.model.provider, source.model.id);
  if (!model) throw new Error("Child continuation model is unavailable");
  const abort = new AbortController();
  const forwardAbort = () => abort.abort(options.parentSignal.reason);
  options.parentSignal.addEventListener("abort", forwardAbort, { once: true });
  if (options.parentSignal.aborted) forwardAbort();
  let resolveStart!: (value: SubagentContinuationLaunch) => void;
  let rejectStart!: (error: unknown) => void;
  const started = new Promise<SubagentContinuationLaunch>((resolve, reject) => { resolveStart = resolve; rejectStart = reject; });
  const execute = async () => {
    abort.signal.throwIfAborted();
    const result = await options.store.startSubagentChildContinuation({
      prepared: input.prepared, authorization: input.authorization,
      lease: { ownerId: createProcessLeaseOwnerId("subworker"), ttlMs: 60_000 },
    });
    const task = result.kind === "started" ? result.execution.task : result.task;
    const handle: SubagentHandle = { kind: "napier.subagent-handle", schemaVersion: 1,
      providerId: "in_process", taskId: task.id, executionId: task.executionId! };
    if (result.kind === "existing") { resolveStart({ kind: "existing", handle }); return; }
    const control = new SubagentExecutionControl((message) => input.delivered(task, message));
    const runner = new SubagentTaskRunner({
      store: options.store, models: options.models, model,
      ...(options.modelCallServices ? { modelCallServices: options.modelCallServices } : {}),
      run: options.run, limits: result.execution.profile.subagentLimits!,
      parentProfile: options.profile, parentSignal: options.parentSignal,
      concurrencyGate: options.concurrencyGate, control,
      ...(input.assertParentBudgetAvailable ? { assertParentBudgetAvailable: input.assertParentBudgetAvailable } : {}),
      ...(options.createInheritedTools ? { createInheritedTools: options.createInheritedTools } : {}),
      ...(options.cleanupExecutionResources ? { cleanupExecutionResources: options.cleanupExecutionResources } : {}),
      ...(options.modelRouter ? { createModelRoute: (run) => options.modelRouter!.createSession({
        run, primary: model, explicitPrimary: true, profile: result.execution.profile,
        subagentRole: task.role, selectionSource: options.run.source ?? "user",
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      }) } : {}),
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    });
    input.register({ handle, control, abort, settled });
    resolveStart({ kind: "started", handle });
    return runner.resume(result, abort.signal);
  };
  const settled: SubagentActiveExecution["settled"] = Promise.resolve()
    .then(() => options.schedule ? options.schedule(execute) : execute())
    .then((result) => result ? { result } : {}, (error: unknown) => { rejectStart(error); return { error }; })
    .finally(() => options.parentSignal.removeEventListener("abort", forwardAbort));
  return started;
}
