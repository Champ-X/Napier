import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "@napier/runtime";

import type {
  WorkflowBenchmarkCase,
  WorkflowBenchmarkExpected,
  WorkflowBenchmarkInput,
} from "./workflow-benchmark-types.js";

const MAX_CASE_FILE_BYTES = 64 * 1024;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/u;
const DOCUMENT_ID = /^[a-z][a-z0-9_]{2,40}$/u;
const ASCII_TEXT = /^[\x20-\x7e]{1,200}$/u;
const CASE_KEYS_V1 = keySet(
  "kind schemaVersion id title objective inputPath expectedPath timeoutMs inputSha256 expectedSha256 contentSha256",
);
const CASE_KEYS_V2 = keySet(
  "kind schemaVersion id title objective inputPath expectedPath timeoutMs inputSha256 expectedSha256 scenario setupSqlPath setupSqlSha256 databasePath requiredSqliteActions contentSha256",
);
const CASE_KEYS_V3 = keySet(
  "kind schemaVersion id title objective inputPath expectedPath timeoutMs inputSha256 expectedSha256 scenario setupSqlPath setupSqlSha256 databasePath requiredSqliteActions requiredSqliteEvidence forbiddenOutputStrings contentSha256",
);
const CASE_KEYS_V4 = keySet(
  "kind schemaVersion id title objective inputPath expectedPath timeoutMs inputSha256 expectedSha256 scenario requiredRestartCount approvalCustomText contentSha256",
);
const CASE_KEYS_V5 = keySet(
  "kind schemaVersion id title objective inputPath expectedPath timeoutMs inputSha256 expectedSha256 scenario sourceDataPath sourceDataSha256 workspaceDataPath requiredDataFrameActions requiredDataFrameEvidence forbiddenOutputStrings contentSha256",
);
const CASE_KEYS_V6 = CASE_KEYS_V4;
const CASE_KEYS_V7 = keySet(
  "kind schemaVersion id title objective inputPath expectedPath timeoutMs inputSha256 expectedSha256 scenario requiredRestartCount requiredOfflineWaitMs approvalCustomText contentSha256",
);
const CASE_KEYS_V8 = keySet(
  "kind schemaVersion id title objective inputPath expectedPath timeoutMs inputSha256 expectedSha256 scenario runTokenLimit requiredBudgetReason requiredBudgetExhaustedRunCount contentSha256",
);

export interface LoadedWorkflowBenchmarkCase {
  benchmarkCase: WorkflowBenchmarkCase;
  input: WorkflowBenchmarkInput;
  expected: WorkflowBenchmarkExpected;
  setupSqlSource?: string;
  sourceData?: string;
}

export async function loadWorkflowBenchmarkCase(
  caseRoot: string,
): Promise<LoadedWorkflowBenchmarkCase> {
  const root = await realpath(path.resolve(caseRoot));
  const manifest = validateWorkflowBenchmarkCase(
    await readJsonFile(path.join(root, "manifest.json"), root),
  );
  const input = validateWorkflowBenchmarkInput(
    await readJsonFile(resolveInside(root, manifest.inputPath), root),
  );
  const expected = validateWorkflowBenchmarkExpected(
    await readJsonFile(resolveInside(root, manifest.expectedPath), root),
    input,
  );
  if (sha256(canonicalJson(input)) !== manifest.inputSha256) {
    throw new Error("Workflow benchmark input hash mismatch");
  }
  if (sha256(canonicalJson(expected)) !== manifest.expectedSha256) {
    throw new Error("Workflow benchmark expected outcome hash mismatch");
  }
  const setupSqlSource =
    manifest.schemaVersion === 2 || manifest.schemaVersion === 3
      ? await readTextCaseEntry(root, manifest.setupSqlPath)
      : undefined;
  if (
    (manifest.schemaVersion === 2 || manifest.schemaVersion === 3) &&
    sha256(setupSqlSource ?? "") !== manifest.setupSqlSha256
  ) {
    throw new Error("Workflow benchmark setup SQL hash mismatch");
  }
  if (
    manifest.schemaVersion === 3 &&
    (manifest.requiredSqliteEvidence.length !== input.documents.length ||
      manifest.forbiddenOutputStrings.length !== input.documents.length ||
      manifest.forbiddenOutputStrings.some(
        (canary) => !setupSqlSource?.includes(canary),
      ))
  ) {
    throw new Error("Workflow benchmark security case binding is invalid");
  }
  const sourceData =
    manifest.schemaVersion === 5
      ? await readTextCaseEntry(root, manifest.sourceDataPath)
      : undefined;
  if (
    manifest.schemaVersion === 5 &&
    (sha256(sourceData ?? "") !== manifest.sourceDataSha256 ||
      manifest.requiredDataFrameEvidence.length !== input.documents.length ||
      manifest.forbiddenOutputStrings.some(
        (canary) => !sourceData?.includes(canary),
      ))
  ) {
    throw new Error("Workflow benchmark DataFrame case binding is invalid");
  }
  return {
    benchmarkCase: manifest,
    input,
    expected,
    ...(setupSqlSource === undefined ? {} : { setupSqlSource }),
    ...(sourceData === undefined ? {} : { sourceData }),
  };
}

