import type { RunRecord } from "@napier/contracts";

/** Manual recovery is an operator continuation; automatic recovery stays read-only. */
export function canConfirmBrowserInteraction(
  run: Pick<RunRecord, "source" | "parentRunId">,
  restrictedReadOnlyExecution: boolean,
): boolean {
  return (
    !restrictedReadOnlyExecution &&
    (run.source === "user" ||
      (run.source === "recovery" && Boolean(run.parentRunId)))
  );
}
