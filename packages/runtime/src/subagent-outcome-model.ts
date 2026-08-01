import type {
  ModelRef,
  SubagentOutcome,
  SubagentOutcomeEvidence,
  SubagentOutcomeItem,
  SubagentOutcomeItemKind,
  SubagentOutcomeSeverity,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { subagentRoleInstructions } from "./subagent-role-instructions.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const ITEM_KINDS = new Set<SubagentOutcomeItemKind>([
  "finding",
  "risk",
  "recommendation",
]);
const SEVERITIES = new Set<SubagentOutcomeSeverity>([
  "info",
  "warning",
  "blocker",
]);
const MAX_ITEMS = 20;
const MAX_EVIDENCE_PER_ITEM = 10;
const MAX_UNKNOWNS = 12;

export interface SubagentOutcomeEvidenceReference {
  path: string;
  lineStart?: number;
  lineEnd?: number;
}

interface ParsedSubagentOutcomeItem extends Omit<
  SubagentOutcomeItem,
  "evidence"
> {
  evidence: SubagentOutcomeEvidenceReference[];
}

export interface ParsedSubagentResult {
  summary: string;
  items: ParsedSubagentOutcomeItem[];
  unknowns: string[];
}

export interface StoredSubagentResult {
  summary: string;
  items: SubagentOutcomeItem[];
  unknowns: string[];
}

export function parseSubagentResult(input: unknown): ParsedSubagentResult {
  const value =
    typeof input === "string"
      ? parseJsonObject(input, "Subagent result")
      : exactRecord(input, "Subagent result", ["summary", "items", "unknowns"]);
  const summary = boundedText(value["summary"], "summary", 1, 2_000);
  const items = value["items"];
  const unknowns = value["unknowns"];
  if (!Array.isArray(items) || items.length > MAX_ITEMS) {
    throw new Error(`Subagent result items must contain at most ${MAX_ITEMS}`);
  }
  if (!Array.isArray(unknowns) || unknowns.length > MAX_UNKNOWNS) {
    throw new Error(
      `Subagent result unknowns must contain at most ${MAX_UNKNOWNS}`,
    );
  }
  return {
    summary,
    items: items.map((item, index) => parseItem(item, index)),
    unknowns: canonicalStrings(
      unknowns.map((unknown, index) =>
        boundedText(unknown, `unknowns[${index}]`, 1, 500),
      ),
    ),
  };
}

export function parseStoredSubagentResult(
  input: unknown,
): StoredSubagentResult {
  const value = exactRecord(input, "Subagent outcome result", [
    "summary",
    "items",
    "unknowns",
  ]);
  const summary = boundedText(value["summary"], "summary", 1, 2_000);
  const items = value["items"];
  const unknowns = value["unknowns"];
  if (!Array.isArray(items) || items.length > MAX_ITEMS) {
    throw new Error(`Subagent outcome items must contain at most ${MAX_ITEMS}`);
  }
  if (!Array.isArray(unknowns) || unknowns.length > MAX_UNKNOWNS) {
    throw new Error(
      `Subagent outcome unknowns must contain at most ${MAX_UNKNOWNS}`,
    );
  }
  return {
    summary,
    items: items.map((item, index) => parseStoredItem(item, index)),
    unknowns: canonicalStrings(
      unknowns.map((unknown, index) =>
        boundedText(unknown, `unknowns[${index}]`, 1, 500),
      ),
    ),
  };
}

