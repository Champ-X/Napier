export const VERIFIED_PATCH_RECOVERY = Symbol("verified-patch-recovery");
import type { JsonObject, RunEvent, RunRecord } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { modernRunConfiguration } from "./effective-run-profile.js";
import { patchEventPayload } from "./workspace-patch-preparation.js";
import { uncommittedPatchCandidates } from "./workspace-patch-uncommitted-evidence.js";
import { settledPatchRecoveryCandidates } from "./run-patch-recovery-evidence.js";
import { reconciledPatchRecoveryEvidence } from "./workspace-patch-reconciled-evidence.js";

export interface PatchRecoveryEntry extends JsonObject {
  sourceRunId: string;
  sourceCallId: string;
  recoveryCallId: string;
}
export interface PatchRecoveryPlan extends JsonObject {
  schemaVersion: 1;
  parentRunId: string;
  entries: PatchRecoveryEntry[];
  contentSha256: string;
}

/** A plan contains references, never arguments or a grant to a model tool. */
export function planWorkspacePatchRecovery(
  parent: RunRecord,
  events: RunEvent[],
): PatchRecoveryPlan {
  if (
    parent.status !== "interrupted" ||
    !modernRunConfiguration(parent.configuration) ||
    parent.configuration.automaticRecovery.mode !== "verified_patches"
  )
    throw new Error(
      "Verified patch recovery requires an opted-in interrupted parent",
    );
  const scoped = events.filter(
    (event) => event.runId === parent.id && event.threadId === parent.threadId,
  );
  const prior = readWorkspacePatchRecoveryPlan(parent, scoped);
  const entries = prior
    ? prior.entries.map((entry) => {
        const starts = scoped.filter(
          (event) =>
            event.type === "tool.started" &&
            patchEventPayload(event)["callId"] === entry.recoveryCallId,
        );
        if (starts.length > 1)
          throw new Error("Patch recovery call is ambiguous");
        return starts.length
          ? {
              ...entry,
              sourceRunId: parent.id,
              sourceCallId: entry.recoveryCallId,
            }
          : entry;
      })
    : [
        ...uncommittedPatchCandidates(scoped),
        ...settledPatchRecoveryCandidates(scoped),
        ...reconciledPatchRecoveryEvidence(scoped),
      ]
        .sort((a, b) => a.startedSeq - b.startedSeq)
        .map((patch) => ({
          sourceRunId: parent.id,
          sourceCallId: patch.callId,
          recoveryCallId: `patch_recovery_${sha256(`${parent.id}:${patch.callId}`).slice(0, 32)}`,
        }));
  if (
    entries.length > 128 ||
    new Set(entries.map((entry) => entry.recoveryCallId)).size !==
      entries.length
  )
    throw new Error(
      "Patch recovery plan exceeds its bound or contains duplicate operations",
    );
  const content = {
    schemaVersion: 1 as const,
    parentRunId: parent.id,
    entries,
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export function readWorkspacePatchRecoveryPlan(
  run: RunRecord,
  events: RunEvent[],
): PatchRecoveryPlan | undefined {
  const plans = events.filter(
    (event) =>
      event.runId === run.id &&
      event.threadId === run.threadId &&
      event.type === "workspace.patch.recovery_planned",
  );
  const required =
    modernRunConfiguration(run.configuration) &&
    run.configuration.executionMode === "verified_patch_recovery";
  if (!required && !plans.length) return undefined;
  const value = plans[0]?.payload as PatchRecoveryPlan | undefined;
  if (
    !required ||
    plans.length !== 1 ||
    !value ||
    value.schemaVersion !== 1 ||
    value.parentRunId !== run.parentRunId ||
    !Array.isArray(value.entries) ||
    value.entries.length > 128 ||
    !value.entries.every(validEntry)
  )
    throw new Error("Patch recovery plan is missing or invalid");
  const { contentSha256, ...content } = value;
  if (
    Object.keys(value).length !== 4 ||
    sha256(canonicalJson(content)) !== contentSha256
  )
    throw new Error("Patch recovery plan digest changed");
  return value;
}

function validEntry(value: PatchRecoveryEntry): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.keys(value).length === 3 &&
    [value.sourceRunId, value.sourceCallId, value.recoveryCallId].every(
      (text) =>
        typeof text === "string" && text.length > 0 && text.length <= 256,
    )
  );
}
