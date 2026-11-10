/**
 * Durable-aligned admission vocabulary for Run steering.
 * Wire transport may still use RunControlMessageMode; this module names the
 * busy-boundary policy Pi Durable uses for submissions.
 */

/** What to do when the conversation/Run is already busy. */
export type RunAdmissionBusyPolicyV1 =
  | "follow_up"
  | "steer"
  | "reject";

export type RunAdmissionKindV1 = "input" | "control" | "write";

/**
 * Caller-stable identity for exactly-once admission within one Run/Thread.
 * Control messages already use `clientMessageId`; ordinary prompts should
 * adopt the same shape in Phase 3.
 */
export interface RunAdmissionIdentityV1 {
  kind: "napier.run-admission-identity";
  schemaVersion: 1;
  /** Stable across retries of the same user intent. */
  requestId: string;
  threadId: string;
  runId?: string;
}

export interface RunAdmissionDraftV1 {
  kind: "napier.run-admission-draft";
  schemaVersion: 1;
  admission: RunAdmissionKindV1;
  identity: RunAdmissionIdentityV1;
  /** Required when a Run is busy; ignored when idle. */
  busyPolicy: RunAdmissionBusyPolicyV1;
}

/** Map existing control modes onto Durable busy policy names. */
export function controlModeToBusyPolicy(
  mode: "steering" | "follow_up",
): Exclude<RunAdmissionBusyPolicyV1, "reject"> {
  return mode === "steering" ? "steer" : "follow_up";
}