export function buildSubagentOutcome(
  input: Omit<
    SubagentOutcome,
    | "kind"
    | "schemaVersion"
    | "itemCount"
    | "unknownCount"
    | "evidenceCount"
    | "instructionsSha256"
    | "itemSetSha256"
    | "evidenceSetSha256"
    | "contentSha256"
  >,
  schemaVersion: 1 | 2,
): SubagentOutcome {
  const itemSetSha256 = sha256(canonicalJson(input.items));
  const evidenceEntries = new Map<string, SubagentOutcomeEvidence>();
  for (const evidence of input.items.flatMap((item) => item.evidence)) {
    evidenceEntries.set(canonicalJson(evidence), evidence);
  }
  const evidenceSet = [...evidenceEntries.values()].sort((left, right) =>
    canonicalJson(left).localeCompare(canonicalJson(right)),
  );
  const evidenceSetSha256 = sha256(canonicalJson(evidenceSet));
  const shared = {
    kind: "napier.subagent-outcome" as const,
    schemaVersion,
    taskId: input.taskId,
    role: input.role,
    model: structuredClone(input.model),
    summary: input.summary,
    items: structuredClone(input.items),
    unknowns: [...input.unknowns],
    itemCount: input.items.length,
    unknownCount: input.unknowns.length,
    promptSha256: input.promptSha256,
    instructionsSha256: sha256(subagentRoleInstructions(input.role)),
    resultSha256: input.resultSha256,
    itemSetSha256,
  };
  const content =
    schemaVersion === 2
      ? {
          ...shared,
          schemaVersion: 2 as const,
          evidenceCount: evidenceSet.length,
          evidenceSetSha256,
        }
      : { ...shared, schemaVersion: 1 as const };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function normalizeSubagentModel(input: unknown): ModelRef {
  const model = exactRecord(input, "Subagent outcome model", [
    "provider",
    "id",
  ]);
  const provider = model["provider"];
  const id = model["id"];
  if (
    typeof provider !== "string" ||
    !/^[a-z][a-z0-9_-]{0,63}$/u.test(provider) ||
    typeof id !== "string" ||
    !id ||
    id.length > 200 ||
    /[\u0000-\u001f\u007f<>\s]/u.test(id)
  ) {
    throw new Error("Subagent outcome model is invalid");
  }
  return { provider, id };
}

export function canonicalSubagentEvidence(
  values: SubagentOutcomeEvidence[],
): SubagentOutcomeEvidence[] {
  const entries = new Map<string, SubagentOutcomeEvidence>();
  for (const value of values) {
    entries.set(canonicalJson(value), value);
  }
  return [...entries.values()].sort((left, right) =>
    canonicalJson(left).localeCompare(canonicalJson(right)),
  );
}

function parseItem(input: unknown, index: number): ParsedSubagentOutcomeItem {
  const item = exactRecord(input, `Subagent result items[${index}]`, [
    "kind",
    "severity",
    "title",
    "detail",
    "evidence",
  ]);
  const kind = item["kind"];
  const severity = item["severity"];
  if (
    typeof kind !== "string" ||
    !ITEM_KINDS.has(kind as SubagentOutcomeItemKind) ||
    typeof severity !== "string" ||
    !SEVERITIES.has(severity as SubagentOutcomeSeverity)
  ) {
    throw new Error(
      `Subagent result items[${index}] classification is invalid`,
    );
  }
  const evidence = item["evidence"];
  if (!Array.isArray(evidence) || evidence.length > MAX_EVIDENCE_PER_ITEM) {
    throw new Error(
      `Subagent result items[${index}].evidence must contain at most ${MAX_EVIDENCE_PER_ITEM}`,
    );
  }
  return {
    kind: kind as SubagentOutcomeItemKind,
    severity: severity as SubagentOutcomeSeverity,
    title: boundedText(item["title"], `items[${index}].title`, 1, 200),
    detail: boundedText(item["detail"], `items[${index}].detail`, 1, 1_500),
    evidence: canonicalEvidenceReferences(
      evidence.map((entry, evidenceIndex) =>
        parseEvidence(entry, index, evidenceIndex),
      ),
    ),
  };
}

function parseStoredItem(input: unknown, index: number): SubagentOutcomeItem {
  const item = exactRecord(input, `Subagent outcome items[${index}]`, [
    "kind",
    "severity",
    "title",
    "detail",
    "evidence",
  ]);
  const kind = item["kind"];
  const severity = item["severity"];
  if (
    typeof kind !== "string" ||
    !ITEM_KINDS.has(kind as SubagentOutcomeItemKind) ||
    typeof severity !== "string" ||
    !SEVERITIES.has(severity as SubagentOutcomeSeverity)
  ) {
    throw new Error(
      `Subagent outcome items[${index}] classification is invalid`,
    );
  }
  const evidence = item["evidence"];
  if (!Array.isArray(evidence) || evidence.length > MAX_EVIDENCE_PER_ITEM) {
    throw new Error(
      `Subagent outcome items[${index}].evidence must contain at most ${MAX_EVIDENCE_PER_ITEM}`,
    );
  }
  return {
    kind: kind as SubagentOutcomeItemKind,
    severity: severity as SubagentOutcomeSeverity,
    title: boundedText(item["title"], `items[${index}].title`, 1, 200),
    detail: boundedText(item["detail"], `items[${index}].detail`, 1, 1_500),
    evidence: canonicalSubagentEvidence(
      evidence.map((entry, evidenceIndex) =>
        parseGroundedEvidence(entry, index, evidenceIndex),
      ),
    ),
  };
}

function parseEvidence(
  input: unknown,
  itemIndex: number,
  evidenceIndex: number,
): SubagentOutcomeEvidenceReference {
  const label = `items[${itemIndex}].evidence[${evidenceIndex}]`;
  const evidence = exactRecord(
    input,
    `Subagent result ${label}`,
    ["path", "lineStart", "lineEnd"],
    ["path"],
  );
  return normalizeEvidenceReference(evidence, label, "Subagent result");
}

function parseGroundedEvidence(
  input: unknown,
  itemIndex: number,
  evidenceIndex: number,
): SubagentOutcomeEvidence {
  const label = `items[${itemIndex}].evidence[${evidenceIndex}]`;
  const evidence = exactRecord(
    input,
    `Subagent outcome ${label}`,
    [
      "path",
      "lineStart",
      "lineEnd",
      "fileSha256",
      "rangeSha256",
      "fileSizeBytes",
      "observedLineCount",
    ],
    ["path", "fileSha256", "rangeSha256", "fileSizeBytes", "observedLineCount"],
  );
  const reference = normalizeEvidenceReference(
    evidence,
    label,
    "Subagent outcome",
  );
  const fileSizeBytes = nonNegativeInteger(
    evidence["fileSizeBytes"],
    `${label}.fileSizeBytes`,
  );
  const observedLineCount = positiveInteger(
    evidence["observedLineCount"],
    `${label}.observedLineCount`,
  );
  if (
    reference.lineStart !== undefined &&
    observedLineCount !== reference.lineEnd! - reference.lineStart + 1
  ) {
    throw new Error(`Subagent outcome ${label} observed line count is invalid`);
  }
  return {
    ...reference,
    fileSha256: digest(evidence["fileSha256"], `${label}.fileSha256`),
    rangeSha256: digest(evidence["rangeSha256"], `${label}.rangeSha256`),
    fileSizeBytes,
    observedLineCount,
  };
}

function normalizeEvidenceReference(
  evidence: Record<string, unknown>,
  label: string,
  prefix: string,
): SubagentOutcomeEvidenceReference {
  const path = boundedText(evidence["path"], `${label}.path`, 1, 500);
  const segments = path.split("/");
  if (
    path.startsWith("/") ||
    path.startsWith("~") ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(path) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`${prefix} ${label}.path is not workspace-relative`);
  }
  const hasLineStart = evidence["lineStart"] !== undefined;
  const hasLineEnd = evidence["lineEnd"] !== undefined;
  if (hasLineStart !== hasLineEnd) {
    throw new Error(`${prefix} ${label} line range is incomplete`);
  }
  if (!hasLineStart) return { path };
  const lineStart = positiveInteger(
    evidence["lineStart"],
    `${label}.lineStart`,
  );
  const lineEnd = positiveInteger(evidence["lineEnd"], `${label}.lineEnd`);
  if (lineEnd < lineStart) {
    throw new Error(`${prefix} ${label} line range is invalid`);
  }
  return { path, lineStart, lineEnd };
}

