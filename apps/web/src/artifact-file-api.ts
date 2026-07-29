import { throwNapierApiError } from "./api-error";
import { requestJson } from "./api-client";

export interface PlanArtifactFileDownload {
  blob: Blob;
  filename: string;
  sha256: string;
  sizeBytes: number;
}

export interface PlanArtifactTextPreview {
  kind: "napier.plan-artifact-text-preview";
  schemaVersion: 1;
  planId: string;
  artifactId: string;
  planRevision: number;
  status: string;
  artifactKind: string;
  pathSha256: string;
  sha256: string;
  sizeBytes: number;
  lineCount: number;
  textSha256: string;
  text: string;
}

export interface PlanArtifactDataProfile {
  kind: "napier.plan-artifact-data-profile";
  schemaVersion: 1;
  planId: string;
  artifactId: string;
  planRevision: number;
  status: string;
  artifactKind: string;
  pathSha256: string;
  sha256: string;
  sizeBytes: number;
  format: "json" | "jsonl" | "csv" | "tsv" | "markdown_table";
  rowCount: number;
  columnCount: number;
  truncated: boolean;
  columnSetSha256: string;
  sampleSha256: string;
  columns: string[];
  sampleRows: Array<Record<string, string | number | boolean | null>>;
}

export interface PlanArtifactDriftCheck {
  kind: "napier.plan-artifact-drift-check";
  schemaVersion: 1;
  planId: string;
  artifactId: string;
  planRevision: number;
  status: string;
  artifactKind: string;
  pathSha256: string;
  expectedSha256: string;
  result: "current" | "drifted" | "missing";
  observedSha256?: string;
  sizeBytes?: number;
}

export interface PlanArtifactDirectoryManifestEntry {
  kind: "directory" | "file";
  path: string;
  sha256?: string;
  sizeBytes?: number;
}

export interface PlanArtifactDirectoryManifest {
  kind: "napier.plan-artifact-directory-manifest";
  schemaVersion: 1;
  planId: string;
  artifactId: string;
  planRevision: number;
  status: string;
  artifactKind: string;
  pathSha256: string;
  sha256: string;
  sizeBytes: number;
  entryCount: number;
  fileCount: number;
  directoryCount: number;
  entries: PlanArtifactDirectoryManifestEntry[];
}

export async function downloadPlanArtifactFile(
  threadId: string,
  planId: string,
  artifactId: string,
): Promise<PlanArtifactFileDownload> {
  const path = `/api/threads/${encodeURIComponent(threadId)}/plans/${encodeURIComponent(planId)}/artifacts/${encodeURIComponent(artifactId)}/file`;
  const response = await fetch(path);
  if (!response.ok) {
    await throwNapierApiError(response, "Request failed", path);
  }
  const expectedSha256 = response.headers.get("X-Napier-Content-SHA256");
  if (!expectedSha256 || !/^[a-f0-9]{64}$/u.test(expectedSha256)) {
    throw new Error(`Response hash missing for ${path}`);
  }
  const bytes = await response.arrayBuffer();
  const observedSha256 = await sha256ArrayBuffer(bytes);
  if (observedSha256 !== expectedSha256) {
    throw new Error(`Response hash mismatch for ${path}`);
  }
  const headerSize = response.headers.get("X-Napier-Plan-Artifact-Size-Bytes");
  const sizeBytes = Number(headerSize ?? Number.NaN);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error(`Response artifact size invalid for ${path}`);
  }
  return {
    blob: new Blob([bytes], {
      type: response.headers.get("Content-Type") ?? "application/octet-stream",
    }),
    filename:
      contentDispositionFilename(response) ??
      planArtifactFileFallbackFilename(artifactId, expectedSha256),
    sha256: expectedSha256,
    sizeBytes,
  };
}

export function previewPlanArtifactText(
  threadId: string,
  planId: string,
  artifactId: string,
): Promise<PlanArtifactTextPreview> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/plans/${encodeURIComponent(planId)}/artifacts/${encodeURIComponent(artifactId)}/preview`,
  );
}

export function previewPlanArtifactDataProfile(
  threadId: string,
  planId: string,
  artifactId: string,
): Promise<PlanArtifactDataProfile> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/plans/${encodeURIComponent(planId)}/artifacts/${encodeURIComponent(artifactId)}/data`,
  );
}

export function checkPlanArtifactDrift(
  threadId: string,
  planId: string,
  artifactId: string,
): Promise<PlanArtifactDriftCheck> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/plans/${encodeURIComponent(planId)}/artifacts/${encodeURIComponent(artifactId)}/drift-check`,
    { method: "POST" },
  );
}

export function previewPlanArtifactDirectoryManifest(
  threadId: string,
  planId: string,
  artifactId: string,
): Promise<PlanArtifactDirectoryManifest> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/plans/${encodeURIComponent(planId)}/artifacts/${encodeURIComponent(artifactId)}/manifest`,
  );
}

async function sha256ArrayBuffer(value: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function contentDispositionFilename(response: Response): string | undefined {
  const header = response.headers.get("Content-Disposition");
  const match = header?.match(/\bfilename="([^"]+)"/u);
  if (!match) return undefined;
  const filename = safeFilenameSegment(match[1] ?? "", "");
  return filename.length > 0 ? filename : undefined;
}

function planArtifactFileFallbackFilename(
  artifactId: string,
  sha256: string,
): string {
  const safeArtifactId = safeFilenameSegment(artifactId, "artifact");
  return `napier-artifact-${safeArtifactId}-${sha256.slice(0, 12)}.artifact`;
}

function safeFilenameSegment(value: string, fallback: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]/g, "_");
  return normalized.length > 0 && normalized !== "." && normalized !== ".."
    ? normalized
    : fallback;
}
