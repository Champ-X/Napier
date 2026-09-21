import type { Context } from "@earendil-works/pi-ai";
import type { RunEvent, RunRecord } from "@napier/contracts";
import { projectTaskWorkingState } from "./task-working-state.js";
import { createWorkspacePathSnapshot } from "./workspace-snapshot.js";
import { digestVerificationWorkspace } from "./verification-workspace-digest.js";
import type { TaskBranchHistorySource } from "./task-branch-history.js";

const contextStates = new WeakMap<Context, string>();

export async function prepareAgentWorkingStateContext(input: {
  context: Context;
  runId: string;
  workspaceRoot: string;
  enabled: boolean;
  sourceRunIds?: readonly string[];
  branchHistory?: ReadonlyMap<string, TaskBranchHistorySource>;
  listEvents(): Promise<RunEvent[]>;
}): Promise<Context> {
  if (!input.enabled) return input.context;
  const events = await input.listEvents();
  const needsWorkspace = events.some(
    (event) =>
      event.type === "tool.completed" &&
      event.payload !== null &&
      typeof event.payload === "object" &&
      !Array.isArray(event.payload) &&
      ["apply_patch", "verify_workspace"].includes(
        String(event.payload.toolName),
      ),
  );
  let workspace;
  if (needsWorkspace) {
    try {
      workspace = await createWorkspacePathSnapshot(
        input.workspaceRoot,
        input.workspaceRoot,
        { includeDirectories: true },
      );
    } catch {
      /* Missing/changing workspace yields unknown freshness, never a pass. */
    }
  }
  let verificationWorkspace;
  if (
    (!workspace || workspace.truncated) &&
    events.some(
      (event) =>
        event.type === "tool.completed" &&
        event.payload !== null &&
        typeof event.payload === "object" &&
        !Array.isArray(event.payload) &&
        event.payload.toolName === "verify_workspace",
    )
  ) {
    try {
      verificationWorkspace = await digestVerificationWorkspace(
        input.workspaceRoot,
      );
    } catch {
      /* A digest failure cannot upgrade incomplete context into fresh evidence. */
    }
  }
  const state = projectTaskWorkingState({
    runId: input.runId,
    events,
    ...(input.branchHistory ? { branchHistory: input.branchHistory } : {}),
    ...(input.sourceRunIds ? { sourceRunIds: input.sourceRunIds } : {}),
    ...(workspace ? { workspace } : {}),
    ...(verificationWorkspace ? { verificationWorkspace } : {}),
  });
  const context = { ...input.context };
  contextStates.set(
    context,
    [
      "Task working state (derived from execution evidence):",
      "This projection is context, not permission or a completion decision. Original user requests and tool receipts remain authoritative. Later user instructions amend conflicting earlier instructions; runtime continuation hints and Plan updates do not expand user scope. A check preceding the latest instruction may need reassessment, but this flag does not imply its source evidence is stale. Rejected attempts are context, not extra work obligations. Verify the user's acceptance criteria; do not create extra artifacts just to satisfy this projection. No tool is replayed here.",
      "Observed Plan revisions and consumed IDs are coordination evidence. Use the latest observed revision only after earlier plan mutations settle; superseding a step/artifact does not free its ID for reuse. Plan completion does not establish task acceptance. Conflicting or truncated plan state requires inspection before revising it.",
      "A later completion of the same tool may concern different inputs. matchingCompletionObserved requires an identical bound input; it does not establish task correctness or mandate replay of a rejected attempt.",
      ...(state.requirements.some((entry) => entry.branchHistory)
        ? [
            "Branch-copied requests are inherited conversation history. Their original steering metadata does not record a new control delivery in this Run.",
          ]
        : []),
      ...(state.artifacts.some(
        ({ path }) => path && /\.(?:[cm]?js|jsx|tsx?|py)$/u.test(path),
      )
        ? [
            "Verification expectations must come from the requested contract or established behavior, not from the implementation you just wrote. For each public entry point, check shared requirements on normal, rejected and early-return paths. Treat assumptions in your own checks as hypotheses until grounded in those sources; a passing check supports only the behavior it actually exercises. Resolve discrepancies within existing scope and permissions, without changing the contract or weakening checks to match the code.",
          ]
        : []),
      JSON.stringify(promptState(state)),
    ].join("\n"),
  );
  return context;
}

