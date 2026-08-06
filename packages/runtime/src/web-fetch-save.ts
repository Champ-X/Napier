import { Readable } from "node:stream";

import { sha256 } from "./ed25519.js";
import { PublicHttpClient } from "./public-http-client.js";
import {
  RunBoundArtifactRegistrar,
  type RunBoundArtifactStore,
} from "./run-bound-artifact.js";
import {
  RunBoundFileArtifactRegistrar,
  type RunBoundFileArtifactStore,
} from "./run-bound-file-artifact.js";
import { executeWebFetchSource } from "./web-fetch-execution.js";
import {
  MAX_WEB_FETCH_BODY_BYTES,
  type WebFetchSourceRetentionProvider,
  type WebFetchSourceFormat,
} from "./web-fetch-model.js";
import type { WebFetchStateCapsuleReceipt } from "./web-fetch-capsule-model.js";
import {
  preflightWorkspaceOutputFile,
  writeWorkspaceOutputFile,
} from "./workspace-output-file.js";

export interface WebFetchSaveRequest {
  url: string;
  path: string;
}

export interface WebFetchSaveDetails {
  kind: "napier.web-fetch-save";
  schemaVersion: 1;
  pathSha256: string;
  fileSha256: string;
  fileBytes: number;
  sourceFormat: WebFetchSourceFormat;
  sourceBodySha256: string;
  sourceBodyBytes: number;
  sourceId: string;
  sourceContentSha256: string;
  sourceLineCount: number;
  sourceCount: number;
  sourceSetSha256: string;
  stateCapsule?: WebFetchStateCapsuleReceipt;
  sourceUrlSha256: string;
  sourceOriginSha256: string;
  redirectCount: number;
  retrievedAt: string;
  artifactRegistration:
    | "artifact_registered"
    | "no_run_bound_plan"
    | "no_matching_artifact"
    | "artifact_not_expected"
    | "artifact_registration_failed";
}

export interface WebFetchSaveResult {
  output: string;
  details: WebFetchSaveDetails;
}

export interface WebFetchSaveExecutor {
  execute(
    owner: { threadId: string; runId: string },
    request: WebFetchSaveRequest,
    signal?: AbortSignal,
  ): Promise<WebFetchSaveResult>;
}

export interface RunWebFetchSaveManagerOptions {
  workspaceRoot: string;
  store: RunBoundFileArtifactStore & RunBoundArtifactStore;
  retainSource: WebFetchSourceRetentionProvider;
  http?: Pick<PublicHttpClient, "request">;
  now?: () => Date;
}

export class RunWebFetchSaveManager implements WebFetchSaveExecutor {
  private readonly http: Pick<PublicHttpClient, "request">;
  private readonly artifacts: RunBoundArtifactRegistrar;
  private readonly files: RunBoundFileArtifactRegistrar;
  private readonly now: () => Date;

  constructor(private readonly options: RunWebFetchSaveManagerOptions) {
    this.http = options.http ?? new PublicHttpClient();
    this.artifacts = new RunBoundArtifactRegistrar(options.store);
    this.files = new RunBoundFileArtifactRegistrar(options.store);
    this.now = options.now ?? (() => new Date());
  }

