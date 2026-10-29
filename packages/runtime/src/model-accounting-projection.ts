import type { RunEvent, RunRecord, SubagentTask } from "@napier/contracts";
import { canonicalJson } from "./ed25519.js";
import { foldModelAccounting, hasModelAccounting } from "./model-accounting-fold.js";
import type { SubagentChildRunHost } from "./subagent-child-run-host.js";
type AccountingProjectionHost = Pick<SubagentChildRunHost, "state" | "mutableRun" | "requireLedger">;

export function refreshRunAccounting(host: AccountingProjectionHost, runId: string, added: readonly RunEvent[] = []): boolean {
  const run = host.mutableRun(runId);
  const events = [...host.requireLedger().listRunEvents(runId), ...added.filter((event) => event.runId === runId)];
  const tasks = host.state.subagents.filter((task) => task.runId === runId);
  if (!run.accounting && !hasModelAccounting(events, tasks)) return false;
  const before = canonicalJson({ usage: run.usage, status: run.usageStatus ?? null, accounting: run.accounting ?? null });
  apply(run, tasks, events);
  let changed = before !== canonicalJson({ usage: run.usage, status: run.usageStatus ?? null, accounting: run.accounting ?? null });
  if (run.subagent) {
    const task = host.state.subagents.find((value) => value.id === run.subagent!.taskId);
    if (!task || task.childRunId !== run.id) throw new Error("Accounting child Task binding is unavailable");
    task.usage = structuredClone(run.usage);
    task.usageStatus = run.usageStatus!;
    task.accounting = structuredClone(run.accounting!);
    if (run.parentRunId) changed = refreshRunAccounting(host, run.parentRunId, added) || changed;
  }
  return changed;
}

export function assertUnsealedAccountingChild(host: AccountingProjectionHost, run: RunRecord): void {
  if (!run.subagent) return;
  const task = host.state.subagents.find((value) => value.id === run.subagent!.taskId);
  const hasSuccessor = host.state.runs.some((value) => value.subagent?.continuation?.predecessorRunId === run.id);
  if (!task || task.completionReservation || task.completion || task.status === "completed" || run.status === "completed" || hasSuccessor)
    throw new Error("Model accounting reconciliation required: child completion or continuation is sealed");
}

export function assertAccountingProjection(run: RunRecord, tasks: readonly SubagentTask[], events: readonly RunEvent[]): void {
  if (!run.accounting && !hasModelAccounting(events, tasks)) return;
  if (run.accounting && (!Number.isSafeInteger(run.accounting.revision) || run.accounting.revision < 1))
    throw new Error("Model accounting revision is invalid");
  const expected = foldModelAccounting(events, tasks, run.accounting);
  if (!run.accounting || canonicalJson(run.usage) !== canonicalJson(expected.usage) ||
      run.usageStatus !== expected.summary.usageStatus || canonicalJson(run.accounting) !== canonicalJson(expected.summary))
    throw new Error("Model accounting projection differs from durable evidence");
}

function apply(run: RunRecord, tasks: readonly SubagentTask[], events: readonly RunEvent[]): void {
  const result = foldModelAccounting(events, tasks, run.accounting);
  run.usage = result.usage;
  run.usageStatus = result.summary.usageStatus;
  run.accounting = result.summary;
}
