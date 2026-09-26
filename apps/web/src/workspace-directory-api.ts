import {
  decodeFilePreviewText,
  isTextPreviewContentType,
  MAX_TEXT_FILE_PREVIEW_BYTES,
  MAX_WORKSPACE_FILE_PREVIEW_BYTES,
} from "@napier/contracts/file-preview";

import { throwNapierApiError } from "./api-error";
import { requestJson } from "./api-client";
import { artifactInspectorCopy as copy } from "./artifact-inspector-copy";

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
  textError?: string;
  textTruncated?: boolean;
  previewUrl?: string;
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
  threadId?: string,
): Promise<WorkspaceFilePreview> {
  const query = new URLSearchParams({
    path,
    ...(threadId ? { threadId } : {}),
  });
  const endpoint = `/api/workspace/file?${query.toString()}`;
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
  if (sizeBytes > MAX_WORKSPACE_FILE_PREVIEW_BYTES) {
    throw new Error(
      `File exceeds the ${MAX_WORKSPACE_FILE_PREVIEW_BYTES / 1024 / 1024} MiB preview limit`,
    );
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
    path: response.headers.get("X-Napier-Workspace-File-Path")
      ? decodeURIComponent(
          response.headers.get("X-Napier-Workspace-File-Path")!,
        )
      : path,
    filename,
    contentType,
    blob,
    sizeBytes,
    sha256,
    ...(response.headers.get("X-Napier-Workspace-Preview-Url")
      ? { previewUrl: response.headers.get("X-Napier-Workspace-Preview-Url")! }
      : {}),
    ...decodePreviewText(bytes, contentType),
  };
}

function decodePreviewText(
  bytes: ArrayBuffer,
  contentType: string,
): Pick<WorkspaceFilePreview, "text" | "textError" | "textTruncated"> {
  if (!isTextPreviewContentType(contentType)) return {};
  const truncated = bytes.byteLength > MAX_TEXT_FILE_PREVIEW_BYTES;
  try {
    const text = decodeFilePreviewText(
      new Uint8Array(
        bytes,
        0,
        Math.min(bytes.byteLength, MAX_TEXT_FILE_PREVIEW_BYTES),
      ),
      { allowIncompleteTail: truncated },
    );
    return { text, ...(truncated ? { textTruncated: true } : {}) };
  } catch {
    return { textError: copy.textEncodingUnavailable };
  }
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
