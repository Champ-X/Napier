import type { DatabaseSync } from "node:sqlite";

import type { RunEvent, RunStatus } from "@napier/contracts";

import { RUN_TERMINAL_EVENT_TYPES } from "./run-event-admission.js";
import { assertEffectIndeterminateTerminalCommit } from "./sqlite-effect-indeterminate-commit.js";
import { readTerminalRunStatus } from "./sqlite-terminal-events.js";
import { assertNoLiveToolEffectAuthority } from "./sqlite-tool-effect-authority.js";

export interface TerminalCommitTarget {
  threadId: string;
  runId: string;
}

export function assertTerminalCommitEffectAuthority(
  database: DatabaseSync,
  previousStateJson: string | undefined,
  nextStateJson: string,
  events: readonly RunEvent[],
): void {
  assertEffectIndeterminateTerminalCommit(
    database,
    previousStateJson,
    nextStateJson,
    events,
  );
  const eventTargets = terminalEventTargets(events);
  const newTerminalKeys = new Set(eventTargets.map(targetKey));
  for (const target of terminalCommitTargets(
    previousStateJson,
    nextStateJson,
    events,
  )) {
    // Repairing a snapshot from an already-durable terminal event does not
    // grant or revoke authority: that ordering decision happened earlier.
    if (
      !newTerminalKeys.has(targetKey(target)) &&
      readTerminalRunStatus(database, target.threadId, target.runId)
    ) {
      continue;
    }
    assertNoLiveToolEffectAuthority(database, target.threadId, target.runId);
  }
}

export function assertTerminalEventEffectAuthority(
  database: DatabaseSync,
  events: readonly RunEvent[],
): void {
  assertEffectIndeterminateTerminalCommit(
    database,
    undefined,
    undefined,
    events,
  );
  assertTargetsClear(database, terminalEventTargets(events));
}

/**
 * Finds every Run that becomes terminal in this commit. Event-backed targets
 * cover normal lifecycle settlement; the snapshot comparison also fences the
 * legacy finishRun path while it remains supported.
 */
export function terminalCommitTargets(
  previousStateJson: string | undefined,
  nextStateJson: string,
  events: readonly RunEvent[],
): TerminalCommitTarget[] {
  const targets = new Map<string, TerminalCommitTarget>();
  for (const event of events) {
    if (!(RUN_TERMINAL_EVENT_TYPES as readonly string[]).includes(event.type)) {
      continue;
    }
    addTarget(targets, event.threadId, event.runId);
  }
  const previousRuns = snapshotRuns(previousStateJson);
  for (const next of snapshotRuns(nextStateJson).values()) {
    if (!terminalStatus(next.status)) continue;
    const previous = previousRuns.get(scopeKey(next.threadId, next.id));
    if (!previous || activeStatus(previous.status)) {
      addTarget(targets, next.threadId, next.id);
    }
  }
  return [...targets.values()].sort(
    (left, right) =>
      left.threadId.localeCompare(right.threadId) ||
      left.runId.localeCompare(right.runId),
  );
}

export function terminalEventTargets(
  events: readonly RunEvent[],
): TerminalCommitTarget[] {
  return terminalCommitTargets(undefined, JSON.stringify({ runs: [] }), events);
}

function snapshotRuns(
  stateJson: string | undefined,
): Map<string, { id: string; threadId: string; status: RunStatus }> {
  if (!stateJson) return new Map();
  const state = JSON.parse(stateJson) as {
    runs?: Array<{ id?: unknown; threadId?: unknown; status?: unknown }>;
  };
  const runs = new Map<
    string,
    { id: string; threadId: string; status: RunStatus }
  >();
  for (const run of state.runs ?? []) {
    if (
      typeof run.id === "string" &&
      typeof run.threadId === "string" &&
      runStatus(run.status)
    ) {
      const snapshotRun = {
        id: run.id,
        threadId: run.threadId,
        status: run.status,
      };
      runs.set(scopeKey(snapshotRun.threadId, snapshotRun.id), snapshotRun);
    }
  }
  return runs;
}

function addTarget(
  targets: Map<string, TerminalCommitTarget>,
  threadId: string,
  runId: string,
): void {
  targets.set(`${threadId}\u0000${runId}`, { threadId, runId });
}

function targetKey(target: TerminalCommitTarget): string {
  return scopeKey(target.threadId, target.runId);
}

function scopeKey(threadId: string, runId: string): string {
  return `${threadId}\u0000${runId}`;
}

function assertTargetsClear(
  database: DatabaseSync,
  targets: readonly TerminalCommitTarget[],
): void {
  for (const target of targets) {
    assertNoLiveToolEffectAuthority(database, target.threadId, target.runId);
  }
}

function activeStatus(status: RunStatus): boolean {
  return status === "queued" || status === "running";
}

function terminalStatus(status: RunStatus): boolean {
  return !activeStatus(status);
}

function runStatus(value: unknown): value is RunStatus {
  return (
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "interrupted"
  );
}
