import { createHash } from "node:crypto";

const keys = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "costUsd",
];
const auxiliary = new Set([
  "context.compaction.completed",
  "context.compaction.failed",
  "goal.evaluated",
  "memory.extraction.completed",
  "memory.extraction.failed",
  "model.advisor.independent.reviewed",
  "model.thinking_loop.detected",
  "model.context.overflow",
]);
const discarded = new Set([
  "model.thinking_loop.detected",
  "model.context.overflow",
]);
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const zero = () => Object.fromEntries(keys.map((key) => [key, 0]));

/** Reconcile the persisted Run against recorded usage, without pretending that
 * missing or estimated provider receipts establish complete billing/cost data. */
export function collectUsageEvidence(run, events, subagents = []) {
  const blockers = [],
    receipts = [],
    seen = new Set();
  const owned = events.filter((e) => e.runId === run.id);
  if (owned.length !== events.length) blockers.push("foreign_run_events");
  const responseEvents = owned.filter((e) => e.type === "model.response");
  const primary = responseEvents.length
    ? responseEvents
    : owned.filter((e) => e.type === "message.assistant");
  const observed = zero(),
    responseOnly = zero();
  const valid = (usage) =>
    usage &&
    keys.every(
      (key) =>
        typeof usage[key] === "number" &&
        Number.isFinite(usage[key]) &&
        usage[key] >= 0 &&
        (key === "costUsd" || Number.isSafeInteger(usage[key])),
    );
  const add = (total, usage) => {
    for (const key of keys) total[key] += usage[key];
  };
  for (const event of [
    ...primary,
    ...owned.filter((e) => auxiliary.has(e.type)),
  ]) {
    if (!event.id || seen.has(event.id)) {
      blockers.push("duplicate_or_missing_event_id");
      continue;
    }
    seen.add(event.id);
    const usage = event.payload?.usage;
    if (usage === undefined) {
      if (discarded.has(event.type))
        blockers.push(`${event.id}: missing_discarded_usage`);
      continue;
    }
    if (!valid(usage)) {
      blockers.push(`${event.id}: invalid_usage`);
      continue;
    }
    const selected = Object.fromEntries(keys.map((key) => [key, usage[key]]));
    add(observed, selected);
    if (event.type === "model.response") add(responseOnly, selected);
    if (
      event.type === "model.thinking_loop.detected" &&
      event.payload.usageSource !== "provider_terminal"
    )
      blockers.push(`${event.id}: estimated_or_unknown_discarded_usage`);
    receipts.push({
      eventId: event.id,
      type: event.type,
      usage: selected,
      sourceReceiptSha256: hash(event.payload),
    });
  }
  for (const task of subagents) {
    if (
      !task.id ||
      seen.has(`task:${task.id}`) ||
      task.runId !== run.id ||
      !valid(task.usage)
    ) {
      blockers.push("invalid_subagent_usage");
      continue;
    }
    seen.add(`task:${task.id}`);
    add(observed, task.usage);
    receipts.push({ subagentTaskId: task.id, usage: task.usage });
  }
  const matches =
    valid(run.usage) &&
    keys.every(
      (key) =>
        Math.abs(run.usage[key] - observed[key]) <=
        (key === "costUsd" ? 1e-10 : 0),
    );
  if (!matches) blockers.push("persisted_run_usage_mismatch");
  const content = {
    kind: "napier.harness-usage-evidence",
    schemaVersion: 1,
    runId: run.id,
    scope:
      "recorded model and subagent usage; not external billing or cache/latency attribution",
    persistedUsage: structuredClone(run.usage),
    observedUsage: observed,
    legacyResponseOnlyUsage: responseOnly,
    receipts,
    blockers,
    eligibleForObservedUsageComparison: blockers.length === 0,
  };
  return { ...content, contentSha256: hash(content) };
}
