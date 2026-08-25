import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "@napier/runtime";

import type {
  ResearchBenchmarkCase,
  ResearchBenchmarkExpected,
  ResearchBenchmarkSources,
} from "./research-benchmark-types.js";

const MAX_CASE_FILE_BYTES = 64 * 1024;
const CASE_KEYS = keySet(
  "kind schemaVersion id title objective promptPath sourcesPath expectedPath reportPath timeoutMs promptSha256 sourcesSha256 expectedSha256 contentSha256",
);
const CAPTURE_KEYS = keySet(
  "url title lines textChars truncated capturedContentSha256 sessionOperation sessionIdSha256 activeTabId tabCount tabSetSha256 browserExecutableSha256 browserVersionSha256 limitsSha256 network",
);
const NETWORK_KEYS = keySet(
  "requestCount connectCount rejectedCount transferredBytes destinationCount destinationsSha256",
);

export interface LoadedResearchBenchmarkCase {
  benchmarkCase: ResearchBenchmarkCase;
  prompt: string;
  sources: ResearchBenchmarkSources;
  expected: ResearchBenchmarkExpected;
}

export async function loadResearchBenchmarkCase(
  caseRoot: string,
): Promise<LoadedResearchBenchmarkCase> {
  const root = await realpath(path.resolve(caseRoot));
  const benchmarkCase = validateResearchBenchmarkCase(
    await readJsonEntry(root, "manifest.json"),
  );
  const prompt = await readTextEntry(root, benchmarkCase.promptPath);
  const sources = validateResearchBenchmarkSources(
    await readJsonEntry(root, benchmarkCase.sourcesPath),
  );
  const expected = validateResearchBenchmarkExpected(
    await readJsonEntry(root, benchmarkCase.expectedPath),
    sources,
  );
  if (sha256(prompt) !== benchmarkCase.promptSha256) {
    throw new Error("Research benchmark prompt hash mismatch");
  }
  if (sha256(canonicalJson(sources)) !== benchmarkCase.sourcesSha256) {
    throw new Error("Research benchmark sources hash mismatch");
  }
  if (sha256(canonicalJson(expected)) !== benchmarkCase.expectedSha256) {
    throw new Error("Research benchmark expected outcome hash mismatch");
  }
  return { benchmarkCase, prompt, sources, expected };
}

export function validateResearchBenchmarkCase(
  value: unknown,
): ResearchBenchmarkCase {
  if (
    !exactRecord(value, CASE_KEYS) ||
    value["kind"] !== "napier.research-benchmark-case" ||
    value["schemaVersion"] !== 1 ||
    !resourceId(value["id"]) ||
    !boundedText(value["title"], 1, 160) ||
    !boundedText(value["objective"], 1, 500) ||
    !safeRelativeFile(value["promptPath"], [".md"]) ||
    !safeRelativeFile(value["sourcesPath"], [".json"]) ||
    !safeRelativeFile(value["expectedPath"], [".json"]) ||
    !safeRelativeFile(value["reportPath"], [".md", ".markdown"]) ||
    new Set([value["promptPath"], value["sourcesPath"], value["expectedPath"]])
      .size !== 3 ||
    !integerBetween(value["timeoutMs"], 10_000, 180_000) ||
    !digest(value["promptSha256"]) ||
    !digest(value["sourcesSha256"]) ||
    !digest(value["expectedSha256"]) ||
    !digest(value["contentSha256"])
  ) {
    throw new Error("Research benchmark case is invalid");
  }
  const benchmarkCase = structuredClone(
    value,
  ) as unknown as ResearchBenchmarkCase;
  const { contentSha256, ...content } = benchmarkCase;
  if (sha256(canonicalJson(content)) !== contentSha256) {
    throw new Error("Research benchmark case hash mismatch");
  }
  return benchmarkCase;
}

export function validateResearchBenchmarkSources(
  value: unknown,
): ResearchBenchmarkSources {
  if (
    !exactRecord(value, ["sources"]) ||
    !Array.isArray(value["sources"]) ||
    value["sources"].length !== 3
  ) {
    throw new Error("Research benchmark sources are invalid");
  }
  const sources = value["sources"].map((source) => {
    if (
      !exactRecord(source, ["id", "authority", "capture"]) ||
      !resourceId(source["id"]) ||
      (source["authority"] !== "primary" && source["authority"] !== "secondary")
    ) {
      throw new Error("Research benchmark source is invalid");
    }
    return {
      id: source["id"],
      authority: source["authority"] as "primary" | "secondary",
      capture: validateCapture(source["capture"]),
    };
  });
  if (
    new Set(sources.map((source) => source.id)).size !== sources.length ||
    sources.filter((source) => source.authority === "primary").length !== 2 ||
    sources.filter((source) => source.authority === "secondary").length !== 1
  ) {
    throw new Error("Research benchmark source authority set is invalid");
  }
  return { sources };
}

