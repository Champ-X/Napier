import type { DatabaseSync } from "node:sqlite";
import type { RunRecord, SubagentTask } from "@napier/contracts";
import { lostRunLeaseDisposition } from "./run-lease-loss.js";
import { listRunLeases } from "./sqlite-run-leases.js";
import { validateSubagentRunBinding } from "./subagent-child-run-validation.js";

type PersistedRun = RunRecord & { leaseTokenSha256?: string };

/** Inspect prior durable lineage and the normalized lease inside the writer transaction.
 * A proposed next snapshot cannot manufacture the parent's loss of authority. */
export function childParentAuthorityLost(
  database: DatabaseSync,
  previousStateJson: string,
  childIdentity: { id: string; threadId: string },
  commitNowMs: number,
): boolean {
  const state = JSON.parse(previousStateJson) as { runs?: PersistedRun[]; subagents?: SubagentTask[] };
  if (!Array.isArray(state.runs) || !Array.isArray(state.subagents)) return false;
  const child = state.runs.find((run) => run.id === childIdentity.id && run.threadId === childIdentity.threadId);
  if (!child || child.source !== "subagent") return false;
  const parent = state.runs.find((run) => run.id === child.parentRunId);
  const task = state.subagents.find((candidate) => candidate.id === child.subagent?.taskId);
  try { validateSubagentRunBinding(child, parent, task); } catch { return false; }
  if (!parent) return false;
  if (parent.status !== "running" && parent.status !== "queued") return true;
  const lease = listRunLeases(database).find((candidate) => candidate.runId === parent.id);
  if (Boolean(parent.lease && parent.leaseTokenSha256) !== Boolean(lease)) return false;
  if (lease && (lease.threadId !== parent.threadId || lease.tokenSha256 !== parent.leaseTokenSha256)) return false;
  return Boolean(lostRunLeaseDisposition(lease?.lease, Boolean(lease), commitNowMs, true));
}