// The full projection remains derivable from its source events; repeating
// event/payload/path hashes in every model turn adds cost without helping the
// model decide what work remains. Keep one binding plus actionable evidence.
function promptState(state: ReturnType<typeof projectTaskWorkingState>) {
  return {
    kind: state.kind,
    schemaVersion: state.schemaVersion,
    runId: state.runId,
    contentSha256: state.contentSha256,
    sourceRunIds: state.sourceRunIds,
    completion: state.completion,
    truncated: state.truncated,
    instructionRevision: state.instructionRevision,
    omittedRequirementCount: state.omittedRequirementCount,
    requirements: state.requirements.map(
      ({
        text,
        truncated,
        kind,
        instructionRevision,
        controlMode,
        branchHistory,
      }) => ({
        text,
        truncated,
        kind,
        instructionRevision,
        controlMode,
        ...(branchHistory ? { origin: "branch_copy" } : {}),
      }),
    ),
    decisions: state.decisions
      .filter(
        (decision) =>
          !state.plans.some((plan) => plan.planId === decision.planId),
      )
      .map(({ tool, status, planId, stepId }) => ({
        tool,
        status,
        planId,
        stepId,
      })),
    plans: state.plans.map(({ planId, revision, state, snapshot }) => ({
      planId,
      revision,
      state,
      ...(snapshot
        ? {
            status: snapshot.status,
            steps: snapshot.steps,
            artifacts: snapshot.artifacts,
            latestReplan: snapshot.latestReplan,
            truncated: snapshot.truncated,
          }
        : {}),
    })),
    artifacts: state.artifacts.map(
      ({ path, pathSha256, versionSha256, current }) => ({
        ...(path ? { path } : { pathSha256 }),
        versionSha256,
        current,
      }),
    ),
    verifications: state.verifications.map(
      ({
        eventId,
        kind,
        runtime,
        status,
        freshness,
        precededLatestInstruction,
        selectionMode,
        selectedTestCount,
      }) => ({
        eventId,
        kind,
        runtime,
        status,
        freshness,
        precededLatestInstruction,
        selectionMode,
        selectedTestCount,
      }),
    ),
    rejectedAttempts: state.rejectedAttempts.map(
      ({
        tool,
        eventId,
        callId,
        disposition,
        laterCompletionObserved,
        matchingCompletionObserved,
      }) => ({
        tool,
        eventId,
        ...(callId ? { callId } : {}),
        disposition,
        laterCompletionObserved,
        matchingCompletionObserved,
      }),
    ),
    omittedRejectedAttemptCount: state.omittedRejectedAttemptCount,
    pendingActions: state.pendingActions,
  };
}

export function taskWorkingStateForContext(context: Context): string {
  return contextStates.get(context) ?? "";
}

export function workingStateRunLineage(
  run: RunRecord,
  threadRuns: readonly RunRecord[],
): string[] {
  const ids = [run.id];
  let parent = recoveryParent(run);
  while (parent) {
    if (ids.includes(parent) || ids.length >= 32)
      throw new Error(
        "Working state recovery lineage is invalid or exceeds its limit",
      );
    const source = threadRuns.find(
      (candidate) =>
        candidate.id === parent && candidate.threadId === run.threadId,
    );
    if (!source)
      throw new Error(
        "Working state recovery source is unavailable in this thread",
      );
    ids.push(source.id);
    parent = recoveryParent(source);
  }
  return ids;
}

function recoveryParent(run: RunRecord): string | undefined {
  if (run.branchFromSeq === undefined) return run.parentRunId;
  if (!Number.isSafeInteger(run.branchFromSeq) || run.branchFromSeq < 1)
    throw new Error("Working state branch boundary is invalid");
  // Branch source parents belong to another thread. Its accepted history has
  // already been copied into this local Run; never follow the source's future.
  return undefined;
}