export function validateResearchBenchmarkExpected(
  value: unknown,
  sources: ResearchBenchmarkSources,
): ResearchBenchmarkExpected {
  if (
    !exactRecord(value, [
      "claims",
      "requiredCitations",
      "requiredCaptureCount",
      "requiredCitationCount",
      "requiredPrimarySourceCount",
      "requiredSecondarySourceCount",
      "contradictionRequired",
    ]) ||
    !Array.isArray(value["claims"]) ||
    value["claims"].length !== 3 ||
    !value["claims"].every((claim) => boundedText(claim, 1, 500)) ||
    new Set(value["claims"]).size !== value["claims"].length ||
    !validRequiredCitations(
      value["requiredCitations"],
      value["claims"],
      sources,
    ) ||
    value["requiredCaptureCount"] !== sources.sources.length ||
    value["requiredCitationCount"] !== 7 ||
    value["requiredPrimarySourceCount"] !== 2 ||
    value["requiredSecondarySourceCount"] !== 1 ||
    value["contradictionRequired"] !== true
  ) {
    throw new Error("Research benchmark expected outcome is invalid");
  }
  return structuredClone(value) as unknown as ResearchBenchmarkExpected;
}

function validateCapture(value: unknown) {
  if (!exactRecord(value, CAPTURE_KEYS)) {
    throw new Error("Research benchmark capture is invalid");
  }
  const network = value["network"];
  if (
    !Array.isArray(value["lines"]) ||
    value["lines"].length < 2 ||
    value["lines"].length > 400 ||
    !value["lines"].every((line) => boundedText(line, 1, 1_000)) ||
    typeof value["url"] !== "string" ||
    !value["url"].startsWith("https://") ||
    !boundedText(value["title"], 1, 500) ||
    value["textChars"] !== value["lines"].join("\n").length ||
    value["truncated"] !== false ||
    !digest(value["capturedContentSha256"]) ||
    !validCaptureBinding(value) ||
    !validCaptureNetwork(network)
  ) {
    throw new Error("Research benchmark capture is invalid");
  }
  const content = {
    url: value["url"],
    title: value["title"],
    lines: value["lines"],
    truncated: value["truncated"],
  };
  if (sha256(canonicalJson(content)) !== value["capturedContentSha256"]) {
    throw new Error("Research benchmark capture hash mismatch");
  }
  return structuredClone(
    value,
  ) as unknown as ResearchBenchmarkSources["sources"][number]["capture"];
}

function validCaptureBinding(value: Record<string, unknown>): boolean {
  return (
    nonNegativeInteger(value["sessionOperation"]) &&
    digest(value["sessionIdSha256"]) &&
    tabId(value["activeTabId"]) &&
    integerBetween(value["tabCount"], 1, 4) &&
    digest(value["tabSetSha256"]) &&
    digest(value["browserExecutableSha256"]) &&
    digest(value["browserVersionSha256"]) &&
    digest(value["limitsSha256"])
  );
}

function validCaptureNetwork(value: unknown): boolean {
  return (
    exactRecord(value, NETWORK_KEYS) &&
    nonNegativeInteger(value["requestCount"]) &&
    nonNegativeInteger(value["connectCount"]) &&
    nonNegativeInteger(value["rejectedCount"]) &&
    nonNegativeInteger(value["transferredBytes"]) &&
    nonNegativeInteger(value["destinationCount"]) &&
    digest(value["destinationsSha256"])
  );
}

function tabId(value: unknown): value is string {
  return typeof value === "string" && /^tab_[1-9][0-9]{0,3}$/u.test(value);
}

function validRequiredCitations(
  value: unknown,
  claims: unknown[],
  sources: ResearchBenchmarkSources,
): boolean {
  if (!Array.isArray(value) || value.length !== 7) return false;
  const sourceById = new Map(
    sources.sources.map((source) => [source.id, source]),
  );
  const identities = new Set<string>();
  const claimIndexes = new Set<number>();
  const sourceIds = new Set<string>();
  for (const citation of value) {
    if (
      !exactRecord(citation, [
        "claimIndex",
        "sourceId",
        "startLine",
        "endLine",
      ]) ||
      !integerBetween(citation["claimIndex"], 0, claims.length - 1) ||
      typeof citation["sourceId"] !== "string" ||
      !positiveInteger(citation["startLine"]) ||
      !positiveInteger(citation["endLine"])
    ) {
      return false;
    }
    const source = sourceById.get(citation["sourceId"]);
    if (
      !source ||
      Number(citation["startLine"]) > Number(citation["endLine"]) ||
      Number(citation["endLine"]) > source.capture.lines.length
    ) {
      return false;
    }
    const identity = [
      citation["claimIndex"],
      citation["sourceId"],
      citation["startLine"],
      citation["endLine"],
    ].join(":");
    if (identities.has(identity)) return false;
    identities.add(identity);
    claimIndexes.add(Number(citation["claimIndex"]));
    sourceIds.add(citation["sourceId"]);
  }
  return (
    claimIndexes.size === claims.length &&
    sourceIds.size === sources.sources.length
  );
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
    throw new Error("Research benchmark case entry is unsafe");
  }
  return readFile(filePath, "utf8");
}

function resolveInside(root: string, relativePath: string): string {
  const candidate = path.resolve(root, relativePath);
  if (!inside(root, candidate)) {
    throw new Error("Research benchmark case path escapes its root");
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

function safeRelativeFile(value: unknown, extensions: string[]): boolean {
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
    extensions.some((extension) => value.endsWith(extension))
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
  maximum: number,
): boolean {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
  );
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function keySet(value: string): readonly string[] {
  return value.split(" ");
}
