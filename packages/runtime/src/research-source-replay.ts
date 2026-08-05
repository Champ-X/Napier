import type {
  RunEvent,
  RunRecord,
  ThreadImportProvenance,
} from "@napier/contracts";

import { validateResearchSourceCapsuleReceipt } from "./research-source-capsule.js";
import { sourceContinuityPredecessor } from "./source-continuity-lineage.js";
import { validateWebFetchStateCapsuleReceipt } from "./web-fetch-capsule.js";
import {
  assertSourceContinuityPinBindings,
  sourceContinuityPinRunId,
} from "./source-continuity-pin.js";

export function assertSourceContinuityContexts(
  events: readonly RunEvent[],
  runsById: ReadonlyMap<string, Record<string, unknown>>,
  thread: Readonly<Record<string, unknown>>,
): void {
  const runOrder = thread["runIds"] as readonly string[];
  const importProvenance = thread["importProvenance"] as
    | ThreadImportProvenance
    | undefined;
  assertSourceContinuityPinBindings(events, runsById, thread);
  for (const event of events.filter(
    (candidate) => candidate.type === "context.research_sources",
  )) {
    const receipt = validateResearchSourceCapsuleReceipt(event.payload);
    const run = runsById.get(event.runId) as
      | (Partial<RunRecord> & Record<string, unknown>)
      | undefined;
    if (
      !continuityRun(run, runsById, runOrder, importProvenance, events) ||
      receipt.sourceRunId !== event.runId
    ) {
      throw new Error(
        `Thread replay bundle Research Source context is not bound to a continuity Run: ${event.runId}`,
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
      !continuityRun(run, runsById, runOrder, importProvenance, events) ||
      receipt.sourceRunId !== event.runId
    ) {
      throw new Error(
        `Thread replay bundle Web Fetch context is not bound to a continuity Run: ${event.runId}`,
      );
    }
  }
}

function continuityRun(
  run: (Partial<RunRecord> & Record<string, unknown>) | undefined,
  runsById: ReadonlyMap<string, Record<string, unknown>>,
  runOrder: readonly string[],
  importProvenance: ThreadImportProvenance | undefined,
  events: readonly RunEvent[],
): boolean {
  if (!run?.id || !run.threadId) return false;
  const ordered = runOrder.flatMap((id) => {
    const candidate = runsById.get(id);
    return candidate ? [candidate as unknown as RunRecord] : [];
  });
  return Boolean(
    sourceContinuityPredecessor(
      {
        listRuns: () => ordered,
        getThread: () => ({
          ...(importProvenance ? { importProvenance } : {}),
        }),
      },
      { threadId: String(run.threadId), runId: String(run.id) },
      {
        allowSettledCurrent: true,
        ...(sourceContinuityPinRunId(events, String(run.id))
          ? {
              explicitRunId: sourceContinuityPinRunId(events, String(run.id))!,
            }
          : {}),
      },
    ),
  );
}
