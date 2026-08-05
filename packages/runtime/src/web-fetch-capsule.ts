import { canonicalJson, sha256 } from "./ed25519.js";
import type { WebFetchStateCapsuleReceipt } from "./web-fetch-capsule-model.js";
import {
  MAX_WEB_FETCH_BROWSER_FALLBACKS_PER_RUN,
  MAX_WEB_FETCH_SOURCES_PER_RUN,
  type WebFetchSource,
} from "./web-fetch-model.js";
import { webFetchRunCounts } from "./web-fetch-source-view.js";
import { validateWebFetchSource } from "./web-fetch-source-validation.js";

export { validateWebFetchSource } from "./web-fetch-source-validation.js";

export type { WebFetchStateCapsuleReceipt } from "./web-fetch-capsule-model.js";

export const MAX_WEB_FETCH_SOURCE_CAPSULE_BYTES = 10 * 1024 * 1024;
export const MAX_WEB_FETCH_MANIFEST_CAPSULE_BYTES = 8 * 1024;

const HASH = /^[a-f0-9]{64}$/u;
const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;
const SOURCE_ID = /^websource_[a-z0-9]{8,80}$/u;

export interface WebFetchSourceCapsule {
  kind: "napier.web-fetch-source-capsule";
  schemaVersion: 1;
  source: WebFetchSource;
  contentSha256: string;
}

export interface WebFetchStateManifestCapsule {
  kind: "napier.web-fetch-state-manifest-capsule";
  schemaVersion: 1;
  sourceThreadId: string;
  sourceRunId: string;
  browserFallbackCount: number;
  sources: Array<{
    id: string;
    contentSha256: string;
    capsuleSha256: string;
  }>;
  sourceSetSha256: string;
  contentSha256: string;
}

