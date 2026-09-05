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
import { detectWebFetchImage } from "./web-fetch-image.js";
import type {
  ToolOperationDescriptor,
  ToolOperationObserver,
  ToolOperationSettlement,
} from "./tool-operation-journal.js";

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
    operations?: ToolOperationObserver,
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
    operations?: ToolOperationObserver,
  ): Promise<WebFetchSaveResult> {
    const target = await executeSaveOperation(
      operations,
      saveOperationDescriptor(1, "preflight", "verify", "neutral", request),
      async () => {
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
        return { path, authority };
      },
      ({ path, authority }) => ({
        outcome: "succeeded",
        state: {
          pathSha256: sha256(path),
          planIdSha256: sha256(authority.planId),
          artifactIdSha256: sha256(authority.artifactId),
        },
        effect: { route: "preflight", authorized: true },
      }),
    );
    const { path, authority } = target;
    const executed = await executeWebFetchSource({
      http: this.http,
      browserFallbackCount: 0,
      owner,
      url: request.url,
      signal,
      options: { browserFallbackAllowed: false },
      now: this.now,
      allowPdfWithoutText: true,
      ...(operations ? { operations } : {}),
      operationOrdinalBase: 1,
    });
    const retained = await executeSaveOperation(
      operations,
      saveOperationDescriptor(
        3,
        "retain_source",
        "mutate",
        "supporting",
        request,
      ),
      () =>
        this.options.retainSource.retainWebSource(
          owner,
          executed.source,
          signal,
        ),
      (value) => ({
        outcome: "succeeded",
        state: value.source.contentSha256,
        effect: {
          route: "retain_source",
          contentSha256: value.source.contentSha256,
        },
      }),
    );
    await executeSaveOperation(
      operations,
      saveOperationDescriptor(
        4,
        "validate_content",
        "verify",
        "neutral",
        request,
      ),
      async () => {
        assertPathFormat(path, executed.source.format, executed.body);
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
        return executed.source.format;
      },
      (format) => ({
        outcome: "succeeded",
        state: { format, bodySha256: executed.source.bodySha256 },
        effect: { route: "validate_content", format },
      }),
    );
    const file = await executeSaveOperation(
      operations,
      saveOperationDescriptor(5, "write_file", "mutate", "product", request),
      () =>
        writeWorkspaceOutputFile(
          this.options.workspaceRoot,
          path,
          Readable.from([executed.body]),
          outputOptions(),
          signal,
        ),
      (value) => ({
        outcome: "succeeded",
        state: { fileSha256: value.fileSha256, fileBytes: value.fileBytes },
        effect: {
          route: "write_file",
          fileSha256: value.fileSha256,
          fileBytes: value.fileBytes,
        },
      }),
    );
    await executeSaveOperation(
      operations,
      saveOperationDescriptor(
        6,
        "verify_bytes",
        "verify",
        "verification",
        request,
      ),
      async () => {
        if (
          file.fileSha256 !== executed.source.bodySha256 ||
          file.fileBytes !== executed.source.bodyBytes
        ) {
          throw new Error("Web Fetch saved file does not match response bytes");
        }
        return file;
      },
      (value) => ({
        outcome: "succeeded",
        state: { fileSha256: value.fileSha256, fileBytes: value.fileBytes },
        effect: {
          route: "verify_bytes",
          fileSha256: value.fileSha256,
          fileBytes: value.fileBytes,
        },
      }),
    );
    const registration = await executeSaveOperation(
      operations,
      saveOperationDescriptor(
        7,
        "register_artifact",
        "verify",
        "verification",
        request,
      ),
      () =>
        this.files.register(owner, {
          path: file.path,
          fileSha256: file.fileSha256,
          fileBytes: file.fileBytes,
          producedEvidence:
            "Web Fetch save wrote the declared raw public Source file.",
          verifiedEvidence:
            "Web Fetch save verified the declared raw Source file bytes.",
        }),
      (value) => {
        const matches =
          value.status === "registered" &&
          value.reason === "artifact_registered" &&
          value.planId === authority.planId &&
          value.artifactId === authority.artifactId;
        return matches
          ? {
              outcome: "succeeded",
              state: {
                fileSha256: file.fileSha256,
                artifactIdSha256: sha256(authority.artifactId),
              },
              effect: { route: "register_artifact", registered: true },
            }
          : {
              outcome: "failed",
              diagnostic: `Artifact registration did not settle: ${value.reason}`,
              effect: {
                route: "register_artifact",
                registered: false,
                reason: value.reason,
              },
            };
      },
    );
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

async function executeSaveOperation<T>(
  operations: ToolOperationObserver | undefined,
  descriptor: ToolOperationDescriptor,
  execute: () => Promise<T>,
  settlement: (value: T) => ToolOperationSettlement,
): Promise<T> {
  const operation = operations?.operation(descriptor);
  await operation?.proposed();
  const admission = await operation?.admit();
  if (admission && !admission.admitted) {
    throw new Error(
      admission.reason ?? `Operation ${descriptor.route} was not admitted`,
    );
  }
  await operation?.started();
  try {
    const value = await execute();
    await operation?.settled(settlement(value));
    return value;
  } catch (error) {
    await operation?.settled({
      outcome: "failed",
      diagnostic: error,
      effect: { outcome: "failed", route: descriptor.route },
    });
    throw error;
  }
}

function saveOperationDescriptor(
  ordinal: number,
  route: string,
  operation: "mutate" | "verify",
  contribution: "supporting" | "product" | "verification" | "neutral",
  request: WebFetchSaveRequest,
): ToolOperationDescriptor {
  const resourceKey = {
    kind: route === "retain_source" ? "public-source" : "workspace-path",
    url: request.url,
    path: request.path,
  };
  const routeBinding = {
    kind: "web-fetch-save-stage",
    route,
    ...(route === "retain_source"
      ? { origin: publicOrigin(request.url) }
      : { path: request.path }),
  };
  return {
    ordinal,
    mode: "pipeline",
    route,
    operation,
    scope: route === "retain_source" ? "run_source" : "workspace",
    contribution,
    resourceKey,
    failureBindings: {
      target: resourceKey,
      origin: { kind: "public-origin", origin: publicOrigin(request.url) },
      route: routeBinding,
      capability: { kind: "web-fetch-save-stage-capability", route },
    },
    failureDomainKey: routeBinding,
  };
}

function publicOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "invalid";
  }
}

function outputOptions() {
  return {
    scope: "Web Fetch",
    action: "save",
    maximumBytes: MAX_WEB_FETCH_BODY_BYTES,
  };
}

function assertPathFormat(
  path: string,
  format: WebFetchSourceFormat,
  body: Buffer,
): void {
  const lower = path.toLowerCase();
  const valid =
    format === "pdf"
      ? lower.endsWith(".pdf")
      : format === "image"
        ? imagePathMatches(lower, body)
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

function imagePathMatches(path: string, body: Buffer): boolean {
  const image = detectWebFetchImage(body);
  return Boolean(
    image && image.extensions.some((extension) => path.endsWith(extension)),
  );
}
