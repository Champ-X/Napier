import type {
  GroundedSubagentOutcome,
  ModelRef,
  SubagentOutcome,
  SubagentOutcomeEvidence,
  SubagentOutcomeEvidenceVerification,
  SubagentOutcomeEvidenceVerificationItem,
  SubagentOutcomeItem,
  SubagentOutcomeItemKind,
  SubagentOutcomeSeverity,
  SubagentRole,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { readWorkspaceTextEvidence } from "./tools.js";

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

interface SubagentOutcomeEvidenceReference {
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

interface ParsedSubagentResult {
  summary: string;
  items: ParsedSubagentOutcomeItem[];
  unknowns: string[];
}

interface StoredSubagentResult {
  summary: string;
  items: SubagentOutcomeItem[];
  unknowns: string[];
}

type GroundedVerificationEvidence = {
  path: string;
  fileSha256: string;
  rangeSha256: string;
} & (
  | {
      lineStart?: never;
      lineEnd?: never;
    }
  | {
      lineStart: number;
      lineEnd: number;
    }
);

export function subagentRoleInstructions(role: SubagentRole): string {
  if (!ROLES.has(role)) throw new Error("Subagent role is invalid");
  return [...ROLE_INSTRUCTIONS[role], OUTCOME_INSTRUCTIONS].join("\n");
}

export function subagentOutcomeContractInstructions(): string {
  return OUTCOME_INSTRUCTIONS;
}

export function isRepairableSubagentOutcomeResult(resultText: string): boolean {
  if (Buffer.byteLength(resultText, "utf8") > MAX_RESULT_BYTES) return false;
  try {
    parseSubagentResult(resultText);
    return false;
  } catch {
    return true;
  }
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
  if (parsed.items.some((item) => item.evidence.length > 0)) {
    throw new Error("Subagent outcome evidence requires workspace grounding");
  }
  return buildSubagentOutcome(
    {
      taskId: input.taskId,
      role: input.role,
      model: normalizeModel(input.model),
      promptSha256: sha256(input.prompt),
      resultSha256: sha256(input.resultText),
      summary: parsed.summary,
      items: parsed.items,
      unknowns: parsed.unknowns,
    },
    1,
  );
}

export async function createGroundedSubagentOutcome(
  input: CreateSubagentOutcomeInput & { workspaceRoot: string },
): Promise<GroundedSubagentOutcome> {
  if (
    !RESOURCE_ID.test(input.taskId) ||
    !ROLES.has(input.role) ||
    !input.prompt.trim() ||
    Buffer.byteLength(input.resultText, "utf8") > MAX_RESULT_BYTES
  ) {
    throw new Error("Subagent outcome input is invalid");
  }
  const parsed = parseSubagentResult(input.resultText);
  const items = await Promise.all(
    parsed.items.map(
      async (item): Promise<SubagentOutcomeItem> => ({
        ...item,
        evidence: await Promise.all(
          item.evidence.map(
            async (reference): Promise<SubagentOutcomeEvidence> => {
              const observed = await readWorkspaceTextEvidence(
                input.workspaceRoot,
                reference,
              );
              return {
                path: observed.path,
                ...(reference.lineStart === undefined
                  ? {}
                  : {
                      lineStart: observed.lineStart,
                      lineEnd: observed.lineEnd,
                    }),
                fileSha256: observed.fileSha256,
                rangeSha256: observed.rangeSha256,
                fileSizeBytes: observed.fileSizeBytes,
                observedLineCount: observed.observedLineCount,
              };
            },
          ),
        ),
      }),
    ),
  );
  return buildSubagentOutcome(
    {
      taskId: input.taskId,
      role: input.role,
      model: normalizeModel(input.model),
      promptSha256: sha256(input.prompt),
      resultSha256: sha256(input.resultText),
      summary: parsed.summary,
      items,
      unknowns: parsed.unknowns,
    },
    2,
  ) as GroundedSubagentOutcome;
}

export function validateSubagentOutcome(input: unknown): SubagentOutcome {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Subagent outcome must be an object");
  }
  const schemaVersion = (input as Record<string, unknown>)["schemaVersion"];
  const sharedKeys = [
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
  ];
  const record = exactRecord(
    input,
    "Subagent outcome",
    schemaVersion === 1
      ? sharedKeys
      : schemaVersion === 2
        ? [...sharedKeys, "evidenceCount", "evidenceSetSha256"]
        : [],
  );
  if (
    record["kind"] !== "napier.subagent-outcome" ||
    (schemaVersion !== 1 && schemaVersion !== 2) ||
    typeof record["taskId"] !== "string" ||
    !RESOURCE_ID.test(record["taskId"]) ||
    typeof record["role"] !== "string" ||
    !ROLES.has(record["role"] as SubagentRole)
  ) {
    throw new Error("Subagent outcome identity is invalid");
  }
  const parsed =
    schemaVersion === 1
      ? parseSubagentResult({
          summary: record["summary"],
          items: record["items"],
          unknowns: record["unknowns"],
        })
      : parseStoredSubagentResult({
          summary: record["summary"],
          items: record["items"],
          unknowns: record["unknowns"],
        });
  const itemCount = nonNegativeInteger(record["itemCount"], "itemCount");
  const unknownCount = nonNegativeInteger(
    record["unknownCount"],
    "unknownCount",
  );
  const evidenceCount =
    schemaVersion === 2
      ? nonNegativeInteger(record["evidenceCount"], "evidenceCount")
      : undefined;
  const promptSha256 = digest(record["promptSha256"], "promptSha256");
  const instructionsSha256 = digest(
    record["instructionsSha256"],
    "instructionsSha256",
  );
  const resultSha256 = digest(record["resultSha256"], "resultSha256");
  const expected = buildSubagentOutcome(
    {
      taskId: record["taskId"],
      role: record["role"] as SubagentRole,
      model: normalizeModel(record["model"]),
      promptSha256,
      resultSha256,
      ...parsed,
    },
    schemaVersion,
  );
  if (
    itemCount !== expected.itemCount ||
    unknownCount !== expected.unknownCount ||
    (schemaVersion === 2 && evidenceCount !== expected.evidenceCount) ||
    instructionsSha256 !== expected.instructionsSha256 ||
    record["itemSetSha256"] !== expected.itemSetSha256 ||
    (schemaVersion === 2 &&
      record["evidenceSetSha256"] !== expected.evidenceSetSha256) ||
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
  return buildSubagentOutcome(
    {
      taskId: binding.taskId,
      role: outcome.role,
      model: outcome.model,
      summary: outcome.summary,
      items: outcome.items,
      unknowns: outcome.unknowns,
      promptSha256: sha256(binding.prompt),
      resultSha256: outcome.resultSha256,
    },
    outcome.schemaVersion,
  );
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

export async function verifySubagentOutcomeEvidence(
  input: unknown,
  workspaceRoot: string,
): Promise<SubagentOutcomeEvidenceVerification> {
  const outcome = validateSubagentOutcome(input);
  if (outcome.schemaVersion === 1) {
    return buildEvidenceVerification(outcome, "unavailable", []);
  }
  const evidence = canonicalEvidence(
    outcome.items.flatMap((item) => item.evidence),
  ).map(requireGroundedVerificationEvidence);
  const items = await Promise.all(
    evidence.map(
      async (expected): Promise<SubagentOutcomeEvidenceVerificationItem> => {
        try {
          const observed = await readWorkspaceTextEvidence(workspaceRoot, {
            path: expected.path,
            ...(expected.lineStart === undefined
              ? {}
              : {
                  lineStart: expected.lineStart,
                  lineEnd: expected.lineEnd,
                }),
          });
          const aligned =
            observed.fileSha256 === expected.fileSha256 &&
            observed.rangeSha256 === expected.rangeSha256;
          return {
            path: expected.path,
            ...(expected.lineStart === undefined
              ? {}
              : {
                  lineStart: expected.lineStart,
                  lineEnd: expected.lineEnd,
                }),
            status: aligned ? "aligned" : "divergent",
            expectedFileSha256: expected.fileSha256,
            observedFileSha256: observed.fileSha256,
            expectedRangeSha256: expected.rangeSha256,
            observedRangeSha256: observed.rangeSha256,
          };
        } catch (error) {
          if (isMissingWorkspaceEvidence(error)) {
            return {
              path: expected.path,
              ...(expected.lineStart === undefined
                ? {}
                : {
                    lineStart: expected.lineStart,
                    lineEnd: expected.lineEnd,
                  }),
              status: "missing",
              expectedFileSha256: expected.fileSha256,
              expectedRangeSha256: expected.rangeSha256,
              diagnosticSha256: evidenceDiagnosticSha256("file_missing"),
            };
          }
          if (expected.lineStart !== undefined) {
            try {
              const observed = await readWorkspaceTextEvidence(workspaceRoot, {
                path: expected.path,
              });
              return {
                path: expected.path,
                lineStart: expected.lineStart,
                lineEnd: expected.lineEnd,
                status: "divergent",
                expectedFileSha256: expected.fileSha256,
                observedFileSha256: observed.fileSha256,
                expectedRangeSha256: expected.rangeSha256,
                diagnosticSha256: evidenceDiagnosticSha256("range_unavailable"),
              };
            } catch (fallbackError) {
              if (isMissingWorkspaceEvidence(fallbackError)) {
                return {
                  path: expected.path,
                  lineStart: expected.lineStart,
                  lineEnd: expected.lineEnd,
                  status: "missing",
                  expectedFileSha256: expected.fileSha256,
                  expectedRangeSha256: expected.rangeSha256,
                  diagnosticSha256: evidenceDiagnosticSha256("file_missing"),
                };
              }
            }
          }
          return {
            path: expected.path,
            ...(expected.lineStart === undefined
              ? {}
              : {
                  lineStart: expected.lineStart,
                  lineEnd: expected.lineEnd,
                }),
            status: "divergent",
            expectedFileSha256: expected.fileSha256,
            expectedRangeSha256: expected.rangeSha256,
            diagnosticSha256: evidenceDiagnosticSha256("evidence_unreadable"),
          };
        }
      },
    ),
  );
  return buildEvidenceVerification(
    outcome,
    items.every((item) => item.status === "aligned") ? "aligned" : "divergent",
    items,
  );
}

function buildEvidenceVerification(
  outcome: SubagentOutcome,
  status: SubagentOutcomeEvidenceVerification["status"],
  items: SubagentOutcomeEvidenceVerificationItem[],
): SubagentOutcomeEvidenceVerification {
  const content = {
    kind: "napier.subagent-outcome-evidence-verification" as const,
    schemaVersion: 1 as const,
    status,
    taskId: outcome.taskId,
    outcomeSha256: outcome.contentSha256,
    evidenceCount: items.length,
    alignedCount: items.filter((item) => item.status === "aligned").length,
    divergentCount: items.filter((item) => item.status === "divergent").length,
    missingCount: items.filter((item) => item.status === "missing").length,
    items,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function requireGroundedVerificationEvidence(
  evidence: SubagentOutcomeEvidence,
): GroundedVerificationEvidence {
  if (!evidence.fileSha256 || !evidence.rangeSha256) {
    throw new Error("Grounded Subagent evidence hashes are missing");
  }
  if (evidence.lineStart === undefined) {
    if (evidence.lineEnd !== undefined) {
      throw new Error("Grounded Subagent evidence line range is incomplete");
    }
    return {
      path: evidence.path,
      fileSha256: evidence.fileSha256,
      rangeSha256: evidence.rangeSha256,
    };
  }
  if (evidence.lineEnd === undefined) {
    throw new Error("Grounded Subagent evidence line range is incomplete");
  }
  return {
    path: evidence.path,
    lineStart: evidence.lineStart,
    lineEnd: evidence.lineEnd,
    fileSha256: evidence.fileSha256,
    rangeSha256: evidence.rangeSha256,
  };
}

function isMissingWorkspaceEvidence(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function evidenceDiagnosticSha256(
  reason: "evidence_unreadable" | "file_missing" | "range_unavailable",
): string {
  return sha256(canonicalJson({ reason }));
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

function parseStoredSubagentResult(input: unknown): StoredSubagentResult {
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
    evidence: canonicalEvidence(
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

function buildSubagentOutcome(
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
