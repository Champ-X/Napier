import type { JsonObject, JsonValue, RunEvent, RunRecord, SubagentTask } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import { foldModelAccounting, hasModelAccounting } from "./model-accounting-fold.js";
import { validateModelCallAttribution, validateModelPhysicalObservation } from "./model-usage-observation.js";

export function allocateImportedModelAccountingIds(events: readonly RunEvent[], idMap: Map<string, string>): void {
  for (const event of events) {
    const payload = object(event.payload);
    if (event.type === "model.accounting.prepared") {
      const attribution = validateModelCallAttribution(payload["attribution"]);
      if (!idMap.has(attribution.physicalId)) idMap.set(attribution.physicalId, createId("physical"));
    }
    if (event.type === "subagent.child.invocation_reserved" && typeof payload["invocationId"] === "string")
      idMap.set(payload["invocationId"], `childinv_${sha256(createId("import"))}`);
  }
}

/** Rebind only identity fields. Original request/response hashes stay immutable historical evidence. */
export function rebindImportedModelAccountingEvent(type: string, value: JsonValue, idMap: Map<string, string>): JsonValue | undefined {
  const payload = object(value);
  if (type === "model.advisor.independent.reviewed" && typeof payload["physicalId"] === "string") {
    const physicalId = idMap.get(payload["physicalId"]);
    if (!physicalId) return value;
    const attributionSha256 = idMap.get(String(payload["attributionSha256"]));
    if (!attributionSha256) throw new Error("Imported advisor review lacks its rebound attribution");
    const { contentSha256: originalSha256, ...content } = payload;
    if (sha256(canonicalJson(content)) !== originalSha256) throw new Error("Imported advisor review digest differs");
    const rebound = { ...content, physicalId, attributionSha256 };
    const contentSha256 = sha256(canonicalJson(rebound));
    idMap.set(String(originalSha256), contentSha256);
    return { ...rebound, contentSha256 };
  }
  if (type === "model.accounting.prepared") {
    const source = validateModelCallAttribution(payload["attribution"]);
    const physicalId = idMap.get(source.physicalId);
    if (!physicalId) return value;
    const owner = Object.fromEntries(Object.entries(source.owner).map(([key, field]) => [key,
      typeof field === "string" && key !== "kind" && key !== "operation" ? idMap.get(field) ?? field : field]));
    const { contentSha256: originalSha256, ...content } = source;
    const rebound = { ...content, physicalId, owner,
      ...(source.route ? { route: { ...source.route, planId: idMap.get(source.route.planId) ?? source.route.planId } } : {}) };
    const attribution = validateModelCallAttribution({ ...rebound, contentSha256: sha256(canonicalJson(rebound)) });
    idMap.set(originalSha256, attribution.contentSha256);
    return { attribution: json(attribution), importedAccountingOrigin: payload["importedAccountingOrigin"] ?? {
      physicalId: source.physicalId, attributionSha256: originalSha256, workspaceLedgerId: source.workspaceLedgerId,
    } };
  }
  if (type === "model.usage.reconciled") {
    const source = validateModelPhysicalObservation(payload["observation"]);
    const physicalId = idMap.get(source.physicalId);
    if (!physicalId) return value;
    const attributionSha256 = idMap.get(source.attributionSha256);
    if (!attributionSha256) throw new Error("Imported accounting observation lacks its rebound attribution");
    const { contentSha256: originalSha256, ...content } = source;
    const rebound = { ...content, physicalId, attributionSha256 };
    const observation = validateModelPhysicalObservation({ ...rebound, contentSha256: sha256(canonicalJson(rebound)) });
    idMap.set(originalSha256, observation.contentSha256);
    return { physicalId, attributionSha256, accountingMode: "physical_receipt_v1", observation: json(observation),
      importedAccountingOrigin: payload["importedAccountingOrigin"] ?? { physicalId: source.physicalId,
        attributionSha256: source.attributionSha256, observationSha256: originalSha256 } };
  }
  return undefined;
}

export function projectImportedModelAccounting(runs: RunRecord[], tasks: SubagentTask[], events: readonly RunEvent[]): void {
  for (const run of [...runs.filter((value) => value.source === "subagent"), ...runs.filter((value) => value.source !== "subagent")]) {
    const ownEvents = events.filter((event) => event.runId === run.id), children = tasks.filter((task) => task.runId === run.id);
    if (!hasModelAccounting(ownEvents, children)) continue;
    const fold = foldModelAccounting(ownEvents, children);
    run.usage = fold.usage; run.usageStatus = fold.summary.usageStatus; run.accounting = fold.summary;
    if (run.subagent) {
      const task = tasks.find((value) => value.id === run.subagent!.taskId);
      if (!task) throw new Error("Imported accounting child Task is unavailable");
      task.usage = structuredClone(fold.usage); task.usageStatus = fold.summary.usageStatus; task.accounting = structuredClone(fold.summary);
    }
  }
}
function json(value: unknown): JsonObject { return JSON.parse(canonicalJson(value)) as JsonObject; }
function object(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }
