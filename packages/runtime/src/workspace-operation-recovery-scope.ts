import type { RunEvent } from "@napier/contracts";
import { completeHistory, field, preparedMoveForBoundary } from "./workspace-file-move-preparation.js";
import { preparedPatchForBoundary } from "./workspace-patch-preparation.js";
import { liveToolEffectAuthoritiesFromEvents } from "./sqlite-tool-effect-authority.js";

/** Journal-level portion of the same independent-operation scope used by the
 * filesystem inspector and the SQLite authority fence. Actual paths/aliases
 * and file identities are checked under the union of all path locks. */
export function independentRecoveryBoundaryScope(events: RunEvent[], boundaries: RunEvent[]): boolean {
  if (!completeHistory(events) || !boundaries.length || boundaries.length > 128) return false;
  const owner = boundaries[0]!, ids = new Set<unknown>(), paths = new Set<string>();
  if (!completePreparedPathScope(events, owner)) return false;
  for (const boundary of boundaries) {
    const id = field(boundary, "operationId");
    if (boundary.runId !== owner.runId || boundary.threadId !== owner.threadId || typeof id !== "string" || ids.has(id)) return false;
    ids.add(id);
    const move = field(boundary, "route") === "workspace_file_apply" ? preparedMoveForBoundary(events, boundary) : undefined;
    const patch = field(boundary, "route") === "apply_patch" ? preparedPatchForBoundary(events, boundary) : undefined;
    const values = move ? [move.payload.sourcePathSha256, move.payload.destinationPathSha256]
      : patch ? [patch.payload.pathSha256] : undefined;
    if (!values) return false;
    for (const value of values) { if (paths.has(value)) return false; paths.add(value); }
  }
  return true;
}

/** Include retained participants in the journal fence, not just the unfinished
 * tail. Only a hash-linked patch version chain can reuse an endpoint. */
function completePreparedPathScope(events: RunEvent[], owner: RunEvent): boolean {
  const prepared = events.filter((event) => event.runId === owner.runId && event.threadId === owner.threadId &&
    ["workspace.patch.prepared", "workspace.file.move.prepared"].includes(event.type)).sort((a, b) => a.seq - b.seq);
  if (!prepared.length || prepared.length > 128) return false;
  const paths = new Map<string, { kind: "move" | "patch"; after?: string }>(), calls = new Set<string>();
  for (const event of prepared) {
    const boundary = events.find((candidate) => candidate.runId === owner.runId && candidate.threadId === owner.threadId &&
      candidate.seq === field(event, "boundaryEventSeq"));
    if (!boundary) return false;
    if (event.type === "workspace.file.move.prepared") {
      const bound = preparedMoveForBoundary(events, boundary);
      if (!bound || bound.id !== event.id || calls.has(bound.payload.callId)) return false;
      calls.add(bound.payload.callId);
      for (const endpoint of [bound.payload.sourcePathSha256, bound.payload.destinationPathSha256]) {
        if (paths.has(endpoint)) return false;
        paths.set(endpoint, { kind: "move" });
      }
    } else {
      const bound = preparedPatchForBoundary(events, boundary);
      if (!bound || bound.id !== event.id || calls.has(bound.payload.callId)) return false;
      calls.add(bound.payload.callId);
      const previous = paths.get(bound.payload.pathSha256);
      if (previous && (previous.kind !== "patch" || previous.after !== bound.payload.beforeSha256)) return false;
      paths.set(bound.payload.pathSha256, { kind: "patch", after: bound.payload.afterSha256 });
    }
  }
  return !events.some((event) => event.runId === owner.runId && event.threadId === owner.threadId && event.type === "tool.started" &&
    ["apply_patch", "workspace_file_apply"].includes(String(field(event, "toolName"))) && !calls.has(String(field(event, "callId"))));
}

export function operationReconciliationReason(boundaries: readonly RunEvent[]) {
  return boundaries.every((event) => field(event, "route") === "apply_patch")
    ? "patch_postcondition_reconciled" as const : "operation_postcondition_reconciled" as const;
}

/** Transactions may contain several threads, whose sequence spaces overlap. */
export function operationReconciliationCommitEvents(prior: RunEvent[], transaction: readonly RunEvent[], marker: RunEvent,
  reason: unknown): RunEvent[] | undefined {
  const authorities = liveToolEffectAuthoritiesFromEvents(prior);
  if (authorities.some((authority) => !authority.current || !authority.boundaryEvent)) return undefined;
  const boundaries = authorities.map((authority) => authority.boundaryEvent!);
  const scoped = [...prior, ...transaction].filter((event) => event.runId === marker.runId && event.threadId === marker.threadId);
  const markers = scoped.filter((event) => event.type === "tool.operation.effect_indeterminate");
  if (markers.length !== boundaries.length || boundaries.some((boundary) => !markers.some((value) =>
    field(value, "operationId") === field(boundary, "operationId")))) return undefined;
  return independentRecoveryBoundaryScope(scoped, boundaries) && reason === operationReconciliationReason(boundaries) ? scoped : undefined;
}
