import type { RunEvent } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { WorkspacePathSnapshot } from "./workspace-snapshot.js";
import type { VerificationWorkspaceDigest } from "./verification-workspace-digest.js";
import { projectTaskRequirementRevisions } from "./task-requirement-revisions.js";
import { projectTaskPlanRevisions } from "./task-plan-revisions.js";
import { projectTaskToolFailures } from "./task-tool-failures.js";
import type { TaskBranchHistorySource } from "./task-branch-history.js";
const CONTROL_TOOLS = new Set([
  "create_plan",
  "replan_plan",
  "update_plan_step",
  "update_plan_artifact",
  "record_run_milestone",
]);

/** Derived state, never an authority for permission, successful execution or
 * replay. Source events remain durable when conversational history compacts. */
export function projectTaskWorkingState(input: {
  runId: string;
  sourceRunIds?: readonly string[];
  events: readonly RunEvent[];
  branchHistory?: ReadonlyMap<string, TaskBranchHistorySource>;
  workspace?: WorkspacePathSnapshot;
  verificationWorkspace?: VerificationWorkspaceDigest;
}) {
  const allowedRuns = new Set([input.runId, ...(input.sourceRunIds ?? [])]);
  const events = input.events
    .filter((event) => event.runId && allowedRuns.has(event.runId))
    .sort((a, b) => a.seq - b.seq);
  const sources: Array<{
    eventId: string;
    seq: number;
    type: string;
    payloadSha256: string;
  }> = [];
  const requirementState = projectTaskRequirementRevisions(
    events,
    input.branchHistory,
  );
  const planState = projectTaskPlanRevisions(events);
  const failureState = projectTaskToolFailures(events);
  const failures = failureState.failures;
  const requirements = requirementState.requirements;
  const artifacts = new Map<
    string,
    { pathSha256: string; versionSha256: string; eventId: string; seq: number }
  >();
  const checks = new Map<
    string,
    { event: RunEvent; details: Record<string, unknown> }
  >();
  const decisions: Array<{
    tool: string;
    eventId: string;
    seq: number;
    status?: string;
    planId?: string;
    stepId?: string;
  }> = [];
  for (const event of events) {
    const payload = record(event.payload);
    const tool = string(payload.toolName);
    const details = record(payload.details);
    let relevant =
      requirementState.sourceEventIds.has(event.id) ||
      planState.sourceEventIds.has(event.id) ||
      failureState.sourceEventIds.has(event.id);
    if (event.type === "tool.completed") {
      if (
        tool === "apply_patch" &&
        hash(details.pathSha256) &&
        hash(details.afterSha256)
      ) {
        artifacts.set(String(details.pathSha256), {
          pathSha256: String(details.pathSha256),
          versionSha256: String(details.afterSha256),
          eventId: event.id,
          seq: event.seq,
        });
        relevant = true;
      }
      if (tool === "verify_workspace") {
        checks.set(
          canonicalJson([
            details.kind ?? "",
            details.runtime ?? "node",
            details.cwdPathSha256 ?? "",
            details.targetPathSha256 ?? "",
          ]),
          { event, details },
        );
        relevant = true;
      }
      if (CONTROL_TOOLS.has(tool)) {
        decisions.push({
          tool,
          eventId: event.id,
          seq: event.seq,
          ...scalarFields(details, ["status", "planId", "stepId"]),
        });
        relevant = true;
      }
    }
    if (relevant)
      sources.push({
        eventId: event.id,
        seq: event.seq,
        type: event.type,
        payloadSha256: sha256(canonicalJson(event.payload)),
      });
  }
  const workspace = input.workspace;
  const paths = new Map(
    workspace?.entries.map((entry) => [sha256(entry.path), entry]) ?? [],
  );
  const artifactState = [...artifacts.values()].map((artifact) => {
    const current = paths.get(artifact.pathSha256);
    return {
      ...artifact,
      ...(current ? { path: current.path } : {}),
      current: artifactFreshness(
        workspace,
        current?.sha256,
        artifact.versionSha256,
      ),
    };
  });
  const verifications = [...checks.values()]
    .sort((a, b) => a.event.seq - b.event.seq)
    .slice(-12)
    .map(({ event, details }) => ({
      eventId: event.id,
      seq: event.seq,
      kind: string(details.kind),
      runtime: string(details.runtime) || "node",
      resultSha256: string(details.resultSha256),
      scopeSha256: string(details.scopeSha256),
      status: string(details.status),
      ...verificationSelectionScope(details),
      freshness: verificationFreshness(
        details,
        workspace,
        input.verificationWorkspace,
      ),
      precededLatestInstruction:
        event.seq < requirementState.latestInstructionSeq,
    }));
  const pendingActions = [
    ...verifications
      .filter(
        (check) => check.status !== "passed" || check.freshness !== "current",
      )
      .map((check) => ({
        action: "reverify",
        eventId: check.eventId,
        reason: check.freshness,
      })),
    ...failures
      .filter((failure) => !failure.matchingCompletionObserved)
      .map((failure) => ({
        action: "review_failure",
        eventId: failure.eventId,
        reason: failure.disposition,
      })),
  ];
  const content = {
    kind: "napier.task-working-state",
    schemaVersion: 1,
    runId: input.runId,
    completion: "not_determined",
    sourceRunIds: [...allowedRuns].sort(),
    sourceEventCount: sources.length,
    sourceEventSetSha256: sha256(canonicalJson(sources)),
    requirements,
    instructionRevision: requirementState.instructionRevision,
    latestInstructionEventId: requirementState.latestInstructionEventId,
    omittedRequirementCount: requirementState.omittedCount,
    decisions: decisions.slice(-16),
    plans: planState.plans,
    artifacts: artifactState.slice(-32),
    verifications,
    rejectedAttempts: failures.slice(-12),
    omittedRejectedAttemptCount: Math.max(0, failures.length - 12),
    pendingActions: pendingActions.slice(-16),
    truncated:
      exceedsProjectionLimits([
        requirementState.totalCount,
        decisions.length,
        artifacts.size,
        checks.size,
        failures.length,
        pendingActions.length,
      ]) ||
      requirementState.truncated ||
      planState.totalCount > 4 ||
      planState.plans.some(
        (plan) => plan.snapshot?.truncated || plan.state === "conflicting",
      ),
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

function verificationSelectionScope(details: Record<string, unknown>): {
  selectionMode?: "selected" | "full_suite_fallback";
  selectedTestCount?: number;
} {
  if (
    details.selectionMode !== "selected" &&
    details.selectionMode !== "full_suite_fallback"
  )
    return {};
  return {
    selectionMode: details.selectionMode,
    ...(Number.isSafeInteger(details.selectedTestCount) &&
    Number(details.selectedTestCount) >= 0
      ? { selectedTestCount: Number(details.selectedTestCount) }
      : {}),
  };
}

function artifactFreshness(
  workspace: WorkspacePathSnapshot | undefined,
  current: string | undefined,
  expected: string,
) {
  return !workspace || workspace.truncated
    ? "unknown"
    : current === expected
      ? "matches"
      : "changed_or_missing";
}

function verificationFreshness(
  details: Record<string, unknown>,
  workspace?: WorkspacePathSnapshot,
  verificationWorkspace?: VerificationWorkspaceDigest,
) {
  if (details.status !== "passed") return "not_passed";
  // Modern receipts use the canonical full entry hash. Legacy receipts bind a
  // file-only list and still require the original complete snapshot projection.
  const observed =
    details.snapshotStatus !== undefined
      ? (verificationWorkspace ?? workspace)
      : workspace;
  if (
    !observed ||
    observed.truncated ||
    details.workspaceSnapshotTruncated === true
  )
    return "unknown";
  if (
    details.cwdPathSha256 !== sha256(".") &&
    details.workspaceSnapshotScope !== "workspace"
  )
    return "scope_not_observed";
  const legacyEntries = (workspace?.entries ?? [])
    .filter(
      (entry) => entry.entryKind === "file" || entry.entryKind === undefined,
    )
    .map(({ entryKind: _kind, ...entry }) => entry);
  const currentHash =
    details.snapshotStatus !== undefined
      ? observed.sha256
      : sha256(canonicalJson(legacyEntries));
  if (
    details.snapshotStatus !== undefined &&
    details.snapshotStatus !== "unchanged"
  )
    return "changed_during_verification";
  return currentHash === details.workspaceSnapshotSha256 ? "current" : "stale";
}

function scalarFields(value: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(
    keys.flatMap((key) =>
      typeof value[key] === "string" ? [[key, value[key]]] : [],
    ),
  );
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function string(value: unknown) {
  return typeof value === "string" ? value : "";
}
function hash(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function exceedsProjectionLimits(counts: number[]) {
  const limits = [8, 16, 32, 12, 12, 16];
  return counts.some((count, index) => count > limits[index]!);
}
