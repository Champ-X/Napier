/** Experimental Kernel policy adapter, not installed by product defaults.
 * Enforces one settled verify_workspace test attempt before the first admitted
 * apply_patch. It never executes a check, grants permission, or attests coverage.
 * Declared in-flight test identities are ephemeral; this feasibility adapter is
 * not qualified for recovery or unavailable verifiers. Completed test receipts
 * remain ledger-derived. Other mutation tools are outside its measured scope. */
export function createPreEditVerificationPolicy({ listEvents, enabled }) {
  if (typeof enabled !== "boolean" || typeof listEvents !== "function")
    throw new Error("Invalid pre-edit verification experiment options");
  const declaredTests = new Map();
  return {
    id: enabled
      ? "napier.experiment.pre-edit-verification-v1"
      : "napier.experiment.pre-edit-verification-control-v1",
    async preflight({ run, toolCall, args, signal }) {
      signal?.throwIfAborted();
      if (!enabled) return undefined;
      if (toolCall.name === "verify_workspace" && args?.kind === "test") {
        const calls = declaredTests.get(run.id) ?? new Set();
        calls.add(toolCall.id);
        declaredTests.set(run.id, calls);
      }
      if (toolCall.name !== "apply_patch") return undefined;
      const events = (await listEvents(run.id))
        .filter((event) => event.runId === run.id)
        .sort((a, b) => a.seq - b.seq);
      signal?.throwIfAborted();
      if (
        events.some(
          (event) =>
            event.type === "tool.completed" &&
            event.payload?.toolName === "apply_patch",
        )
      )
        return undefined;
      const tests = declaredTests.get(run.id) ?? new Set();
      if (
        events.some(
          (event) =>
            event.payload?.toolName === "verify_workspace" &&
            ((event.type === "tool.completed" &&
              event.payload?.details?.kind === "test") ||
              (["tool.completed", "tool.failed", "tool.blocked"].includes(
                event.type,
              ) &&
                tests.has(event.payload.callId))),
        )
      )
        return undefined;
      return {
        block: true,
        reason:
          "This Run's experimental pre-edit protocol requires a settled verify_workspace(kind=test) attempt before the first apply_patch. Read the relevant contract and use the existing test scope; wait for its result before editing. A failing baseline is evidence of the starting state, so continue the repair after that attempt. No new files or permissions are granted. Passing tests do not prove complete contract coverage.",
      };
    },
  };
}