export function validateWorkflowBenchmarkCase(
  input: unknown,
): WorkflowBenchmarkCase {
  const keys = workflowBenchmarkCaseKeys(input);
  if (
    !exactRecord(input, keys) ||
    !validWorkflowBenchmarkCaseBase(input) ||
    !validWorkflowBenchmarkScenarioCase(input)
  ) {
    throw new Error("Workflow benchmark case is invalid");
  }
  const benchmarkCase = structuredClone(
    input,
  ) as unknown as WorkflowBenchmarkCase;
  const { contentSha256, ...content } = benchmarkCase;
  if (sha256(canonicalJson(content)) !== contentSha256) {
    throw new Error("Workflow benchmark case hash mismatch");
  }
  return benchmarkCase;
}

function workflowBenchmarkCaseKeys(input: unknown): readonly string[] {
  const version =
    input !== null && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)["schemaVersion"]
      : undefined;
  return version === 8
    ? CASE_KEYS_V8
    : version === 7
      ? CASE_KEYS_V7
      : version === 6
        ? CASE_KEYS_V6
        : version === 5
          ? CASE_KEYS_V5
          : version === 4
            ? CASE_KEYS_V4
            : version === 3
              ? CASE_KEYS_V3
              : version === 2
                ? CASE_KEYS_V2
                : CASE_KEYS_V1;
}

function validWorkflowBenchmarkCaseBase(
  input: Record<string, unknown>,
): boolean {
  return (
    input["kind"] === "napier.workflow-benchmark-case" &&
    (input["schemaVersion"] === 1 ||
      input["schemaVersion"] === 2 ||
      input["schemaVersion"] === 3 ||
      input["schemaVersion"] === 4 ||
      input["schemaVersion"] === 5 ||
      input["schemaVersion"] === 6 ||
      input["schemaVersion"] === 7 ||
      input["schemaVersion"] === 8) &&
    resourceId(input["id"]) &&
    boundedText(input["title"], 1, 160) &&
    boundedText(input["objective"], 1, 500) &&
    safeRelativeFile(input["inputPath"]) &&
    safeRelativeFile(input["expectedPath"]) &&
    input["inputPath"] !== input["expectedPath"] &&
    integerBetween(input["timeoutMs"], 10_000, 180_000) &&
    digest(input["inputSha256"]) &&
    digest(input["expectedSha256"]) &&
    digest(input["contentSha256"])
  );
}