export function createWebFetchSourceCapsule(
  source: WebFetchSource,
): WebFetchSourceCapsule {
  const normalized = validateWebFetchSource(source);
  const content = {
    kind: "napier.web-fetch-source-capsule" as const,
    schemaVersion: 1 as const,
    source: normalized,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function validateWebFetchSourceCapsule(
  input: unknown,
): WebFetchSourceCapsule {
  const value = exactRecord(input, [
    "kind",
    "schemaVersion",
    "source",
    "contentSha256",
  ]);
  const source = validateWebFetchSource(value["source"]);
  if (
    value["kind"] !== "napier.web-fetch-source-capsule" ||
    value["schemaVersion"] !== 1 ||
    !hash(value["contentSha256"])
  ) {
    throw new Error("Web Fetch Source capsule is invalid");
  }
  const content = {
    kind: "napier.web-fetch-source-capsule" as const,
    schemaVersion: 1 as const,
    source,
  };
  if (sha256(canonicalJson(content)) !== value["contentSha256"]) {
    throw new Error("Web Fetch Source capsule binding is invalid");
  }
  return { ...content, contentSha256: value["contentSha256"] };
}

export function createWebFetchStateManifestCapsule(input: {
  sourceThreadId: string;
  sourceRunId: string;
  browserFallbackCount: number;
  sources: Iterable<{ source: WebFetchSource; capsuleSha256: string }>;
}): WebFetchStateManifestCapsule {
  const entries = [...input.sources];
  const sources = entries.map(({ source, capsuleSha256 }) => ({
    id: source.id,
    contentSha256: source.contentSha256,
    capsuleSha256,
  }));
  const sourceSetSha256 = webFetchRunCounts({
    sources: new Map(entries.map(({ source }) => [source.id, source])),
    browserFallbackCount: input.browserFallbackCount,
  }).sourceSetSha256;
  const content = {
    kind: "napier.web-fetch-state-manifest-capsule" as const,
    schemaVersion: 1 as const,
    sourceThreadId: input.sourceThreadId,
    sourceRunId: input.sourceRunId,
    browserFallbackCount: input.browserFallbackCount,
    sources,
    sourceSetSha256,
  };
  return validateWebFetchStateManifestCapsule({
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  });
}

export function validateWebFetchStateManifestCapsule(
  input: unknown,
): WebFetchStateManifestCapsule {
  const value = exactRecord(input, [
    "kind",
    "schemaVersion",
    "sourceThreadId",
    "sourceRunId",
    "browserFallbackCount",
    "sources",
    "sourceSetSha256",
    "contentSha256",
  ]);
  if (
    value["kind"] !== "napier.web-fetch-state-manifest-capsule" ||
    value["schemaVersion"] !== 1 ||
    typeof value["sourceThreadId"] !== "string" ||
    !THREAD_ID.test(value["sourceThreadId"]) ||
    typeof value["sourceRunId"] !== "string" ||
    !RUN_ID.test(value["sourceRunId"]) ||
    !integerBetween(
      value["browserFallbackCount"],
      0,
      MAX_WEB_FETCH_BROWSER_FALLBACKS_PER_RUN,
    ) ||
    !Array.isArray(value["sources"]) ||
    value["sources"].length > MAX_WEB_FETCH_SOURCES_PER_RUN ||
    !hash(value["sourceSetSha256"]) ||
    !hash(value["contentSha256"])
  ) {
    throw new Error("Web Fetch state manifest capsule is invalid");
  }
  const sources = value["sources"].map((entry) => {
    const source = exactRecord(entry, ["id", "contentSha256", "capsuleSha256"]);
    if (
      typeof source["id"] !== "string" ||
      !SOURCE_ID.test(source["id"]) ||
      !hash(source["contentSha256"]) ||
      !hash(source["capsuleSha256"])
    ) {
      throw new Error("Web Fetch state manifest Source is invalid");
    }
    return {
      id: source["id"],
      contentSha256: source["contentSha256"],
      capsuleSha256: source["capsuleSha256"],
    };
  });
  if (new Set(sources.map((source) => source.id)).size !== sources.length) {
    throw new Error("Web Fetch state manifest Source IDs are invalid");
  }
  const content = {
    kind: "napier.web-fetch-state-manifest-capsule" as const,
    schemaVersion: 1 as const,
    sourceThreadId: value["sourceThreadId"],
    sourceRunId: value["sourceRunId"],
    browserFallbackCount: Number(value["browserFallbackCount"]),
    sources,
    sourceSetSha256: value["sourceSetSha256"],
  };
  const projectedSet = sha256(
    canonicalJson(
      sources.map((source) => ({
        id: source.id,
        contentSha256: source.contentSha256,
      })),
    ),
  );
  if (
    projectedSet !== content.sourceSetSha256 ||
    sha256(canonicalJson(content)) !== value["contentSha256"]
  ) {
    throw new Error("Web Fetch state manifest capsule binding is invalid");
  }
  return { ...content, contentSha256: value["contentSha256"] };
}

export function createWebFetchStateCapsuleReceipt(
  manifest: WebFetchStateManifestCapsule,
  manifestCapsuleBytes: number,
): WebFetchStateCapsuleReceipt {
  const content = {
    kind: "napier.web-fetch-state-capsule-receipt" as const,
    schemaVersion: 1 as const,
    sourceRunId: manifest.sourceRunId,
    sourceCount: manifest.sources.length,
    sourceSetSha256: manifest.sourceSetSha256,
    manifestCapsuleSha256: manifest.contentSha256,
    manifestCapsuleBytes,
    storage: "local_only" as const,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function validateWebFetchStateCapsuleReceipt(
  input: unknown,
): WebFetchStateCapsuleReceipt {
  const value = exactRecord(input, [
    "kind",
    "schemaVersion",
    "sourceRunId",
    "sourceCount",
    "sourceSetSha256",
    "manifestCapsuleSha256",
    "manifestCapsuleBytes",
    "storage",
    "contentSha256",
  ]);
  if (
    value["kind"] !== "napier.web-fetch-state-capsule-receipt" ||
    value["schemaVersion"] !== 1 ||
    typeof value["sourceRunId"] !== "string" ||
    !RUN_ID.test(value["sourceRunId"]) ||
    !integerBetween(value["sourceCount"], 0, MAX_WEB_FETCH_SOURCES_PER_RUN) ||
    !hash(value["sourceSetSha256"]) ||
    !hash(value["manifestCapsuleSha256"]) ||
    !integerBetween(
      value["manifestCapsuleBytes"],
      1,
      MAX_WEB_FETCH_MANIFEST_CAPSULE_BYTES,
    ) ||
    value["storage"] !== "local_only" ||
    !hash(value["contentSha256"])
  ) {
    throw new Error("Web Fetch state capsule receipt is invalid");
  }
  const content = {
    kind: "napier.web-fetch-state-capsule-receipt" as const,
    schemaVersion: 1 as const,
    sourceRunId: value["sourceRunId"],
    sourceCount: Number(value["sourceCount"]),
    sourceSetSha256: value["sourceSetSha256"],
    manifestCapsuleSha256: value["manifestCapsuleSha256"],
    manifestCapsuleBytes: Number(value["manifestCapsuleBytes"]),
    storage: "local_only" as const,
  };
  if (sha256(canonicalJson(content)) !== value["contentSha256"]) {
    throw new Error("Web Fetch state capsule receipt hash is invalid");
  }
  return { ...content, contentSha256: value["contentSha256"] };
}

function exactRecord(
  input: unknown,
  keys: readonly string[],
): Record<string, any> {
  const value = record(input);
  if (
    !value ||
    canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())
  ) {
    throw new Error("Web Fetch capsule has unsupported fields");
  }
  return value;
}

function record(value: unknown): Record<string, any> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined;
}

function hash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function integerBetween(value: unknown, minimum: number, maximum: number) {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
  );
}
