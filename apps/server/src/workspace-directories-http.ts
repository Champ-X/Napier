import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { Hono } from "hono";

import {
  errorMessage,
  jsonError,
  safeFilenameSegment,
  setBodyContentSha256Header,
  setStableContentSha256Header,
  sha256Bytes,
} from "./http-response-evidence.js";
import {
  pickWorkspaceDirectory,
  type WorkspaceDirectoryPickerResult,
} from "./workspace-directory-picker.js";

/**
 * A single browsable subdirectory of the requested path.
 */
export interface WorkspaceDirectoryEntry {
  name: string;
  path: string;
  kind: "directory" | "file";
}

/**
 * The listing of one directory: its canonical `path`, the workspace-bounded
 * `parent`, and the immediate entries a caller can descend into or inspect.
 */
export interface WorkspaceDirectoryListing {
  path: string;
  parent: string | null;
  entries: WorkspaceDirectoryEntry[];
  truncated: boolean;
  nextCursor: string | null;
}

const MAX_DIRECTORY_PATH_LENGTH = 500;
const MAX_DIRECTORY_CURSOR_LENGTH = 2_048;
const MAX_DIRECTORY_ENTRIES = 200;
const MAX_WORKSPACE_FILE_PREVIEW_BYTES = 16 * 1024 * 1024;
const DEVELOPMENT_WEB_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

class DirectoryListingError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 413,
  ) {
    super(message);
    this.name = "DirectoryListingError";
  }
}

export interface WorkspaceFilePreview {
  path: string;
  filename: string;
  contentType: string;
  contents: Buffer;
  sizeBytes: number;
  sha256: string;
}

/**
 * Canonicalize a browse target. Mirrors the resolve->realpath discipline used
 * by workspace rebind so a symlinked request lists its canonical target and the
 * returned paths stay stable for a subsequent rebind.
 */
async function resolveBrowseDirectory(raw: unknown): Promise<string> {
  const requested = validateBrowseDirectoryPath(raw);
  let resolved: string;
  try {
    resolved = await realpath(path.resolve(requested));
  } catch {
    throw new DirectoryListingError("Directory does not exist", 404);
  }
  const info = await stat(resolved);
  if (!info.isDirectory()) {
    throw new DirectoryListingError("Path is not a directory", 400);
  }
  return resolved;
}

function validateBrowseDirectoryPath(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new DirectoryListingError("Directory path must be a string", 400);
  }
  if (
    raw.trim().length === 0 ||
    raw.length > MAX_DIRECTORY_PATH_LENGTH ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/u.test(raw)
  ) {
    throw new DirectoryListingError("Directory path is invalid", 400);
  }
  if (!path.isAbsolute(raw)) {
    throw new DirectoryListingError("Directory path must be absolute", 400);
  }
  return raw;
}

async function readSubdirectories(
  directory: string,
  includeFiles: boolean,
  cursor?: string,
): Promise<{
  entries: WorkspaceDirectoryEntry[];
  truncated: boolean;
  nextCursor: string | null;
}> {
  let dirents;
  try {
    dirents = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      throw new DirectoryListingError("Directory is not readable", 403);
    }
    throw error;
  }
  const entries: WorkspaceDirectoryEntry[] = [];
  for (const dirent of dirents) {
    // Hide dot entries in both picker and file-tree modes. Symbolic links are
    // intentionally omitted so recursive clients cannot walk out through a
    // link or render cycles.
    if (dirent.name.startsWith(".")) continue;
    if (!dirent.isDirectory() && !(includeFiles && dirent.isFile())) continue;
    entries.push({
      name: dirent.name,
      path: path.join(directory, dirent.name),
      kind: dirent.isDirectory() ? "directory" : "file",
    });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  let start = 0;
  if (cursor !== undefined) {
    const cursorIndex = entries.findIndex((entry) => entry.path === cursor);
    if (cursorIndex < 0) {
      throw new DirectoryListingError("Directory cursor is invalid", 400);
    }
    start = cursorIndex + 1;
  }
  const page = entries.slice(start, start + MAX_DIRECTORY_ENTRIES);
  const truncated = start + page.length < entries.length;
  return {
    entries: page,
    truncated,
    nextCursor: truncated
      ? encodeDirectoryCursor(page.at(-1)?.path ?? "")
      : null,
  };
}

export async function listWorkspaceDirectory(
  raw: unknown,
  includeFiles = false,
  allowedRoot?: string,
  rawCursor?: unknown,
): Promise<WorkspaceDirectoryListing> {
  const requested = validateBrowseDirectoryPath(raw);
  const cursor = resolveDirectoryCursor(rawCursor);
  let canonicalRoot: string | undefined;
  if (allowedRoot) {
    const lexicalRoot = path.resolve(validateBrowseDirectoryPath(allowedRoot));
    canonicalRoot = await resolveBrowseDirectory(allowedRoot);
    const lexicalRequested = path.resolve(requested);
    if (
      !pathInside(lexicalRoot, lexicalRequested) &&
      !pathInside(canonicalRoot, lexicalRequested)
    ) {
      throw new DirectoryListingError(
        "Directory is outside the active workspace",
        403,
      );
    }
  }
  const directory = await resolveBrowseDirectory(requested);
  if (canonicalRoot && !pathInside(canonicalRoot, directory)) {
    throw new DirectoryListingError(
      "Directory is outside the active workspace",
      403,
    );
  }
  const { entries, truncated, nextCursor } = await readSubdirectories(
    directory,
    includeFiles,
    cursor,
  );
  const parent = path.dirname(directory);
  return {
    path: directory,
    // At a filesystem root, dirname() returns the path itself; there is
    // nowhere higher to browse, so signal that with a null parent.
    parent: parent === directory || directory === canonicalRoot ? null : parent,
    entries,
    truncated,
    nextCursor,
  };
}

export async function readWorkspaceFilePreview(
  raw: unknown,
  allowedRoot: string,
): Promise<WorkspaceFilePreview> {
  const requested = validateBrowseDirectoryPath(raw);
  const lexicalRoot = path.resolve(validateBrowseDirectoryPath(allowedRoot));
  const canonicalRoot = await resolveBrowseDirectory(allowedRoot);
  const lexicalTarget = path.resolve(requested);
  if (
    !pathInside(lexicalRoot, lexicalTarget) &&
    !pathInside(canonicalRoot, lexicalTarget)
  ) {
    throw new DirectoryListingError(
      "File is outside the active workspace",
      403,
    );
  }

  let target: string;
  try {
    target = await realpath(lexicalTarget);
  } catch {
    throw new DirectoryListingError("File does not exist", 404);
  }
  if (!pathInside(canonicalRoot, target)) {
    throw new DirectoryListingError(
      "File is outside the active workspace",
      403,
    );
  }

  const info = await stat(target);
  if (!info.isFile()) {
    throw new DirectoryListingError("Path is not a regular file", 400);
  }
  if (info.size > MAX_WORKSPACE_FILE_PREVIEW_BYTES) {
    throw new DirectoryListingError("File is too large to preview", 413);
  }
  const contents = await readFile(target);
  if (contents.byteLength > MAX_WORKSPACE_FILE_PREVIEW_BYTES) {
    throw new DirectoryListingError("File is too large to preview", 413);
  }
  return {
    path: target,
    filename: path.basename(target),
    contentType: workspaceFileContentType(target),
    contents,
    sizeBytes: contents.byteLength,
    sha256: sha256Bytes(contents),
  };
}

function resolveDirectoryCursor(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (
    typeof raw !== "string" ||
    raw.length === 0 ||
    raw.length > MAX_DIRECTORY_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/u.test(raw)
  ) {
    throw new DirectoryListingError("Directory cursor is invalid", 400);
  }
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  if (
    Buffer.from(decoded, "utf8").toString("base64url") !== raw ||
    decoded.includes("\0") ||
    !path.isAbsolute(decoded)
  ) {
    throw new DirectoryListingError("Directory cursor is invalid", 400);
  }
  return path.normalize(decoded);
}