function validWorkflowBenchmarkScenarioCase(
  input: Record<string, unknown>,
): boolean {
  if (input["schemaVersion"] === 1) return true;
  if (input["schemaVersion"] === 8) {
    return validWorkflowBenchmarkBudgetCase(input);
  }
  if (
    input["schemaVersion"] === 4 ||
    input["schemaVersion"] === 6 ||
    input["schemaVersion"] === 7
  ) {
    return validWorkflowBenchmarkRestartCase(input);
  }
  if (input["schemaVersion"] === 5) {
    return (
      input["scenario"] === "data_frame_metric_map_reduce" &&
      safeRelativeFile(input["sourceDataPath"]) &&
      digest(input["sourceDataSha256"]) &&
      safeRelativeFile(input["workspaceDataPath"]) &&
      canonicalJson(input["requiredDataFrameActions"]) ===
        canonicalJson(["inspect_data", "data_frame"]) &&
      validDataFrameEvidenceExpectations(input["requiredDataFrameEvidence"]) &&
      validForbiddenOutputStrings(input["forbiddenOutputStrings"])
    );
  }
  if (
    !(
      safeRelativeFile(input["setupSqlPath"]) &&
      digest(input["setupSqlSha256"]) &&
      safeRelativeFile(input["databasePath"]) &&
      input["databasePath"].endsWith(".sqlite") &&
      Array.isArray(input["requiredSqliteActions"])
    )
  ) {
    return false;
  }
  if (input["schemaVersion"] === 2) {
    return (
      input["scenario"] === "sqlite_metric_map_reduce" &&
      canonicalJson(input["requiredSqliteActions"]) ===
        canonicalJson(["schema", "query", "chart"])
    );
  }
  return (
    input["scenario"] === "sqlite_prompt_injection_map_reduce" &&
    canonicalJson(input["requiredSqliteActions"]) ===
      canonicalJson(["schema", "query"]) &&
    validSqliteEvidenceExpectations(input["requiredSqliteEvidence"]) &&
    validForbiddenOutputStrings(input["forbiddenOutputStrings"])
  );
}

function validWorkflowBenchmarkBudgetCase(
  input: Record<string, unknown>,
): boolean {
  return (
    input["scenario"] === "workflow_map_token_budget_exhaustion" &&
    input["runTokenLimit"] === 1_000 &&
    input["requiredBudgetReason"] === "tokens" &&
    input["requiredBudgetExhaustedRunCount"] === 1
  );
}

function validWorkflowBenchmarkRestartCase(
  input: Record<string, unknown>,
): boolean {
  const repeated = input["schemaVersion"] === 6;
  const offlineWait = input["schemaVersion"] === 7;
  return (
    input["scenario"] ===
      (offlineWait
        ? "workflow_offline_wait_approval_resume"
        : repeated
          ? "workflow_multi_restart_approval_resume"
          : "workflow_restart_approval_resume") &&
    input["requiredRestartCount"] === (repeated ? 2 : 1) &&
    (!offlineWait ||
      integerBetween(input["requiredOfflineWaitMs"], 250, 30_000)) &&
    typeof input["approvalCustomText"] === "string" &&
    ASCII_TEXT.test(input["approvalCustomText"])
  );
}

function validDataFrameEvidenceExpectations(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.length <= 8 &&
    value.every(
      (expectation) =>
        exactRecord(expectation, ["rowsSha256", "rowCount", "columnCount"]) &&
        digest(expectation["rowsSha256"]) &&
        integerBetween(expectation["rowCount"], 0, 1_000) &&
        integerBetween(expectation["columnCount"], 0, 80),
    ) &&
    new Set(value.map((expectation) => canonicalJson(expectation))).size ===
      value.length
  );
}

function validSqliteEvidenceExpectations(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) {
    return false;
  }
  return (
    value.every(
      (expectation) =>
        exactRecord(expectation, [
          "sqlSha256",
          "parameterSetSha256",
          "rowsSha256",
        ]) &&
        digest(expectation["sqlSha256"]) &&
        digest(expectation["parameterSetSha256"]) &&
        digest(expectation["rowsSha256"]),
    ) &&
    new Set(value.map((expectation) => canonicalJson(expectation))).size ===
      value.length
  );
}