function parseJsonObject(
  value: string,
  label: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must be one valid JSON object`);
  }
  return exactRecord(parsed, label, ["summary", "items", "unknowns"]);
}

function exactRecord(
  value: unknown,
  label: string,
  keys: string[],
  requiredKeys: string[] = keys,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(keys);
  const unexpected = Object.keys(record).find((key) => !allowed.has(key));
  const missing = requiredKeys.find((key) => !(key in record));
  if (unexpected)
    throw new Error(`${label} has unsupported field: ${unexpected}`);
  if (missing) throw new Error(`${label} is missing ${missing}`);
  return record;
}

function boundedText(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): string {
  if (typeof value !== "string") throw new Error(`${label} must be text`);
  const normalized = value.trim();
  if (
    normalized.length < minimum ||
    normalized.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)
  ) {
    throw new Error(`${label} is outside its text bounds`);
  }
  return normalized;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Number(value);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return Number(value);
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`Subagent outcome ${label} is invalid`);
  }
  return value;
}

function canonicalStrings(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function canonicalEvidenceReferences(
  values: SubagentOutcomeEvidenceReference[],
): SubagentOutcomeEvidenceReference[] {
  const entries = new Map<string, SubagentOutcomeEvidenceReference>();
  for (const value of values) {
    entries.set(canonicalJson(value), value);
  }
  return [...entries.values()].sort((left, right) =>
    canonicalJson(left).localeCompare(canonicalJson(right)),
  );
}
