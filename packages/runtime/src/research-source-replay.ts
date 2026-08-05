import type { RunEvent, RunRecord } from "@napier/contracts";

import { validateResearchSourceCapsuleReceipt } from "./research-source-capsule.js";
import { validateWebFetchStateCapsuleReceipt } from "./web-fetch-capsule.js";

export function assertResearchSourceRecoveryContexts(
  events: readonly RunEvent[],
  runsById: ReadonlyMap<string, Record<string, unknown>>,
): void {
  for (const event of events.filter(
    (candidate) => candidate.type === "context.research_sources",
  )) {
    const receipt = validateResearchSourceCapsuleReceipt(event.payload);
    const run = runsById.get(event.runId) as
      | (Partial<RunRecord> & Record<string, unknown>)
      | undefined;
    if (
      !run ||
      run.source !== "recovery" ||
      receipt.sourceRunId !== event.runId
    ) {
      throw new Error(
        `Thread replay bundle Research Source context is not bound to recovery Run: ${event.runId}`,
      );
    }
  }
  for (const event of events.filter(
    (candidate) => candidate.type === "context.web_fetch_sources",
  )) {
    const receipt = validateWebFetchStateCapsuleReceipt(event.payload);
    const run = runsById.get(event.runId) as
      | (Partial<RunRecord> & Record<string, unknown>)
      | undefined;
    if (
      !run ||
      run.source !== "recovery" ||
      receipt.sourceRunId !== event.runId
    ) {
      throw new Error(
        `Thread replay bundle Web Fetch context is not bound to recovery Run: ${event.runId}`,
      );
    }
  }
}