function validForbiddenOutputStrings(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.length <= 8 &&
    value.every(
      (canary) =>
        typeof canary === "string" &&
        /^INJECTION_[A-Z0-9_]{8,80}$/u.test(canary),
    ) &&
    new Set(value).size === value.length
  );
}

export function validateWorkflowBenchmarkInput(
  input: unknown,
): WorkflowBenchmarkInput {
  if (
    !exactRecord(input, ["documents"]) ||
    !Array.isArray(input["documents"]) ||
    input["documents"].length < 2 ||
    input["documents"].length > 8
  ) {
    throw new Error("Workflow benchmark input is invalid");
  }
  const documents = input["documents"].map((document) => {
    if (
      !exactRecord(document, ["id", "text"]) ||
      typeof document["id"] !== "string" ||
      !DOCUMENT_ID.test(document["id"]) ||
      typeof document["text"] !== "string" ||
      !ASCII_TEXT.test(document["text"])
    ) {
      throw new Error("Workflow benchmark document is invalid");
    }
    return { id: document["id"], text: document["text"] };
  });
  if (
    new Set(documents.map((document) => document.id)).size !== documents.length
  ) {
    throw new Error("Workflow benchmark document IDs must be unique");
  }
  return { documents };
}

export function validateWorkflowBenchmarkExpected(
  input: unknown,
  benchmarkInput: WorkflowBenchmarkInput,
): WorkflowBenchmarkExpected {
  if (
    !exactRecord(input, ["mapItems", "output"]) ||
    !Array.isArray(input["mapItems"]) ||
    input["mapItems"].length !== benchmarkInput.documents.length ||
    !Number.isSafeInteger(input["output"])
  ) {
    throw new Error("Workflow benchmark expected outcome is invalid");
  }
  const mapItems = input["mapItems"].map((item, index) => {
    if (
      !exactRecord(item, ["id", "length"]) ||
      item["id"] !== benchmarkInput.documents[index]!.id ||
      !Number.isSafeInteger(item["length"]) ||
      Number(item["length"]) < 1 ||
      Number(item["length"]) > 200
    ) {
      throw new Error("Workflow benchmark expected Map item is invalid");
    }
    return { id: String(item["id"]), length: Number(item["length"]) };
  });
  if (
    Number(input["output"]) !==
    mapItems.reduce((total, item) => total + item.length, 0)
  ) {
    throw new Error("Workflow benchmark expected Reduce output is invalid");
  }
  return { mapItems, output: Number(input["output"]) };
}

async function readJsonFile(filePath: string, root: string): Promise<unknown> {
  const canonical = await realpath(filePath);
  const info = await lstat(filePath);
  if (
    canonical !== filePath ||
    !inside(root, canonical) ||
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > MAX_CASE_FILE_BYTES
  ) {
    throw new Error("Workflow benchmark case entry is unsafe");
  }
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function readTextCaseEntry(
  root: string,
  relativePath: string,
): Promise<string> {
  const filePath = resolveInside(root, relativePath);
  const canonical = await realpath(filePath);
  const info = await lstat(filePath);
  if (
    canonical !== filePath ||
    !inside(root, canonical) ||
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > MAX_CASE_FILE_BYTES
  ) {
    throw new Error("Workflow benchmark case entry is unsafe");
  }
  return readFile(filePath, "utf8");
}

function resolveInside(root: string, relativePath: string): string {
  const candidate = path.resolve(root, relativePath);
  if (!inside(root, candidate)) {
    throw new Error("Workflow benchmark case path escapes its root");
  }
  return candidate;
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function safeRelativeFile(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 120 &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    value
      .split("/")
      .every(
        (segment) =>
          segment !== "." &&
          segment !== ".." &&
          /^[A-Za-z0-9._-]+$/u.test(segment),
      )
  );
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function resourceId(value: unknown): value is string {
  return typeof value === "string" && RESOURCE_ID.test(value);
}

function boundedText(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

function integerBetween(
  value: unknown,
  minimum: number,
  maximum: number,
): boolean {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
  );
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function keySet(value: string): readonly string[] {
  return value.split(" ");
}
