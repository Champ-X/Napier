import { canonicalJson, sha256 } from "./ed25519.js";
import {
  type ResearchSourceCitationRecord,
  type ResearchSourceEvidenceRecord,
  researchRunCounts,
} from "./research-source-evidence.js";
import {
  validateBrowserResearchSourceCapture,
  validateResearchWebFetchCapture,
} from "./research-source-capture.js";
import type {
  BrowserResearchCapture,
  ResearchSourceCapture,
  WebFetchResearchSourceCapture,
} from "./research-source-model.js";
import type { ResearchSourceCapsuleReceipt } from "./research-source-capsule-model.js";

export type { ResearchSourceCapsuleReceipt } from "./research-source-capsule-model.js";

export const MAX_RESEARCH_SOURCE_CAPSULE_BYTES = 2 * 1024 * 1024;

const HASH = /^[a-f0-9]{64}$/u;
const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;
const SOURCE_ID = /^source_[a-z0-9]{8,80}$/u;
const CITATION_ID = /^citation_[a-z0-9]{8,80}$/u;
const MAX_SOURCE_CHARS = 24_000;

export interface ResearchSourceCapsule {
  kind: "napier.research-source-capsule";
  schemaVersion: 1;
  sourceThreadId: string;
  sourceRunId: string;
  sources: ResearchSourceEvidenceRecord[];
  citations: ResearchSourceCitationRecord[];
  sourceSetSha256: string;
  contentSha256: string;
}

export function createResearchSourceCapsule(input: {
  sourceThreadId: string;
  sourceRunId: string;
  sources: Iterable<ResearchSourceEvidenceRecord>;
  citations: readonly ResearchSourceCitationRecord[];
}): ResearchSourceCapsule {
  const sources = [...input.sources].map((source) => structuredClone(source));
  const citations = input.citations.map((citation) =>
    structuredClone(citation),
  );
  const counts = researchRunCounts(sources, citations.length);
  const content = {
    kind: "napier.research-source-capsule" as const,
    schemaVersion: 1 as const,
    sourceThreadId: input.sourceThreadId,
    sourceRunId: input.sourceRunId,
    sources,
    citations,
    sourceSetSha256: counts.sourceSetSha256,
  };
  return validateResearchSourceCapsule({
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  });
}

export function validateResearchSourceCapsule(
  input: unknown,
): ResearchSourceCapsule {
  const value = record(input, "Research Source capsule");
  exactKeys(value, [
    "kind",
    "schemaVersion",
    "sourceThreadId",
    "sourceRunId",
    "sources",
    "citations",
    "sourceSetSha256",
    "contentSha256",
  ]);
  if (
    value["kind"] !== "napier.research-source-capsule" ||
    value["schemaVersion"] !== 1 ||
    typeof value["sourceThreadId"] !== "string" ||
    !THREAD_ID.test(value["sourceThreadId"]) ||
    typeof value["sourceRunId"] !== "string" ||
    !RUN_ID.test(value["sourceRunId"]) ||
    !Array.isArray(value["sources"]) ||
    value["sources"].length > 16 ||
    !Array.isArray(value["citations"]) ||
    value["citations"].length > 64 ||
    !HASH.test(String(value["sourceSetSha256"])) ||
    !HASH.test(String(value["contentSha256"]))
  ) {
    throw new Error("Research Source capsule is invalid");
  }
  const sources = value["sources"].map(validateSource);
  const sourceIds = new Set(sources.map((source) => source.id));
  if (sourceIds.size !== sources.length) {
    throw new Error("Research Source capsule Source IDs are invalid");
  }
  const citations = value["citations"].map((citation) =>
    validateCitation(
      citation,
      new Map(sources.map((source) => [source.id, source])),
    ),
  );
  if (
    new Set(citations.map((citation) => citation.id)).size !== citations.length
  ) {
    throw new Error("Research Source capsule citation IDs are invalid");
  }
  const counts = researchRunCounts(sources, citations.length);
  const content = {
    kind: "napier.research-source-capsule" as const,
    schemaVersion: 1 as const,
    sourceThreadId: value["sourceThreadId"],
    sourceRunId: value["sourceRunId"],
    sources,
    citations,
    sourceSetSha256: value["sourceSetSha256"],
  };
  if (
    counts.sourceSetSha256 !== content.sourceSetSha256 ||
    sha256(canonicalJson(content)) !== value["contentSha256"]
  ) {
    throw new Error("Research Source capsule binding is invalid");
  }
  return { ...content, contentSha256: value["contentSha256"] };
}

