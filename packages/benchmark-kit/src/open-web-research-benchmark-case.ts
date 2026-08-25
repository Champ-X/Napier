import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "@napier/runtime";

import type {
  OpenWebResearchBenchmarkCase,
  OpenWebResearchBenchmarkExpected,
} from "./open-web-research-benchmark-types.js";

const MAX_CASE_FILE_BYTES = 64 * 1024;
const CASE_KEYS = keySet(
  "kind schemaVersion id title objective promptPath expectedPath timeoutMs promptSha256 expectedSha256 contentSha256",
);

export interface LoadedOpenWebResearchBenchmarkCase {
  benchmarkCase: OpenWebResearchBenchmarkCase;
  prompt: string;
  expected: OpenWebResearchBenchmarkExpected;
}

export async function loadOpenWebResearchBenchmarkCase(
  caseRoot: string,
): Promise<LoadedOpenWebResearchBenchmarkCase> {
  const root = await realpath(path.resolve(caseRoot));
  const benchmarkCase = validateCase(
    await readJsonEntry(root, "manifest.json"),
  );
  const prompt = await readTextEntry(root, benchmarkCase.promptPath);
  const expected = validateExpected(
    await readJsonEntry(root, benchmarkCase.expectedPath),
    benchmarkCase.schemaVersion,
  );
  if (sha256(prompt) !== benchmarkCase.promptSha256) {
    throw new Error("Open-web Research benchmark prompt hash mismatch");
  }
  if (sha256(canonicalJson(expected)) !== benchmarkCase.expectedSha256) {
    throw new Error("Open-web Research benchmark expected hash mismatch");
  }
  return { benchmarkCase, prompt, expected };
}

export function validateOpenWebResearchBenchmarkExpected(
  value: unknown,
): OpenWebResearchBenchmarkExpected {
  return validateExpected(value, 1);
}

function validateCase(value: unknown): OpenWebResearchBenchmarkCase {
  if (
    !exactRecord(value, CASE_KEYS) ||
    value["kind"] !== "napier.open-web-research-benchmark-case" ||
    (value["schemaVersion"] !== 1 && value["schemaVersion"] !== 2) ||
    !resourceId(value["id"]) ||
    !boundedText(value["title"], 1, 160) ||
    !boundedText(value["objective"], 1, 500) ||
    !safeRelativeFile(value["promptPath"], ".md") ||
    !safeRelativeFile(value["expectedPath"], ".json") ||
    value["promptPath"] === value["expectedPath"] ||
    !integerBetween(value["timeoutMs"], 10_000, 300_000) ||
    !digest(value["promptSha256"]) ||
    !digest(value["expectedSha256"]) ||
    !digest(value["contentSha256"])
  ) {
    throw new Error("Open-web Research benchmark case is invalid");
  }
  const benchmarkCase = structuredClone(
    value,
  ) as unknown as OpenWebResearchBenchmarkCase;
  const { contentSha256, ...content } = benchmarkCase;
  if (sha256(canonicalJson(content)) !== contentSha256) {
    throw new Error("Open-web Research benchmark case hash mismatch");
  }
  return benchmarkCase;
}

function validateExpected(
  value: unknown,
  schemaVersion: OpenWebResearchBenchmarkCase["schemaVersion"],
): OpenWebResearchBenchmarkExpected {
  const expectedKeys =
    schemaVersion === 2
      ? [
          "claims",
          "expectedUrls",
          "citations",
          "requiredToolCounts",
          "security",
        ]
      : ["claims", "expectedUrls", "citations", "requiredToolCounts"];
  if (
    !exactRecord(value, expectedKeys) ||
    !Array.isArray(value["claims"]) ||
    value["claims"].length < 1 ||
    value["claims"].length > 8 ||
    !value["claims"].every((claim) => boundedText(claim, 1, 500)) ||
    new Set(value["claims"]).size !== value["claims"].length ||
    !validExpectedUrls(value["expectedUrls"], value["claims"].length) ||
    !validCitations(
      value["citations"],
      value["claims"],
      value["expectedUrls"],
    ) ||
    !validToolCounts(value["requiredToolCounts"]) ||
    (schemaVersion === 2
      ? !validSecurity(value["security"], value["claims"])
      : value["security"] !== undefined)
  ) {
    throw new Error("Open-web Research benchmark expected outcome is invalid");
  }
  return structuredClone(value) as unknown as OpenWebResearchBenchmarkExpected;
}

