import {
  RunBoundUrlArtifactRegistrar,
  type RunBoundUrlArtifactRegistration,
  type RunBoundUrlArtifactStore,
} from "./run-bound-url-artifact.js";
import { canonicalJson } from "./ed25519.js";
import type { WebFetchSource } from "./web-fetch-model.js";
import type { LocalStore } from "./store.js";

export type WebFetchUrlArtifactRegistration =
  RunBoundUrlArtifactRegistration["reason"];
export type WebFetchSourceManagerStore = RunBoundUrlArtifactStore &
  Pick<LocalStore, "getThread" | "listRuns">;

export function formatWebFetchUrlArtifactRegistration(
  registration: WebFetchUrlArtifactRegistration | undefined,
): string {
  if (!registration) return "";
  if (registration === "artifact_registered") {
    return "Plan URL Artifact: verified";
  }
  if (registration === "artifact_registration_failed") {
    return "Plan URL Artifact: registration failed; fetched Source remains available";
  }
  return "";
}

export function visibleWebFetchUrlArtifactRegistration(
  registration: WebFetchUrlArtifactRegistration | undefined,
): "artifact_registered" | "artifact_registration_failed" | undefined {
  return registration === "artifact_registered" ||
    registration === "artifact_registration_failed"
    ? registration
    : undefined;
}

export function appendWebFetchUrlArtifactOutput(
  output: string,
  registration:
    | "artifact_registered"
    | "artifact_registration_failed"
    | undefined,
): string {
  const artifactOutput = formatWebFetchUrlArtifactRegistration(registration);
  return artifactOutput ? `${output}\n\n${artifactOutput}` : output;
}

export class WebFetchUrlArtifactRegistrar {
  private readonly urls: RunBoundUrlArtifactRegistrar | undefined;

  constructor(store?: RunBoundUrlArtifactStore) {
    this.urls = store ? new RunBoundUrlArtifactRegistrar(store) : undefined;
  }

  async register(
    owner: { threadId: string; runId: string },
    source: WebFetchSource,
  ): Promise<WebFetchUrlArtifactRegistration | undefined> {
    if (!this.urls) return undefined;
    try {
      const result = await this.urls.register(owner, {
        url: source.finalUrl,
        contentSha256: source.contentSha256,
        contentBytes: Buffer.byteLength(canonicalJson(source.lines), "utf8"),
        producedEvidence:
          "Web Fetch resolved the declared public URL into a Run-local Source.",
        verifiedEvidence:
          "Web Fetch verified the declared URL against normalized Source content.",
      });
      return result.reason;
    } catch {
      return "artifact_registration_failed";
    }
  }
}
