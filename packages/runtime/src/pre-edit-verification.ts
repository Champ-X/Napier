import type { RunEvent } from "@napier/contracts";

export function preEditVerificationAvailable(
  available: ReadonlySet<string>,
  active: ReadonlySet<string>,
): boolean {
  return (
    available.has("verify_workspace") &&
    (active.has("verify_workspace") || active.has("capability"))
  );
}

export const PRE_EDIT_VERIFICATION_GUIDANCE =
  "Active before-first-patch policy: before the first apply_patch in this Run, wait for one verify_workspace(kind=test) attempt to settle. An existing settled attempt already satisfies this ordering rule; do not repeat an unchanged check just to satisfy it. run_command checks alone do not create this structured verification receipt. If the verifier schema is hidden, discover capability(uri=cap://tools/verify_workspace). Failed or denied attempts permit continued work within the original permissions, but are not passing tests or proof of contract coverage. Reuse the relevant checks after source changes.";

/** Run-local ordering evidence, not permission, workspace freshness or proof of
 * test execution/coverage. In particular a denied attempt never means tests ran.
 * Reconstructible after compaction/restart without replay or in-memory intents. */
export function assessPreEditVerification(input: {
  runId: string;
  toolName: string;
  verificationAvailable: boolean;
  events: readonly RunEvent[];
}): {
  status:
    | "not_applicable"
    | "verification_unavailable"
    | "prior_patch"
    | "settled_test_attempt"
    | "test_required";
  evidenceEventId?: string;
} {
  if (input.toolName !== "apply_patch") return { status: "not_applicable" };
  if (!input.verificationAvailable)
    return { status: "verification_unavailable" };
  const events = input.events
    .filter((event) => event.runId === input.runId)
    .sort((a, b) => a.seq - b.seq);
  const tests = new Set<string>();
  for (const event of events) {
    const p = event.payload;
    if (!p || typeof p !== "object" || Array.isArray(p)) continue;
    if (event.type === "tool.completed" && p.toolName === "apply_patch")
      return { status: "prior_patch", evidenceEventId: event.id };
    if (p.toolName !== "verify_workspace") continue;
    if (
      event.type === "tool.started" &&
      p.verificationKind === "test" &&
      typeof p.callId === "string"
    )
      tests.add(p.callId);
    if (!["tool.completed", "tool.failed", "tool.blocked"].includes(event.type))
      continue;
    const details = p.details;
    const completedTest =
      event.type === "tool.completed" &&
      details &&
      typeof details === "object" &&
      !Array.isArray(details) &&
      details.kind === "test";
    if (
      completedTest ||
      p.verificationKind === "test" ||
      (typeof p.callId === "string" && tests.has(p.callId))
    )
      return { status: "settled_test_attempt", evidenceEventId: event.id };
  }
  return { status: "test_required" };
}
