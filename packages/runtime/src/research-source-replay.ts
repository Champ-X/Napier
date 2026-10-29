import type {
  RunEvent,
  RunRecord,
  ThreadImportProvenance,
  SubagentTask,
} from "@napier/contracts";

import { validateResearchSourceCapsuleReceipt } from "./research-source-capsule.js";
import { sourceContinuityPredecessor } from "./source-continuity-lineage.js";
import { validateWebFetchStateCapsuleReceipt } from "./web-fetch-capsule.js";
import { validateSubagentRunBinding } from "./subagent-child-run-validation.js";
import { isWebFetchStateToolName } from "./web-fetch-state-tool.js";
import {
  assertSourceContinuityPinBindings,
  sourceContinuityPinRunId,
} from "./source-continuity-pin.js";

export function assertSourceContinuityContexts(
  events: readonly RunEvent[],
  runsById: ReadonlyMap<string, Record<string, unknown>>,
  thread: Readonly<Record<string, unknown>>,
  subagents: readonly SubagentTask[] = [],
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
      !continuityRun(run, runsById, runOrder, importProvenance, events, event, subagents) ||
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
      !continuityRun(run, runsById, runOrder, importProvenance, events, event, subagents) ||
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
  context: RunEvent,
  subagents: readonly SubagentTask[],
): boolean {
  if (!run?.id || !run.threadId) return false;
  if (run.source === "subagent") {
    if (importProvenance) return false;
    const child = run as unknown as RunRecord;
    const parent = runsById.get(child.parentRunId ?? "") as unknown as RunRecord | undefined;
    const task = subagents.find((candidate) => candidate.id === child.subagent?.taskId);
    validateSubagentRunBinding(child, parent, task);
    const tool = context.type === "context.web_fetch_sources" ? "web_fetch" : "research_source";
    if (!child.configuration?.enabledTools.includes(tool) || !parent?.configuration?.enabledTools.includes(tool))
      return false;
    return matchingParentSourceReceipt(events, context, parent.id);
  }
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

function matchingParentSourceReceipt(events: readonly RunEvent[], context: RunEvent, parentId: string): boolean {
  const web = context.type === "context.web_fetch_sources";
  const parse = web ? validateWebFetchStateCapsuleReceipt : validateResearchSourceCapsuleReceipt;
  const child = parse(context.payload);
  // Parent may continue adding sources after delegation; bind the copied set
  // to a prior immutable receipt, never to later mutable parent state.
  return events.slice(0, events.indexOf(context)).some((event) => {
    if (event.runId !== parentId) return false;
    const payload = record(event.payload);
    const details = record(payload?.["details"]);
    const candidate = event.type === context.type ? payload
      : event.type === "tool.completed" && (web
        ? isWebFetchStateToolName(payload?.["toolName"])
        : payload?.["toolName"] === "research_source") ? details?.["stateCapsule"] : undefined;
    if (!candidate) return false;
    const receipt = parse(candidate);
    return receipt.sourceRunId === parentId && receipt.sourceCount === child.sourceCount &&
      receipt.sourceSetSha256 === child.sourceSetSha256 &&
      (!("citationCount" in child) || ("citationCount" in receipt && receipt.citationCount === child.citationCount));
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
