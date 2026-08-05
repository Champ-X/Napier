import type { RunEvent, RunRecord } from "@napier/contracts";

import {
  type ResearchSourceCapsuleReceipt,
  validateResearchSourceCapsuleReceipt,
} from "./research-source-capsule.js";
import { sourceContinuityPredecessor } from "./source-continuity-lineage.js";
import {
  type WebFetchStateCapsuleReceipt,
  validateWebFetchStateCapsuleReceipt,
} from "./web-fetch-capsule.js";

export function assertSourceContinuityPinBindings(
  events: readonly RunEvent[],
  runsById: ReadonlyMap<string, Record<string, unknown>>,
  thread: Readonly<Record<string, unknown>>,
): void {
  for (const event of events.filter(
    (candidate) => candidate.type === "run.started",
  )) {
    const runId = event.runId;
    const current = runsById.get(runId) as RunRecord | undefined;
    if (!current) {
      throw new Error(`Source continuity pin Run is missing: ${runId}`);
    }
    const explicitRunId = requestedRunId(event);
    if (!explicitRunId || current.status !== "completed") continue;
    const runs = orderedRuns(runsById, thread);
    const source = sourceContinuityPredecessor(
      {
        listRuns: () => runs,
        getThread: () => ({
          ...(thread["importProvenance"]
            ? {
                importProvenance: thread[
                  "importProvenance"
                ] as import("@napier/contracts").ThreadImportProvenance,
              }
            : {}),
        }),
      },
      { threadId: current.threadId, runId },
      { allowSettledCurrent: true, explicitRunId },
    );
    if (!source || !pinMatchesRunEvidence(events, source.id, current)) {
      throw new Error(`Source continuity pin binding is invalid: ${runId}`);
    }
  }
}

export function sourceContinuityPinRunId(
  events: readonly RunEvent[],
  runId: string,
): string | undefined {
  const started = events.filter(
    (event) => event.runId === runId && event.type === "run.started",
  );
  if (started.length === 0) return undefined;
  if (started.length !== 1) throw new Error(`Duplicate run start: ${runId}`);
  return requestedRunId(started[0]!);
}

function pinMatchesRunEvidence(
  events: readonly RunEvent[],
  sourceRunId: string,
  current: RunRecord,
): boolean {
  if (current.status !== "completed") return true;
  const sourceResearch = latestResearchReceipt(events, sourceRunId);
  const sourceWebFetch = latestWebFetchReceipt(events, sourceRunId);
  const currentResearch = latestContextResearchReceipt(events, current.id);
  const currentWebFetch = latestContextWebFetchReceipt(events, current.id);
  return (
    Boolean(currentResearch || currentWebFetch) &&
    (!currentResearch || sameResearch(currentResearch, sourceResearch)) &&
    (!currentWebFetch || sameWebFetch(currentWebFetch, sourceWebFetch))
  );
}

function latestResearchReceipt(events: readonly RunEvent[], runId: string) {
  return events.flatMap((event) => researchReceipt(event, runId)).at(-1);
}

function latestWebFetchReceipt(events: readonly RunEvent[], runId: string) {
  return events.flatMap((event) => webFetchReceipt(event, runId)).at(-1);
}

function latestContextResearchReceipt(
  events: readonly RunEvent[],
  runId: string,
) {
  const event = events.findLast(
    (candidate) =>
      candidate.runId === runId &&
      candidate.type === "context.research_sources",
  );
  return event
    ? validateResearchSourceCapsuleReceipt(event.payload)
    : undefined;
}

function latestContextWebFetchReceipt(
  events: readonly RunEvent[],
  runId: string,
) {
  const event = events.findLast(
    (candidate) =>
      candidate.runId === runId &&
      candidate.type === "context.web_fetch_sources",
  );
  return event ? validateWebFetchStateCapsuleReceipt(event.payload) : undefined;
}

function researchReceipt(event: RunEvent, runId: string) {
  if (event.runId !== runId) return [];
  if (event.type === "context.research_sources") {
    return [validateResearchSourceCapsuleReceipt(event.payload)];
  }
  if (event.type !== "tool.completed") return [];
  const payload = record(event.payload);
  if (payload["toolName"] !== "research_source") return [];
  const details = record(payload["details"]);
  return details["stateCapsule"]
    ? [validateResearchSourceCapsuleReceipt(details["stateCapsule"])]
    : [];
}

function webFetchReceipt(event: RunEvent, runId: string) {
  if (event.runId !== runId) return [];
  if (event.type === "context.web_fetch_sources") {
    return [validateWebFetchStateCapsuleReceipt(event.payload)];
  }
  if (event.type !== "tool.completed") return [];
  const payload = record(event.payload);
  if (payload["toolName"] !== "web_fetch") return [];
  const details = record(payload["details"]);
  return details["stateCapsule"]
    ? [validateWebFetchStateCapsuleReceipt(details["stateCapsule"])]
    : [];
}

function sameResearch(
  expected: ResearchSourceCapsuleReceipt | undefined,
  actual: ResearchSourceCapsuleReceipt | undefined,
): boolean {
  return expected
    ? actual?.sourceCount === expected.sourceCount &&
        actual.citationCount === expected.citationCount &&
        actual.sourceSetSha256 === expected.sourceSetSha256
    : actual === undefined;
}

function sameWebFetch(
  expected: WebFetchStateCapsuleReceipt | undefined,
  actual: WebFetchStateCapsuleReceipt | undefined,
): boolean {
  return expected
    ? actual?.sourceCount === expected.sourceCount &&
        actual.sourceSetSha256 === expected.sourceSetSha256
    : actual === undefined;
}

function orderedRuns(
  runsById: ReadonlyMap<string, Record<string, unknown>>,
  thread: Readonly<Record<string, unknown>>,
): RunRecord[] {
  return (thread["runIds"] as readonly string[]).flatMap((id) => {
    const run = runsById.get(id);
    return run ? [run as unknown as RunRecord] : [];
  });
}

function requestedRunId(event: RunEvent): string | undefined {
  const value = record(event.payload)["sourceContinuityRunId"];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !RUN_ID.test(value)) {
    throw new Error(`Source continuity pin request is invalid: ${event.runId}`);
  }
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Source continuity pin receipt is invalid");
  }
  return value as Record<string, unknown>;
}

const RUN_ID = /^run_[a-z0-9]{8,80}$/u;