function validExpectedUrls(value: unknown, expectedCount: number): boolean {
  return (
    Array.isArray(value) &&
    value.length === expectedCount &&
    value.every(
      (source) =>
        exactRecord(
          source,
          source["sourceKind"] === "web_fetch"
            ? ["url", "sourceKind", "format"]
            : ["url", "sourceKind"],
        ) &&
        validPublicUrl(source["url"]) &&
        (source["sourceKind"] === "web_fetch" ||
          source["sourceKind"] === "browser") &&
        (source["sourceKind"] !== "web_fetch" ||
          source["format"] === "html" ||
          source["format"] === "markdown" ||
          source["format"] === "json" ||
          source["format"] === "text" ||
          source["format"] === "pdf"),
    ) &&
    new Set(value.map((source) => source.url)).size === expectedCount
  );
}

function validCitations(
  value: unknown,
  claims: unknown[],
  sources: unknown,
): boolean {
  if (
    !Array.isArray(value) ||
    value.length !== claims.length ||
    !Array.isArray(sources)
  ) {
    return false;
  }
  const sourceByUrl = new Map(
    sources.map((source) => [
      (source as { url: string }).url,
      source as { sourceKind: "web_fetch" | "browser" },
    ]),
  );
  return (
    value.every((citation) => {
      if (
        !exactRecord(citation, [
          "claim",
          "sourceUrl",
          "sourceKind",
          "quotes",
        ]) ||
        !claims.includes(citation["claim"]) ||
        !Array.isArray(citation["quotes"]) ||
        citation["quotes"].length < 1 ||
        citation["quotes"].length > 4 ||
        !citation["quotes"].every((quote) => boundedText(quote, 1, 2_000)) ||
        new Set(citation["quotes"]).size !== citation["quotes"].length
      ) {
        return false;
      }
      const source = sourceByUrl.get(String(citation["sourceUrl"]));
      return source?.sourceKind === citation["sourceKind"];
    }) &&
    new Set(value.map((citation) => citation.claim)).size === claims.length
  );
}

function validToolCounts(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length >= 3 &&
    value.length <= 16 &&
    value.every(
      (entry) =>
        exactRecord(entry, ["toolAction", "minimum", "maximum"]) &&
        typeof entry["toolAction"] === "string" &&
        /^[a-z_]+:[a-z_]+$/u.test(entry["toolAction"]) &&
        integerBetween(entry["minimum"], 0, 16) &&
        integerBetween(entry["maximum"], 1, 32) &&
        Number(entry["minimum"]) <= Number(entry["maximum"]),
    ) &&
    new Set(value.map((entry) => entry.toolAction)).size === value.length
  );
}

function validSecurity(value: unknown, claims: unknown[]): boolean {
  if (
    !exactRecord(value, [
      "forbiddenOutputStrings",
      "forbiddenToolActions",
      "requireExactFinalResponse",
    ])
  ) {
    return false;
  }
  const forbiddenOutputStrings = value["forbiddenOutputStrings"];
  const forbiddenToolActions = value["forbiddenToolActions"];
  return (
    Array.isArray(forbiddenOutputStrings) &&
    forbiddenOutputStrings.length >= 1 &&
    forbiddenOutputStrings.length <= 8 &&
    forbiddenOutputStrings.every((entry) => boundedText(entry, 1, 500)) &&
    new Set(forbiddenOutputStrings).size === forbiddenOutputStrings.length &&
    forbiddenOutputStrings.every((entry) =>
      claims.every(
        (claim) => typeof claim === "string" && !claim.includes(entry),
      ),
    ) &&
    Array.isArray(forbiddenToolActions) &&
    forbiddenToolActions.length >= 1 &&
    forbiddenToolActions.length <= 16 &&
    forbiddenToolActions.every(
      (entry) =>
        typeof entry === "string" && /^[a-z_]+:(?:[a-z_]+|\*)$/u.test(entry),
    ) &&
    new Set(forbiddenToolActions).size === forbiddenToolActions.length &&
    value["requireExactFinalResponse"] === true
  );
}

async function readJsonEntry(root: string, relative: string): Promise<unknown> {
  return JSON.parse(await readTextEntry(root, relative)) as unknown;
}

async function readTextEntry(root: string, relative: string): Promise<string> {
  if (!safeRelativeFile(relative, path.extname(relative))) {
    throw new Error("Open-web Research benchmark path is invalid");
  }
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Open-web Research benchmark path escapes case root");
  }
  const info = await lstat(target);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > MAX_CASE_FILE_BYTES
  ) {
    throw new Error("Open-web Research benchmark file is invalid");
  }
  return readFile(target, "utf8");
}

function safeRelativeFile(value: unknown, extension: string): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 200 &&
    !path.isAbsolute(value) &&
    path.extname(value).toLowerCase() === extension &&
    !value.split(/[\\/]/u).includes("..")
  );
}

function validPublicUrl(value: unknown): boolean {
  try {
    const url = new URL(String(value));
    return (
      url.protocol === "https:" && !url.username && !url.password && !url.hash
    );
  } catch {
    return false;
  }
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    record(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedText(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)
  );
}

function resourceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{2,80}$/u.test(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
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

function keySet(value: string): readonly string[] {
  return value.split(" ");
}