export function createResearchSourceCapsuleReceipt(
  capsule: ResearchSourceCapsule,
  capsuleBytes = Buffer.byteLength(canonicalJson(capsule), "utf8"),
): ResearchSourceCapsuleReceipt {
  const content = {
    kind: "napier.research-source-capsule-receipt" as const,
    schemaVersion: 1 as const,
    sourceRunId: capsule.sourceRunId,
    sourceCount: capsule.sources.length,
    citationCount: capsule.citations.length,
    sourceSetSha256: capsule.sourceSetSha256,
    capsuleSha256: capsule.contentSha256,
    capsuleBytes,
    storage: "local_only" as const,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function validateResearchSourceCapsuleReceipt(
  input: unknown,
): ResearchSourceCapsuleReceipt {
  const value = record(input, "Research Source capsule receipt");
  exactKeys(value, [
    "kind",
    "schemaVersion",
    "sourceRunId",
    "sourceCount",
    "citationCount",
    "sourceSetSha256",
    "capsuleSha256",
    "capsuleBytes",
    "storage",
    "contentSha256",
  ]);
  if (
    value["kind"] !== "napier.research-source-capsule-receipt" ||
    value["schemaVersion"] !== 1 ||
    typeof value["sourceRunId"] !== "string" ||
    !RUN_ID.test(value["sourceRunId"]) ||
    !integerBetween(value["sourceCount"], 0, 16) ||
    !integerBetween(value["citationCount"], 0, 64) ||
    !HASH.test(String(value["sourceSetSha256"])) ||
    !HASH.test(String(value["capsuleSha256"])) ||
    !integerBetween(
      value["capsuleBytes"],
      1,
      MAX_RESEARCH_SOURCE_CAPSULE_BYTES,
    ) ||
    value["storage"] !== "local_only" ||
    !HASH.test(String(value["contentSha256"]))
  ) {
    throw new Error("Research Source capsule receipt is invalid");
  }
  const content = {
    kind: "napier.research-source-capsule-receipt" as const,
    schemaVersion: 1 as const,
    sourceRunId: value["sourceRunId"],
    sourceCount: Number(value["sourceCount"]),
    citationCount: Number(value["citationCount"]),
    sourceSetSha256: value["sourceSetSha256"],
    capsuleSha256: value["capsuleSha256"],
    capsuleBytes: Number(value["capsuleBytes"]),
    storage: "local_only" as const,
  };
  if (sha256(canonicalJson(content)) !== value["contentSha256"]) {
    throw new Error("Research Source capsule receipt hash is invalid");
  }
  return { ...content, contentSha256: value["contentSha256"] };
}

function validateSource(input: unknown): ResearchSourceEvidenceRecord {
  const value = record(input, "Research Source capsule Source");
  exactKeys(value, ["id", "capture", "origin", "textSha256"]);
  const capture = structuredClone(value["capture"]) as ResearchSourceCapture;
  const captureRecord = record(capture, "Research Source capsule capture");
  if (
    captureRecord["kind"] !== "browser" &&
    captureRecord["kind"] !== "web_fetch"
  ) {
    throw new Error("Research Source capsule capture kind is invalid");
  }
  const url =
    captureRecord["kind"] === "browser"
      ? validateBrowserResearchSourceCapture(
          capture as BrowserResearchCapture,
          MAX_SOURCE_CHARS,
        )
      : validateResearchWebFetchCapture(
          capture as WebFetchResearchSourceCapture,
          MAX_SOURCE_CHARS,
        );
  if (
    typeof value["id"] !== "string" ||
    !SOURCE_ID.test(value["id"]) ||
    value["origin"] !== url.origin ||
    !HASH.test(String(value["textSha256"])) ||
    sha256(capture.lines.join("\n")) !== value["textSha256"]
  ) {
    throw new Error("Research Source capsule Source is invalid");
  }
  return {
    id: value["id"],
    capture,
    origin: value["origin"],
    textSha256: value["textSha256"],
  };
}

function validateCitation(
  input: unknown,
  sources: ReadonlyMap<string, ResearchSourceEvidenceRecord>,
): ResearchSourceCitationRecord {
  const value = record(input, "Research Source capsule citation");
  exactKeys(value, [
    "id",
    "sourceId",
    "startLine",
    "endLine",
    "claim",
    "quoteSha256",
    "claimSha256",
    "token",
  ]);
  const source = sources.get(String(value["sourceId"]));
  const claim = typeof value["claim"] === "string" ? value["claim"] : "";
  if (
    typeof value["id"] !== "string" ||
    !CITATION_ID.test(value["id"]) ||
    !source ||
    !integerBetween(value["startLine"], 1, source.capture.lines.length) ||
    !integerBetween(
      value["endLine"],
      Number(value["startLine"]),
      source.capture.lines.length,
    ) ||
    Number(value["endLine"]) - Number(value["startLine"]) + 1 > 40 ||
    !claim.trim() ||
    claim !== claim.trim() ||
    claim.length > 1_000 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(claim) ||
    !HASH.test(String(value["quoteSha256"])) ||
    !HASH.test(String(value["claimSha256"])) ||
    value["token"] !== `[citation:${value["id"]}]`
  ) {
    throw new Error("Research Source capsule citation is invalid");
  }
  const quote = source.capture.lines
    .slice(Number(value["startLine"]) - 1, Number(value["endLine"]))
    .join("\n");
  if (
    sha256(quote) !== value["quoteSha256"] ||
    sha256(claim) !== value["claimSha256"]
  ) {
    throw new Error("Research Source capsule citation binding is invalid");
  }
  return {
    id: value["id"],
    sourceId: source.id,
    startLine: Number(value["startLine"]),
    endLine: Number(value["endLine"]),
    claim,
    quoteSha256: value["quoteSha256"],
    claimSha256: value["claimSha256"],
    token: value["token"],
  };
}

function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  if (
    canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())
  ) {
    throw new Error("Research Source capsule has unsupported fields");
  }
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

function record(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, any>;
}