function encodeDirectoryCursor(entryPath: string): string {
  return Buffer.from(entryPath, "utf8").toString("base64url");
}

function pathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/**
 * Register the folder-picker's directory browser.
 *
 * Security: listings are canonicalized and confined to the active workspace.
 * Selecting a different root remains an explicit, intent-bound native picker
 * or workspace-rebind operation.
 */
export function registerWorkspaceDirectoriesHttp(
  app: Hono,
  pickDirectory: () => Promise<WorkspaceDirectoryPickerResult> = () =>
    pickWorkspaceDirectory(),
  workspaceRoot?: () => string,
): void {
  let pickerInFlight = false;
  app.get("/api/workspace/directories", async (context) => {
    let listing: WorkspaceDirectoryListing;
    try {
      listing = await listWorkspaceDirectory(
        context.req.query("path"),
        context.req.query("files") === "1",
        workspaceRoot?.(),
        context.req.query("cursor"),
      );
    } catch (error) {
      if (error instanceof DirectoryListingError) {
        return jsonError(context, error.message, error.status);
      }
      return jsonError(context, errorMessage(error), 500);
    }
    context.header("Cache-Control", "no-store");
    setBodyContentSha256Header(context, listing);
    return context.json(listing, 200);
  });
  app.get("/api/workspace/file", async (context) => {
    const activeRoot = workspaceRoot?.();
    if (!activeRoot) {
      return jsonError(context, "Workspace file preview is unavailable", 409);
    }
    let preview: WorkspaceFilePreview;
    try {
      preview = await readWorkspaceFilePreview(
        context.req.query("path"),
        activeRoot,
      );
    } catch (error) {
      if (error instanceof DirectoryListingError) {
        return jsonError(context, error.message, error.status);
      }
      return jsonError(context, errorMessage(error), 500);
    }
    context.header("Cache-Control", "no-store");
    context.header("Content-Type", preview.contentType);
    context.header(
      "Content-Disposition",
      `inline; filename="${safeFilenameSegment(preview.filename, "workspace-file")}"`,
    );
    context.header(
      "X-Napier-Workspace-File-Size-Bytes",
      String(preview.sizeBytes),
    );
    setStableContentSha256Header(context, preview.sha256);
    const body = preview.contents.buffer.slice(
      preview.contents.byteOffset,
      preview.contents.byteOffset + preview.contents.byteLength,
    ) as ArrayBuffer;
    return context.body(body);
  });
  app.post("/api/workspace/directory-picker", async (context) => {
    if (context.req.header("sec-fetch-site") === "cross-site") {
      return jsonError(
        context,
        "Cross-site workspace picker is forbidden",
        403,
      );
    }
    const origin = context.req.header("origin");
    if (origin && !trustedLocalOrigin(origin, context.req.header("host"))) {
      return jsonError(context, "Workspace picker origin is forbidden", 403);
    }
    if (context.req.header("x-napier-intent") !== "choose-workspace") {
      return jsonError(context, "Workspace picker intent is required", 403);
    }
    if (pickerInFlight) {
      return jsonError(context, "Workspace picker is already open", 409);
    }
    pickerInFlight = true;
    let result: WorkspaceDirectoryPickerResult;
    try {
      result = await pickDirectory();
    } catch (error) {
      return jsonError(context, errorMessage(error), 500);
    } finally {
      pickerInFlight = false;
    }
    context.header("Cache-Control", "no-store");
    setBodyContentSha256Header(context, result);
    return context.json(result, 200);
  });
}

function workspaceFileContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return WORKSPACE_FILE_CONTENT_TYPES[extension] ?? "application/octet-stream";
}

const WORKSPACE_FILE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".gif": "image/gif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsx": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mdx": "text/markdown; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".toml": "text/plain; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
};

function trustedLocalOrigin(origin: string, requestHost?: string): boolean {
  if (DEVELOPMENT_WEB_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    const loopback =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]";
    return (
      loopback &&
      url.protocol === "http:" &&
      requestHost !== undefined &&
      url.host === requestHost.toLowerCase()
    );
  } catch {
    return false;
  }
}
