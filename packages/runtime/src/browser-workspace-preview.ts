import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

import type { Route } from "playwright-core";

import { sha256 } from "./ed25519.js";
import { isPathInsideWorkspace } from "./policy.js";
import { MAX_BROWSER_WORKSPACE_PREVIEW_FILE_BYTES } from "./browser-session-model.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

const PREVIEW_ORIGIN = "http://napier-workspace-preview.invalid";
const HTML_EXTENSIONS = new Set([".html", ".htm"]);

export interface BrowserWorkspacePreviewEvidence {
  entryPathSha256: string;
  entrySha256: string;
  entryBytes: number;
}

export class BrowserWorkspacePreview {
  readonly entryUrl: string;
  readonly evidence: BrowserWorkspacePreviewEvidence;

  private constructor(
    private readonly root: string,
    entryName: string,
    evidence: BrowserWorkspacePreviewEvidence,
  ) {
    this.entryUrl = `${PREVIEW_ORIGIN}/${encodeURIComponent(entryName)}`;
    this.evidence = evidence;
  }

  static async create(
    workspaceRootInput: string,
    entryPathInput: string,
  ): Promise<BrowserWorkspacePreview> {
    const workspaceRoot = await realpath(path.resolve(workspaceRootInput));
    const relativePath = normalizePreviewEntryPath(entryPathInput);
    const target = await resolvePreviewFile(
      workspaceRoot,
      path.dirname(relativePath),
      path.basename(relativePath),
    );
    if (!HTML_EXTENSIONS.has(path.extname(target.relativePath).toLowerCase())) {
      throw new Error("Browser workspace preview entry must be an HTML file");
    }
    const contents = await readPreviewFile(target.absolutePath);
    return new BrowserWorkspacePreview(
      path.dirname(target.absolutePath),
      path.basename(target.absolutePath),
      {
        entryPathSha256: sha256(relativePath),
        entrySha256: sha256(contents),
        entryBytes: contents.byteLength,
      },
    );
  }

  matches(value: string): boolean {
    try {
      return new URL(value).origin === PREVIEW_ORIGIN;
    } catch {
      return false;
    }
  }

  url(value: string): URL | undefined {
    try {
      const url = new URL(value);
      return url.origin === PREVIEW_ORIGIN ? url : undefined;
    } catch {
      return undefined;
    }
  }

  async fulfill(route: Route): Promise<boolean> {
    const url = this.url(route.request().url());
    if (!url) return false;
    try {
      const relativePath = decodePreviewRequestPath(url.pathname);
      const target = await resolvePreviewFile(this.root, ".", relativePath);
      const contents = await readPreviewFile(target.absolutePath);
      await route.fulfill({
        status: 200,
        body: contents,
        headers: previewHeaders(target.relativePath),
      });
    } catch {
      await route.fulfill({
        status: 404,
        body: Buffer.from("Not found", "utf8"),
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return true;
  }
}

function normalizePreviewEntryPath(input: string): string {
  if (
    !input ||
    input.length > 500 ||
    path.isAbsolute(input) ||
    /[\u0000-\u001f\u007f]/u.test(input)
  ) {
    throw new Error(
      "Browser workspace preview requires a visible workspace-relative path",
    );
  }
  const normalized = path.normalize(input);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`) ||
    normalized
      .split(path.sep)
      .some((segment) => isProtectedWorkspacePathSegment(segment))
  ) {
    throw new Error("Browser workspace preview path is outside its safe scope");
  }
  return normalized;
}

function decodePreviewRequestPath(pathname: string): string {
  const decoded = decodeURIComponent(pathname).replace(/^\/+/u, "");
  if (
    !decoded ||
    decoded.length > 500 ||
    path.isAbsolute(decoded) ||
    /[\u0000-\u001f\u007f]/u.test(decoded)
  ) {
    throw new Error("Browser workspace preview request path is invalid");
  }
  const normalized = path.normalize(decoded);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`) ||
    normalized
      .split(path.sep)
      .some(
        (segment) =>
          segment.startsWith(".") || isProtectedWorkspacePathSegment(segment),
      )
  ) {
    throw new Error("Browser workspace preview request escapes its root");
  }
  return normalized;
}

async function resolvePreviewFile(
  rootInput: string,
  baseRelative: string,
  fileRelative: string,
): Promise<{ absolutePath: string; relativePath: string }> {
  const root = await realpath(path.resolve(rootInput));
  const base = path.resolve(root, baseRelative);
  const target = path.resolve(base, fileRelative);
  if (!isPathInsideWorkspace(target, root)) {
    throw new Error("Browser workspace preview request escapes its root");
  }
  const relativePath = path.relative(root, target);
  let cursor = root;
  for (const segment of relativePath.split(path.sep)) {
    if (
      !segment ||
      segment.startsWith(".") ||
      isProtectedWorkspacePathSegment(segment)
    ) {
      throw new Error("Browser workspace preview request is protected");
    }
    cursor = path.join(cursor, segment);
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) {
      throw new Error("Browser workspace preview refuses symbolic links");
    }
  }
  const info = await lstat(target);
  const canonical = await realpath(target);
  if (!info.isFile() || canonical !== target) {
    throw new Error("Browser workspace preview target is not a regular file");
  }
  return { absolutePath: target, relativePath };
}

async function readPreviewFile(target: string): Promise<Buffer> {
  const handle = await open(
    target,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.size < 1 ||
      info.size > MAX_BROWSER_WORKSPACE_PREVIEW_FILE_BYTES
    ) {
      throw new Error("Browser workspace preview file exceeds its limit");
    }
    const contents = await handle.readFile();
    if (contents.byteLength > MAX_BROWSER_WORKSPACE_PREVIEW_FILE_BYTES) {
      throw new Error("Browser workspace preview file exceeds its limit");
    }
    return contents;
  } finally {
    await handle.close();
  }
}

function previewHeaders(filePath: string): Record<string, string> {
  const contentType = previewMimeType(filePath);
  return {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    ...(contentType.startsWith("text/html")
      ? {
          "Content-Security-Policy": [
            "default-src 'self' data: blob:",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "connect-src 'none'",
            "media-src 'self' data: blob:",
            "object-src 'none'",
            "frame-src 'none'",
            "base-uri 'self'",
            "form-action 'none'",
          ].join("; "),
        }
      : {}),
  };
}

function previewMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
    case ".htm":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}
