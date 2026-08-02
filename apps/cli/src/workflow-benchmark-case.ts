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
const CASE_KEYS = keySet(
  "kind schemaVersion id title objective inputPath expectedPath timeoutMs inputSha256 expectedSha256 contentSha256",
);

export interface LoadedWorkflowBenchmarkCase {
  benchmarkCase: WorkflowBenchmarkCase;
  input: WorkflowBenchmarkInput;
  expected: WorkflowBenchmarkExpected;
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
  return { benchmarkCase: manifest, input, expected };
}

export function validateWorkflowBenchmarkCase(
  input: unknown,
): WorkflowBenchmarkCase {
  if (
    !exactRecord(input, CASE_KEYS) ||
    input["kind"] !== "napier.workflow-benchmark-case" ||
    input["schemaVersion"] !== 1 ||
    !resourceId(input["id"]) ||
    !boundedText(input["title"], 1, 160) ||
    !boundedText(input["objective"], 1, 500) ||
    !safeRelativeFile(input["inputPath"]) ||
    !safeRelativeFile(input["expectedPath"]) ||
    input["inputPath"] === input["expectedPath"] ||
    !integerBetween(input["timeoutMs"], 10_000, 180_000) ||
    !digest(input["inputSha256"]) ||
    !digest(input["expectedSha256"]) ||
    !digest(input["contentSha256"])
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
    value.split("/").every((segment) => /^[A-Za-z0-9._-]+$/u.test(segment))
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
