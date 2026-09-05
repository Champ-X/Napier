import type {
  JsonObject,
  RunEvent,
  RunRecord,
  ThreadRecord,
  WorkspaceFileMutationEvidence,
  WorkspaceFileMutationOperation,
  WorkspaceTrashItem,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import type { AppendEventInput } from "./run-event-registry.js";
import type { WorkspaceEntrySnapshot } from "./workspace-file-scope.js";

/** Minimal Ledger port needed to publish and reconcile mutation evidence. */
export interface WorkspaceFileMutationEventStore {
  appendEvent(input: AppendEventInput): Promise<RunEvent>;
  getThread(threadId: string): ThreadRecord;
  listEvents(threadId: string, afterSeq?: number): Promise<RunEvent[]>;
  listRuns(threadId: string): RunRecord[];
}

export interface WorkspaceFileMutationOutcomePlan {
  request: { operation: WorkspaceFileMutationOperation };
  sourcePath?: string;
  destinationPath?: string;
  source?: WorkspaceEntrySnapshot;
  trashId?: string;
  reversible: boolean;
}

export interface AppliedWorkspaceFileMutationOutcome {
  after?: WorkspaceEntrySnapshot;
  createdDirectoryCount?: number;
  trashItem?: WorkspaceTrashItem;
  durable: boolean;
}

export function createWorkspaceFileMutationEvidence(input: {
  threadId: string;
  runId: string;
  initiatedBy: WorkspaceFileMutationEvidence["initiatedBy"];
  plan: WorkspaceFileMutationOutcomePlan;
  applied: AppliedWorkspaceFileMutationOutcome;
  appliedAt: string;
}): WorkspaceFileMutationEvidence {
  const { threadId, runId, initiatedBy, plan, applied, appliedAt } = input;
  const source = plan.source;
  const postcondition: WorkspaceFileMutationEvidence["postcondition"] =
    !applied.durable || !applied.after
      ? "indeterminate"
      : !source || source.snapshotSha256 === applied.after.snapshotSha256
        ? "verified"
        : "drifted";
  const observed = applied.after ?? source;
  const fallbackDirectory =
    plan.request.operation === "create_directory" && !observed;
  const content = {
    kind: "napier.workspace-file-mutation" as const,
    schemaVersion: 1 as const,
    id: createId("filemutation"),
    threadId,
    runId,
    operation: plan.request.operation,
    initiatedBy,
    ...(observed
      ? { entryKind: observed.entryKind }
      : fallbackDirectory
        ? { entryKind: "directory" as const }
        : {}),
    ...(plan.sourcePath ? { sourcePathSha256: sha256(plan.sourcePath) } : {}),
    ...(plan.destinationPath
      ? { destinationPathSha256: sha256(plan.destinationPath) }
      : {}),
    ...(source ? { beforeSha256: source.snapshotSha256 } : {}),
    ...(applied.after ? { afterSha256: applied.after.snapshotSha256 } : {}),
    fileCount: observed?.fileCount ?? 0,
    directoryCount: observed?.directoryCount ?? (fallbackDirectory ? 1 : 0),
    bytes: observed?.bytes ?? 0,
    ...(applied.createdDirectoryCount !== undefined
      ? { createdDirectoryCount: applied.createdDirectoryCount }
      : {}),
    ...(plan.trashId ? { trashId: plan.trashId } : {}),
    reversible: plan.reversible,
    postcondition,
    appliedAt,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export async function appendWorkspaceFileMutationEvidence(
  store: WorkspaceFileMutationEventStore,
  evidence: WorkspaceFileMutationEvidence,
): Promise<void> {
  await store.appendEvent({
    threadId: evidence.threadId,
    runId: evidence.runId,
    type: mutationEventType(evidence.initiatedBy),
    category: "tool",
    visibility: "user",
    payload: evidence as unknown as JsonObject,
  });
}

export async function hasWorkspaceFileMutationEvidence(
  store: WorkspaceFileMutationEventStore,
  evidence: WorkspaceFileMutationEvidence,
): Promise<boolean> {
  const eventType = mutationEventType(evidence.initiatedBy);
  const events = await store.listEvents(evidence.threadId);
  return events.some((event) => {
    const payload = event.payload;
    return (
      event.runId === evidence.runId &&
      event.type === eventType &&
      payload !== null &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      payload["id"] === evidence.id &&
      payload["contentSha256"] === evidence.contentSha256 &&
      canonicalJson(payload) === canonicalJson(evidence)
    );
  });
}

function mutationEventType(
  initiatedBy: WorkspaceFileMutationEvidence["initiatedBy"],
): "workspace.file.mutated" | "workspace.file.recovered" {
  return initiatedBy === "operator"
    ? "workspace.file.recovered"
    : "workspace.file.mutated";
}
