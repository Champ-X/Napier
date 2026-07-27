import type {
  ModelRef,
  SubagentOutcome,
  SubagentOutcomeEvidence,
  SubagentOutcomeItem,
  SubagentOutcomeItemKind,
  SubagentOutcomeSeverity,
  SubagentRole,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

const SHA256 = /^[a-f0-9]{64}$/;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/;
const ROLES = new Set<SubagentRole>(["researcher", "reviewer", "general"]);
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
const MAX_RESULT_BYTES = 64 * 1024;
const MAX_ITEMS = 20;
const MAX_EVIDENCE_PER_ITEM = 10;
const MAX_UNKNOWNS = 12;
// Schema-1 receipts depend on these exact bytes; change them only with a schema bump.
const OUTCOME_INSTRUCTIONS = [
  "Return exactly one JSON object and no Markdown.",
  'Schema: {"summary":string,"items":[{"kind":"finding|risk|recommendation","severity":"info|warning|blocker","title":string,"detail":string,"evidence":[{"path":string,"lineStart":integer,"lineEnd":integer}]}],"unknowns":[string]}.',
  "Evidence paths must be workspace-relative. Include both lineStart and lineEnd or omit both.",
  "Use an empty items array when there are no findings. Never invent evidence.",
].join("\n");
const ROLE_INSTRUCTIONS: Record<SubagentRole, string[]> = {
  researcher: [
    "You are an isolated research subagent.",
    "Investigate only the delegated task using read-only workspace tools.",
    "Return concise findings with file paths and line-level evidence when available.",
    "Distinguish evidence, inference, and unknowns. Do not modify files.",
  ],
  reviewer: [
    "You are an isolated review subagent.",
    "Review the delegated scope for correctness, regressions, security, and missing tests.",
    "Lead with concrete findings ordered by severity and cite file paths.",
    "Do not modify files and do not claim evidence you did not inspect.",
  ],
  general: [
    "You are an isolated general-purpose subagent.",
    "Complete the bounded delegated task using read-only workspace tools.",
    "Your context contains only this task, not the parent conversation.",
    "Return a self-contained result with evidence and remaining uncertainty.",
  ],
};

export interface CreateSubagentOutcomeInput {
  taskId: string;
  role: SubagentRole;
  model: ModelRef;
  prompt: string;
  resultText: string;
}

export interface RebindSubagentOutcomeInput {
  taskId: string;
  prompt: string;
}

interface ParsedSubagentResult {
  summary: string;
  items: SubagentOutcomeItem[];
  unknowns: string[];
}

export function subagentRoleInstructions(role: SubagentRole): string {
  if (!ROLES.has(role)) throw new Error("Subagent role is invalid");
  return [...ROLE_INSTRUCTIONS[role], OUTCOME_INSTRUCTIONS].join("\n");
}

export function createSubagentOutcome(
  input: CreateSubagentOutcomeInput,
): SubagentOutcome {
  if (
    !RESOURCE_ID.test(input.taskId) ||
    !ROLES.has(input.role) ||
    !input.prompt.trim() ||
    Buffer.byteLength(input.resultText, "utf8") > MAX_RESULT_BYTES
  ) {
    throw new Error("Subagent outcome input is invalid");
  }
  const parsed = parseSubagentResult(input.resultText);
  return buildSubagentOutcome({
    taskId: input.taskId,
    role: input.role,
    model: normalizeModel(input.model),
    promptSha256: sha256(input.prompt),
    resultSha256: sha256(input.resultText),
    ...parsed,
  });
}

export function validateSubagentOutcome(input: unknown): SubagentOutcome {
  const record = exactRecord(input, "Subagent outcome", [
    "kind",
    "schemaVersion",
    "taskId",
    "role",
    "model",
    "summary",
    "items",
    "unknowns",
    "itemCount",
    "unknownCount",
    "promptSha256",
    "instructionsSha256",
    "resultSha256",
    "itemSetSha256",
    "contentSha256",
  ]);
  if (
    record["kind"] !== "napier.subagent-outcome" ||
    record["schemaVersion"] !== 1 ||
    typeof record["taskId"] !== "string" ||
    !RESOURCE_ID.test(record["taskId"]) ||
    typeof record["role"] !== "string" ||
    !ROLES.has(record["role"] as SubagentRole)
  ) {
    throw new Error("Subagent outcome identity is invalid");
  }
  const parsed = parseSubagentResult({
    summary: record["summary"],
    items: record["items"],
    unknowns: record["unknowns"],
  });
  const itemCount = nonNegativeInteger(record["itemCount"], "itemCount");
  const unknownCount = nonNegativeInteger(
    record["unknownCount"],
    "unknownCount",
  );
  const promptSha256 = digest(record["promptSha256"], "promptSha256");
  const instructionsSha256 = digest(
    record["instructionsSha256"],
    "instructionsSha256",
  );
  const resultSha256 = digest(record["resultSha256"], "resultSha256");
  const expected = buildSubagentOutcome({
    taskId: record["taskId"],
    role: record["role"] as SubagentRole,
    model: normalizeModel(record["model"]),
    promptSha256,
    resultSha256,
    ...parsed,
  });
  if (
    itemCount !== expected.itemCount ||
    unknownCount !== expected.unknownCount ||
    instructionsSha256 !== expected.instructionsSha256 ||
    record["itemSetSha256"] !== expected.itemSetSha256 ||
    record["contentSha256"] !== expected.contentSha256
  ) {
    throw new Error("Subagent outcome hash evidence is invalid");
  }
  return expected;
}

export function assertSubagentOutcomeBinding(
  input: unknown,
  task: {
    id: string;
    role: SubagentRole;
    model: ModelRef;
    prompt: string;
  },
): SubagentOutcome {
  const outcome = validateSubagentOutcome(input);
  if (
    outcome.taskId !== task.id ||
    outcome.role !== task.role ||
    canonicalJson(outcome.model) !==
      canonicalJson(normalizeModel(task.model)) ||
    outcome.promptSha256 !== sha256(task.prompt)
  ) {
    throw new Error("Subagent outcome task binding is invalid");
  }
  return outcome;
}

export function rebindSubagentOutcome(
  input: unknown,
  binding: RebindSubagentOutcomeInput,
): SubagentOutcome {
  const outcome = validateSubagentOutcome(input);
  if (!RESOURCE_ID.test(binding.taskId) || !binding.prompt.trim()) {
    throw new Error("Subagent outcome import binding is invalid");
  }
  return buildSubagentOutcome({
    taskId: binding.taskId,
    role: outcome.role,
    model: outcome.model,
    summary: outcome.summary,
    items: outcome.items,
    unknowns: outcome.unknowns,
    promptSha256: sha256(binding.prompt),
    resultSha256: outcome.resultSha256,
  });
}

export function formatSubagentOutcome(outcome: SubagentOutcome): string {
  const lines = [outcome.summary];
  for (const item of outcome.items) {
    const evidence = item.evidence
      .map((entry) =>
        entry.lineStart === undefined
          ? entry.path
          : `${entry.path}:${entry.lineStart}${
              entry.lineEnd === entry.lineStart ? "" : `-${entry.lineEnd}`
            }`,
      )
      .join(", ");
    lines.push(
      `[${item.severity}] ${item.title}: ${item.detail}${
        evidence ? ` (${evidence})` : ""
      }`,
    );
  }
  if (outcome.unknowns.length > 0) {
    lines.push(`Unknowns: ${outcome.unknowns.join("; ")}`);
  }
  return lines.join("\n");
}

function parseSubagentResult(input: unknown): ParsedSubagentResult {
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

function parseItem(input: unknown, index: number): SubagentOutcomeItem {
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
    evidence: canonicalEvidence(
      evidence.map((entry, evidenceIndex) =>
        parseEvidence(entry, index, evidenceIndex),
      ),
    ),
  };
}

function parseEvidence(
  input: unknown,
  itemIndex: number,
  evidenceIndex: number,
): SubagentOutcomeEvidence {
  const label = `items[${itemIndex}].evidence[${evidenceIndex}]`;
  const evidence = exactRecord(
    input,
    `Subagent result ${label}`,
    ["path", "lineStart", "lineEnd"],
    ["path"],
  );
  const path = boundedText(evidence["path"], `${label}.path`, 1, 500);
  const segments = path.split("/");
  if (
    path.startsWith("/") ||
    path.startsWith("~") ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(path) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Subagent result ${label}.path is not workspace-relative`);
  }
  const hasLineStart = evidence["lineStart"] !== undefined;
  const hasLineEnd = evidence["lineEnd"] !== undefined;
  if (hasLineStart !== hasLineEnd) {
    throw new Error(`Subagent result ${label} line range is incomplete`);
  }
  if (!hasLineStart) return { path };
  const lineStart = positiveInteger(
    evidence["lineStart"],
    `${label}.lineStart`,
  );
  const lineEnd = positiveInteger(evidence["lineEnd"], `${label}.lineEnd`);
  if (lineEnd < lineStart) {
    throw new Error(`Subagent result ${label} line range is invalid`);
  }
  return { path, lineStart, lineEnd };
}

function buildSubagentOutcome(
  input: Omit<
    SubagentOutcome,
    | "kind"
    | "schemaVersion"
    | "itemCount"
    | "unknownCount"
    | "instructionsSha256"
    | "itemSetSha256"
    | "contentSha256"
  >,
): SubagentOutcome {
  const itemSetSha256 = sha256(canonicalJson(input.items));
  const content = {
    kind: "napier.subagent-outcome" as const,
    schemaVersion: 1 as const,
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
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function normalizeModel(input: unknown): ModelRef {
  const model = exactRecord(input, "Subagent outcome model", [
    "provider",
    "id",
  ]);
  const provider = model["provider"];
  const id = model["id"];
  if (
    typeof provider !== "string" ||
    !/^[a-z][a-z0-9_-]{0,63}$/.test(provider) ||
    typeof id !== "string" ||
    !id ||
    id.length > 200 ||
    /[\u0000-\u001f\u007f<>\s]/u.test(id)
  ) {
    throw new Error("Subagent outcome model is invalid");
  }
  return { provider, id };
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

function canonicalEvidence(
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
