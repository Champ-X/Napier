import type { RunEvent, RunRecord } from "@napier/contracts";
import { canonicalJson } from "./ed25519.js";
import { validateRunConfigurationFingerprint } from "./run-config.js";
import type { RunInputCapsule } from "./run-input-capsule.js";
import {
  createModelInvocationCapsuleReceipt,
  validateModelInvocationCapsuleReceipt,
  type ModelInvocationCapsule,
} from "./model-invocation-capsule.js";

const TERMINAL = new Set(["completed", "failed", "cancelled", "interrupted"]);

/** A coherent source observation, not authentication of a caller-supplied
 * ledger. Sequence order selects the original invocation; array order cannot. */
export function validateRunReproductionEvents(
  run: RunRecord,
  threadId: string,
  input: readonly RunEvent[],
) {
  if (run.threadId !== threadId || !TERMINAL.has(run.status)) {
    throw new Error(
      "Reproduction export requires a settled failure or interruption in the requested thread",
    );
  }
  validateRunConfigurationFingerprint(run.configuration);
  const ids = new Set<string>();
  const sequences = new Set<number>();
  for (const event of input) {
    if (
      event.runId !== run.id ||
      event.threadId !== threadId ||
      !event.id ||
      ids.has(event.id) ||
      !Number.isSafeInteger(event.seq) ||
      event.seq < 0 ||
      sequences.has(event.seq)
    ) {
      throw new Error(
        "Reproduction source events have inconsistent scope or duplicate identity",
      );
    }
    ids.add(event.id);
    sequences.add(event.seq);
  }
  const events = [...input].sort((a, b) => a.seq - b.seq);
  const terminals = events.filter((event) =>
    [...TERMINAL].some((status) => event.type === `run.${status}`),
  );
  if (
    terminals.length !== 1 ||
    terminals[0]!.type !== `run.${run.status}` ||
    (record(terminals[0]!.payload).status !== undefined &&
      record(terminals[0]!.payload).status !== run.status)
  ) {
    throw new Error(
      "Run snapshot and unique terminal event do not establish a settled source",
    );
  }
  return { events, terminalEvent: terminals[0]! };
}

export function validateRunInputCaptureReceipt(
  event: RunEvent,
  capsule: RunInputCapsule,
) {
  const receipt = record(event.payload);
  if (
    receipt.kind !== "napier.run-input-capture" ||
    receipt.schemaVersion !== 1 ||
    receipt.status !== (capsule.omissions.length ? "partial" : "captured") ||
    receipt.capsuleSha256 !== capsule.contentSha256 ||
    receipt.fileCount !== capsule.files.length ||
    receipt.byteCount !== capsule.bytes ||
    receipt.omissionCount !== capsule.omissions.length
  ) {
    throw new Error("Initial input capture receipt does not match its capsule");
  }
}

export function validateInitialInvocationReceipt(
  event: RunEvent,
  invocation: ModelInvocationCapsule,
) {
  const receipt = validateModelInvocationCapsuleReceipt(event.payload);
  const expected = createModelInvocationCapsuleReceipt(invocation);
  if (
    invocation.purpose !== "agent_turn" ||
    canonicalJson(receipt) !== canonicalJson(expected)
  ) {
    throw new Error("Initial invocation receipt does not match its capsule");
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
