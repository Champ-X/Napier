import { canonicalJson, sha256 } from "./ed25519.js";
import type {
  WebFetchMaterializationIdentity,
  WebFetchResult,
  WebFetchRetainedSource,
  WebFetchSource,
} from "./web-fetch-model.js";
import type { WebFetchStateCapsuleReceipt } from "./web-fetch-capsule-model.js";
import {
  appendWebFetchUrlArtifactOutput,
  visibleWebFetchUrlArtifactRegistration,
  type WebFetchUrlArtifactRegistrar,
} from "./web-fetch-url-artifact.js";
import {
  formatFetchedWebSource,
  webFetchSourceDetails,
  type WebFetchRunView,
} from "./web-fetch-source-view.js";

const HASH = /^[a-f0-9]{64}$/u;
const MATERIALIZATION_PREFIX_CHARS = 32;
const CONTENT_ID_CHARS = 32;

export function createWebFetchMaterializationIdentity(
  owner: { threadId: string; runId: string },
  callId: string,
  url: string,
): WebFetchMaterializationIdentity {
  const normalizedCallId = callId.trim();
  const normalizedUrl = url.trim();
  if (!normalizedCallId || !normalizedUrl) {
    throw new Error("Web fetch materialization identity is invalid");
  }
  return Object.freeze({
    kind: "napier.web-fetch-materialization" as const,
    schemaVersion: 1 as const,
    materializationSha256: sha256(
      canonicalJson({
        kind: "napier.web-fetch-materialization-binding",
        schemaVersion: 1,
        threadIdSha256: sha256(owner.threadId),
        runIdSha256: sha256(owner.runId),
        callIdSha256: sha256(normalizedCallId),
        request: { action: "fetch", url: normalizedUrl },
      }),
    ),
  });
}

export function materializeWebFetchSource(
  input: WebFetchSource,
  identity?: WebFetchMaterializationIdentity,
): WebFetchSource {
  if (!identity) return input;
  const prefix = webFetchMaterializationSourcePrefix(identity);
  return {
    ...input,
    // The first half identifies the admitted call. The second half binds its
    // produced content, so the ID is stable without trusting random process
    // state and a collision cannot silently substitute different evidence.
    id: `${prefix}${input.contentSha256.slice(0, CONTENT_ID_CHARS)}`,
  };
}

export function snapshotWebFetchMaterializationIdentity(
  identity?: WebFetchMaterializationIdentity,
): WebFetchMaterializationIdentity | undefined {
  if (!identity) return undefined;
  const snapshot: WebFetchMaterializationIdentity = {
    kind: identity.kind,
    schemaVersion: identity.schemaVersion,
    materializationSha256: identity.materializationSha256,
  };
  assertWebFetchMaterializationIdentity(snapshot);
  return Object.freeze(snapshot);
}

export function findWebFetchMaterialization(
  sources: ReadonlyMap<string, WebFetchSource>,
  identity: WebFetchMaterializationIdentity,
): WebFetchSource | undefined {
  const prefix = webFetchMaterializationSourcePrefix(identity);
  const matches = [...sources.values()].filter((source) =>
    source.id.startsWith(prefix),
  );
  if (matches.length > 1) {
    throw new Error("Web fetch materialization has conflicting Sources");
  }
  return matches[0];
}

export function retainedWebFetchMaterialization(
  run: WebFetchRunView,
  identity: WebFetchMaterializationIdentity,
  stateCapsule: WebFetchStateCapsuleReceipt | undefined,
): WebFetchRetainedSource | undefined {
  const source = findWebFetchMaterialization(run.sources, identity);
  return source ? retainedWebFetchSource(run, source, stateCapsule) : undefined;
}

export function retainedWebFetchSource(
  run: WebFetchRunView,
  source: WebFetchSource,
  stateCapsule: WebFetchStateCapsuleReceipt | undefined,
): WebFetchRetainedSource {
  return {
    source: structuredClone(source),
    details: {
      ...webFetchSourceDetails("fetch", run, source),
      ...(stateCapsule ? { stateCapsule } : {}),
    },
  };
}

export function webFetchResultFromRetained(
  retained: WebFetchRetainedSource,
): WebFetchResult {
  return {
    output: appendWebFetchUrlArtifactOutput(
      formatFetchedWebSource(retained.source),
      retained.details.urlArtifactRegistration,
    ),
    details: retained.details,
  };
}

export async function registerRetainedWebFetchSource(
  registrar: WebFetchUrlArtifactRegistrar,
  owner: { threadId: string; runId: string },
  retained: WebFetchRetainedSource,
): Promise<WebFetchRetainedSource> {
  const registration = await registrar.register(owner, retained.source);
  const visible = visibleWebFetchUrlArtifactRegistration(registration);
  return visible
    ? {
        source: retained.source,
        details: { ...retained.details, urlArtifactRegistration: visible },
      }
    : retained;
}

export function webFetchMaterializationFlightKey(
  target: string,
  identity?: WebFetchMaterializationIdentity,
): string {
  return identity
    ? `${target}:materialization:${identity.materializationSha256}`
    : target;
}

export function sameWebFetchMaterialization(
  left: WebFetchSource,
  right: WebFetchSource,
): boolean {
  return (
    left.id === right.id &&
    sourceMaterializationSha256(left) === sourceMaterializationSha256(right)
  );
}

export function webFetchMaterializationSourcePrefix(
  identity: WebFetchMaterializationIdentity,
): string {
  assertWebFetchMaterializationIdentity(identity);
  return `websource_${identity.materializationSha256.slice(
    0,
    MATERIALIZATION_PREFIX_CHARS,
  )}`;
}

function sourceMaterializationSha256(source: WebFetchSource): string {
  const { id: _id, retrievedAt: _retrievedAt, ...binding } = source;
  return sha256(canonicalJson(binding));
}

function assertWebFetchMaterializationIdentity(
  identity: WebFetchMaterializationIdentity,
): void {
  if (
    identity.kind !== "napier.web-fetch-materialization" ||
    identity.schemaVersion !== 1 ||
    !HASH.test(identity.materializationSha256)
  ) {
    throw new Error("Web fetch materialization identity is invalid");
  }
}
