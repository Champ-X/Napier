import { timingSafeEqual } from "node:crypto";
import type { SubagentTask } from "@napier/contracts";
import { sha256 } from "./ed25519.js";
import { durableTerminalRunStatus } from "./run-event-admission.js";
import type { ChildPersistedRun, SubagentChildRunHost } from "./subagent-child-run-host.js";
import type { SubagentChildRunFence, SubagentChildRunState } from "./subagent-execution-fence-types.js";

export class SubagentChildRunFenceError extends Error {
  override readonly name = "SubagentChildRunFenceError";
}

export function assertChildRunFence(
  host: SubagentChildRunHost,
  input: SubagentChildRunFence,
  options: { requireParentActive?: boolean; checkRevision?: boolean } = {},
): { run: ChildPersistedRun; task: SubagentTask } {
  const run = host.mutableRun(input.runId);
  const task = host.state.subagents.find((candidate) => candidate.id === input.taskId);
  const owner = run.subagent;
  if (run.source !== "subagent" || !owner || !task ||
      owner.taskId !== task.id || owner.executionId !== input.executionId ||
      task.executionId !== input.executionId || task.childRunId !== run.id ||
      task.runId !== run.parentRunId || task.threadId !== run.threadId)
    fail("Child Run execution binding is invalid");
  assertLease(run, input.token);
  if (run.status !== "running" || task.status !== "running" ||
      durableTerminalRunStatus(host.requireLedger().listRunEvents(run.id), run.threadId, run.id))
    fail("Child Run execution is no longer active");
  if (options.checkRevision !== false && input.expectedExecutionRevision !== undefined &&
      input.expectedExecutionRevision !== owner.executionRevision)
    fail("Child Run execution revision changed");
  if (options.requireParentActive !== false) assertParentActive(host, run);
  return { run, task };
}

function assertLease(run: ChildPersistedRun, token: string): void {
  const expected = Buffer.from(run.leaseTokenSha256 ?? "", "hex");
  const actual = Buffer.from(sha256(token), "hex");
  if (!token || expected.length !== actual.length || !timingSafeEqual(expected, actual))
    fail("Child Run lease token is invalid");
  if (!run.lease || Date.parse(run.lease.expiresAt) <= Date.now())
    fail("Child Run execution is no longer active");
}

function assertParentActive(host: SubagentChildRunHost, run: ChildPersistedRun): void {
    const parent = host.state.runs.find((candidate) => candidate.id === run.parentRunId);
    if (!parent || parent.status !== "running" ||
        (parent.lease && Date.parse(parent.lease.expiresAt) <= Date.now()) ||
        parent.configuration?.contentSha256 !== run.subagent!.parentConfigurationSha256 ||
        durableTerminalRunStatus(host.requireLedger().listRunEvents(parent.id), parent.threadId, parent.id))
      fail("Child Run parent is no longer active");
}

export function childRunState(run: ChildPersistedRun, task: SubagentTask): SubagentChildRunState {
  const { leaseTokenSha256: _secret, ...publicRun } = run;
  return { run: structuredClone(publicRun), task: structuredClone(task),
    executionRevision: run.subagent!.executionRevision };
}

function fail(message: string): never { throw new SubagentChildRunFenceError(message); }
