import { throwNapierApiError } from "./api-error";
import { requestJson } from "./api-client";

/**
 * A single browsable subdirectory returned by the directory browser.
 */
export interface WorkspaceDirectoryEntry {
  name: string;
  path: string;
  kind: "directory" | "file";
}

/**
 * The listing of one directory for the folder picker: its canonical `path`,
 * the `parent` to walk up to (null at a filesystem root), and the immediate
 * subdirectories to descend into. Mirrors the server-side shape in
 * apps/server/src/workspace-directories-http.ts.
 */
export interface WorkspaceDirectoryListing {
  path: string;
  parent: string | null;
  entries: WorkspaceDirectoryEntry[];
  truncated: boolean;
  nextCursor: string | null;
}

export interface WorkspaceDirectoryPickerResult {
  cancelled: boolean;
  path?: string;
}

export interface WorkspaceFilePreview {
  path: string;
  filename: string;
  contentType: string;
  blob: Blob;
  sizeBytes: number;
  sha256: string;
  text?: string;
}

export function pickWorkspaceDirectory(): Promise<WorkspaceDirectoryPickerResult> {
  return requestJson("/api/workspace/directory-picker", {
    method: "POST",
    headers: { "X-Napier-Intent": "choose-workspace" },
  });
}

export function listWorkspaceEntries(
  path: string,
  cursor?: string,
): Promise<WorkspaceDirectoryListing> {
  const query = new URLSearchParams({ path, files: "1" });
  if (cursor) query.set("cursor", cursor);
  return requestJson(`/api/workspace/directories?${query.toString()}`);
}

export async function previewWorkspaceFile(
  path: string,
  signal?: AbortSignal,
): Promise<WorkspaceFilePreview> {
  const endpoint = `/api/workspace/file?${new URLSearchParams({ path }).toString()}`;
  const response = await fetch(endpoint, signal ? { signal } : undefined);
  return readFilePreviewResponse(response, endpoint, path);
}

export async function readFilePreviewResponse(
  response: Response,
  endpoint: string,
  path: string,
): Promise<WorkspaceFilePreview> {
  if (!response.ok) {
    await throwNapierApiError(
      response,
      "Could not preview workspace file",
      endpoint,
    );
  }
  const sha256 = response.headers.get("X-Napier-Content-SHA256");
  if (!sha256 || !/^[a-f0-9]{64}$/u.test(sha256)) {
    throw new Error(`Response hash missing for ${endpoint}`);
  }
  const sizeBytes = Number(
    response.headers.get("X-Napier-Workspace-File-Size-Bytes") ?? Number.NaN,
  );
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error(`Response file size invalid for ${endpoint}`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== sizeBytes) {
    throw new Error(`Response file size mismatch for ${endpoint}`);
  }
  const observedSha256 = await sha256ArrayBuffer(bytes);
  if (observedSha256 !== sha256) {
    throw new Error(`Response hash mismatch for ${endpoint}`);
  }
  const contentType =
    response.headers.get("Content-Type") ?? "application/octet-stream";
  const blob = new Blob([bytes], { type: contentType });
  const filename =
    contentDispositionFilename(response) ?? basename(path) ?? "workspace-file";
  return {
    path,
    filename,
    contentType,
    blob,
    sizeBytes,
    sha256,
    ...(workspaceFileIsText(contentType)
      ? { text: new TextDecoder().decode(bytes) }
      : {}),
  };
}

function workspaceFileIsText(contentType: string): boolean {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return (
    mediaType?.startsWith("text/") === true ||
    mediaType === "application/json" ||
    mediaType === "application/xml"
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
  const match = header?.match(/\bfilename="([^"\\/]+)"/u);
  return match?.[1];
}

function basename(path: string): string | undefined {
  return path.split(/[\\/]/u).filter(Boolean).at(-1);
}