  async execute(
    owner: { threadId: string; runId: string },
    request: WebFetchSaveRequest,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<WebFetchSaveResult> {
    const path = await preflightWorkspaceOutputFile(
      this.options.workspaceRoot,
      request.path,
      outputOptions(),
    );
    const authority = this.artifacts.authorize(
      owner,
      (artifact) => artifact.kind === "file" && artifact.path === path,
    );
    if (!authority) {
      throw new Error(
        "Web Fetch save requires one expected file Artifact on the current Run-bound Plan",
      );
    }
    const executed = await executeWebFetchSource({
      http: this.http,
      browserFallbackCount: 0,
      owner,
      url: request.url,
      signal,
      options: { browserFallbackAllowed: false },
      now: this.now,
      allowPdfWithoutText: true,
    });
    const retained = await this.options.retainSource.retainWebSource(
      owner,
      executed.source,
      signal,
    );
    assertPathFormat(path, executed.source.format);
    const currentAuthority = this.artifacts.authorize(
      owner,
      (artifact) => artifact.kind === "file" && artifact.path === path,
    );
    if (
      !currentAuthority ||
      currentAuthority.planId !== authority.planId ||
      currentAuthority.artifactId !== authority.artifactId
    ) {
      throw new Error("Web Fetch save Plan authority changed before write");
    }
    const file = await writeWorkspaceOutputFile(
      this.options.workspaceRoot,
      path,
      Readable.from([executed.body]),
      outputOptions(),
      signal,
    );
    if (
      file.fileSha256 !== executed.source.bodySha256 ||
      file.fileBytes !== executed.source.bodyBytes
    ) {
      throw new Error("Web Fetch saved file does not match response bytes");
    }
    const registration = await this.files.register(owner, {
      path: file.path,
      fileSha256: file.fileSha256,
      fileBytes: file.fileBytes,
      producedEvidence:
        "Web Fetch save wrote the declared raw public Source file.",
      verifiedEvidence:
        "Web Fetch save verified the declared raw Source file bytes.",
    });
    const registrationMatches =
      registration.status === "registered" &&
      registration.reason === "artifact_registered" &&
      registration.planId === authority.planId &&
      registration.artifactId === authority.artifactId;
    const artifactRegistration = registrationMatches
      ? "artifact_registered"
      : registration.reason === "artifact_registered"
        ? "artifact_registration_failed"
        : registration.reason;
    return {
      output: [
        `Web Source file saved: ${file.path}`,
        `File SHA-256: ${file.fileSha256}`,
        `Bytes: ${file.fileBytes}`,
        `Format: ${executed.source.format}`,
        `Web Source: ${retained.source.id}`,
        `Content SHA-256: ${retained.source.contentSha256}`,
        artifactRegistration === "artifact_registered"
          ? "Plan Artifact: verified"
          : `Plan Artifact: not verified (${artifactRegistration})`,
      ].join("\n"),
      details: {
        kind: "napier.web-fetch-save",
        schemaVersion: 1,
        pathSha256: file.pathSha256,
        fileSha256: file.fileSha256,
        fileBytes: file.fileBytes,
        sourceFormat: executed.source.format,
        sourceBodySha256: executed.source.bodySha256,
        sourceBodyBytes: executed.source.bodyBytes,
        sourceId: retained.source.id,
        sourceContentSha256: retained.source.contentSha256,
        sourceLineCount: retained.source.lineCount,
        sourceCount: retained.details.sourceCount,
        sourceSetSha256: retained.details.sourceSetSha256,
        ...(retained.details.stateCapsule
          ? { stateCapsule: retained.details.stateCapsule }
          : {}),
        sourceUrlSha256: sha256(executed.source.finalUrl),
        sourceOriginSha256: sha256(new URL(executed.source.finalUrl).origin),
        redirectCount: executed.source.redirectCount,
        retrievedAt: executed.source.retrievedAt,
        artifactRegistration,
      },
    };
  }
}

function outputOptions() {
  return {
    scope: "Web Fetch",
    action: "save",
    maximumBytes: MAX_WEB_FETCH_BODY_BYTES,
  };
}

function assertPathFormat(path: string, format: WebFetchSourceFormat): void {
  const lower = path.toLowerCase();
  const valid =
    format === "pdf"
      ? lower.endsWith(".pdf")
      : format === "html"
        ? lower.endsWith(".html") || lower.endsWith(".htm")
        : format === "markdown"
          ? lower.endsWith(".md") || lower.endsWith(".markdown")
          : format === "json"
            ? lower.endsWith(".json")
            : lower.endsWith(".txt");
  if (!valid) {
    throw new Error(`Web Fetch save path does not match ${format} content`);
  }
}
