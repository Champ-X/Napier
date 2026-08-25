import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "@napier/runtime/core";

import type {
  UxBenchmarkCase,
  UxBenchmarkExpected,
} from "./ux-benchmark-types.js";

const MAX_CASE_FILE_BYTES = 64 * 1024;
const CASE_KEYS = keySet(
  "kind schemaVersion id title objective promptPath expectedPath timeoutMs maxFirstEventMs maxDurationMs promptSha256 expectedSha256 contentSha256",
);

export interface LoadedUxBenchmarkCase {
  benchmarkCase: UxBenchmarkCase;
  prompt: string;
  expected: UxBenchmarkExpected;
}

export async function loadUxBenchmarkCase(
  caseRoot: string,
): Promise<LoadedUxBenchmarkCase> {
  const root = await realpath(path.resolve(caseRoot));
  const benchmarkCase = validateUxBenchmarkCase(
    await readJsonEntry(root, "manifest.json"),
  );
  const prompt = await readTextEntry(root, benchmarkCase.promptPath);
  const expected = validateUxBenchmarkExpected(
    await readJsonEntry(root, benchmarkCase.expectedPath),
  );
  if (sha256(prompt) !== benchmarkCase.promptSha256) {
    throw new Error("UX benchmark prompt hash mismatch");
  }
  if (sha256(canonicalJson(expected)) !== benchmarkCase.expectedSha256) {
    throw new Error("UX benchmark expected outcome hash mismatch");
  }
  return { benchmarkCase, prompt, expected };
}

export function validateUxBenchmarkCase(value: unknown): UxBenchmarkCase {
  if (
    !exactRecord(value, CASE_KEYS) ||
    value["kind"] !== "napier.ux-benchmark-case" ||
    value["schemaVersion"] !== 1 ||
    !resourceId(value["id"]) ||
    !boundedText(value["title"], 1, 160) ||
    !boundedText(value["objective"], 1, 500) ||
    !safeRelativeFile(value["promptPath"], ".md") ||
    !safeRelativeFile(value["expectedPath"], ".json") ||
    value["promptPath"] === value["expectedPath"] ||
    !integerBetween(value["timeoutMs"], 10_000, 180_000) ||
    !integerBetween(value["maxFirstEventMs"], 1_000, value["timeoutMs"]) ||
    !integerBetween(value["maxDurationMs"], 1_000, value["timeoutMs"]) ||
    !digest(value["promptSha256"]) ||
    !digest(value["expectedSha256"]) ||
    !digest(value["contentSha256"])
  ) {
    throw new Error("UX benchmark case is invalid");
  }
  const benchmarkCase = structuredClone(value) as unknown as UxBenchmarkCase;
  const { contentSha256, ...content } = benchmarkCase;
  if (sha256(canonicalJson(content)) !== contentSha256) {
    throw new Error("UX benchmark case hash mismatch");
  }
  return benchmarkCase;
}

export function validateUxBenchmarkExpected(
  value: unknown,
): UxBenchmarkExpected {
  if (
    !exactRecord(value, [
      "assistantText",
      "manualCommandCount",
      "credentialReferenceCount",
      "threadCountAfter",
    ]) ||
    !boundedText(value["assistantText"], 1, 500) ||
    value["manualCommandCount"] !== 1 ||
    value["credentialReferenceCount"] !== 1 ||
    value["threadCountAfter"] !== 2
  ) {
    throw new Error("UX benchmark expected outcome is invalid");
  }
  return structuredClone(value) as unknown as UxBenchmarkExpected;
}

async function readJsonEntry(root: string, relativePath: string) {
  return JSON.parse(await readTextEntry(root, relativePath)) as unknown;
}

async function readTextEntry(root: string, relativePath: string) {
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
    throw new Error("UX benchmark case entry is unsafe");
  }
  return readFile(filePath, "utf8");
}

function resolveInside(root: string, relativePath: string): string {
  const candidate = path.resolve(root, relativePath);
  if (!inside(root, candidate)) {
    throw new Error("UX benchmark case path escapes its root");
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

function safeRelativeFile(value: unknown, extension: string): boolean {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 160 &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    value
      .split("/")
      .every(
        (segment) =>
          segment !== "." &&
          segment !== ".." &&
          /^[A-Za-z0-9._-]+$/u.test(segment),
      ) &&
    value.endsWith(extension)
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
  return typeof value === "string" && /^[a-z][a-z0-9_]{2,80}$/u.test(value);
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
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function integerBetween(
  value: unknown,
  minimum: number,
  maximum: unknown,
): boolean {
  return (
    Number.isSafeInteger(value) &&
    typeof maximum === "number" &&
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
