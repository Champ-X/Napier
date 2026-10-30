import type { RunEvent } from "./run-event-v1.js";
import type { ToolFileReceiptPayload } from "./task-tool-file-receipt.js";
import type { TaskDeliverable } from "./task-artifact-facts.js";

export interface TaskToolFileReceipt {
  eventId: string;
  eventSeq: number;
  createdAt: string;
  payload: ToolFileReceiptPayload;
}

export function validToolFileReceipt(
  value: unknown,
): value is ToolFileReceiptPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return (
    Object.keys(p).length === 10 &&
    ["threadId", "runId", "operationId"].every(
      (key) =>
        typeof p[key] === "string" && p[key].length > 0 && p[key].length <= 256,
    ) &&
    validReceiptPath(p.path) &&
    typeof p.fileSha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(p.fileSha256) &&
    Number.isSafeInteger(p.fileBytes) &&
    Number(p.fileBytes) > 0 &&
    Number(p.fileBytes) <= 8 * 1024 * 1024 &&
    typeof p.evidence === "string" &&
    p.evidence.trim().length > 0 &&
    p.evidence.length <= 4000 &&
    validProvenance(p)
  );
}

export function taskToolFileReceipt(
  event: RunEvent,
): TaskToolFileReceipt | undefined {
  if (
    event.type !== "artifact.tool_file_verified" ||
    event.category !== "artifact" ||
    event.visibility !== "user" ||
    event.schemaVersion !== 1 ||
    !event.id ||
    !Number.isSafeInteger(event.seq) ||
    event.seq < 1 ||
    !Number.isFinite(Date.parse(event.createdAt)) ||
    !validToolFileReceipt(event.payload) ||
    event.threadId !== event.payload.threadId ||
    event.runId !== event.payload.runId
  )
    return;
  return {
    eventId: event.id,
    eventSeq: event.seq,
    createdAt: event.createdAt,
    payload: event.payload,
  };
}

/** Latest durable receipt per path; replaying an older receipt cannot replace it. */
export function projectToolFileDeliverables(
  receipts: readonly TaskToolFileReceipt[],
  threadId: string,
  runs: readonly { id: string; threadId: string }[],
): TaskDeliverable[] {
  const order = new Map(
    runs
      .filter((run) => run.threadId === threadId)
      .map((run, index) => [run.id, index]),
  );
  const latest = new Map<string, TaskToolFileReceipt>();
  for (const receipt of receipts) {
    if (
      receipt.payload.threadId !== threadId ||
      !order.has(receipt.payload.runId)
    )
      continue;
    const prior = latest.get(receipt.payload.path);
    if (
      !prior ||
      order.get(prior.payload.runId)! < order.get(receipt.payload.runId)! ||
      (prior.payload.runId === receipt.payload.runId &&
        prior.eventSeq < receipt.eventSeq)
    )
      latest.set(receipt.payload.path, receipt);
  }
  return [...latest.values()]
    .sort((a, b) => b.eventSeq - a.eventSeq)
    .map(({ payload: p, eventId, createdAt }) => ({
      path: p.path,
      source: "tool_file",
      sourceEventId: eventId,
      toolFile: p,
      accessibility: "unchecked",
      verification: "unverified",
      previousVersions: [],
      artifact: {
        id: eventId,
        kind: "file",
        status: "verified",
        path: p.path,
        sourceRunId: p.runId,
        sha256: p.fileSha256,
        sizeBytes: p.fileBytes,
        description:
          p.materialization === "produced"
            ? "Tool wrote and verified these workspace bytes."
            : "Tool verified existing workspace bytes; creation by this Run is not established.",
        evidence: p.evidence,
        createdAt,
        updatedAt: createdAt,
      },
    }));
}

/** Validate the exact non-Plan receipt identity before a consumer uses it. */
export function toolFileDeliverableMatches(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  const p = entry.toolFile;
  if (
    entry.source !== "tool_file" ||
    !validToolFileReceipt(p) ||
    entry.planId !== undefined ||
    entry.planRevision !== undefined ||
    typeof entry.sourceEventId !== "string" ||
    !entry.sourceEventId.trim() ||
    !entry.artifact ||
    typeof entry.artifact !== "object" ||
    Array.isArray(entry.artifact)
  )
    return false;
  const artifact = entry.artifact as Record<string, unknown>;
  return (
    entry.path === p.path &&
    artifact.id === entry.sourceEventId &&
    artifact.kind === "file" &&
    artifact.status === "verified" &&
    artifact.path === p.path &&
    artifact.sha256 === p.fileSha256 &&
    artifact.sizeBytes === p.fileBytes &&
    artifact.sourceRunId === p.runId &&
    artifact.evidence === p.evidence
  );
}

function validReceiptPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 500 &&
    !/[\\:\x00-\x1f?#]/u.test(value) &&
    value.split("/").length <= 64 &&
    value
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}
function validProvenance(p: Record<string, unknown>): boolean {
  return (
    (p.toolName === "browser" &&
      ["download", "save_screenshot"].includes(String(p.action)) &&
      p.materialization === "produced") ||
    (p.toolName === "research_source" &&
      p.action === "verify_report" &&
      p.materialization === "observed") ||
    (p.toolName === "web_fetch" &&
      p.action === "save" &&
      p.materialization === "produced")
  );
}
