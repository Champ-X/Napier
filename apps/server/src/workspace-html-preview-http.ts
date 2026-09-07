import { randomBytes } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import type { Hono } from "hono";

import type { WorkspaceFilePreview } from "./workspace-file-preview.js";

const PREFIX = "/api/workspace/preview/";
const MAX_SESSIONS = 256;
const MAX_RETAINED_BYTES = 64 * 1024 * 1024;
const SESSION_LIFETIME_MS = 60 * 60 * 1000;

interface PreviewSession {
  workspaceRoot: string;
  directory: string;
  entry: WorkspaceFilePreview;
  expiresAt: number;
}

/** Serve an HTML document and its local assets as a sandboxed, directory-scoped site. */
export function registerWorkspaceHtmlPreviewHttp(
  app: Hono,
  workspaceRoot: () => string | undefined,
  readFile: (file: string, root: string) => Promise<WorkspaceFilePreview>,
): (root: string, entry: WorkspaceFilePreview) => string {
  const sessions = new Map<string, PreviewSession>();
  app.get(`${PREFIX}:session/*`, async (context) => {
    const id = context.req.param("session");
    const session = sessions.get(id);
    if (
      !session ||
      session.expiresAt <= Date.now() ||
      session.workspaceRoot !== workspaceRoot()
    ) {
      sessions.delete(id);
      return context.text("Preview expired. Refresh the file preview.", 410);
    }
    const prefix = `${PREFIX}${id}/`;
    try {
      const pathname = new URL(context.req.url).pathname;
      const relative = decodeURIComponent(pathname.slice(prefix.length));
      const segments = relative.split("/");
      if (
        relative.length > 500 ||
        /[\\\u0000-\u001f\u007f]/u.test(relative) ||
        segments.some(
          (part) =>
            !part ||
            part.startsWith(".") ||
            part.toLowerCase() === "node_modules",
        ) ||
        (await realpath(session.directory)) !== session.directory
      ) {
        return context.text("Not found", 404);
      }
      let target = session.directory;
      for (const segment of segments) {
        target = path.join(target, segment);
        if ((await lstat(target)).isSymbolicLink()) {
          return context.text("Not found", 404);
        }
      }
      // Pin the HTML bytes to the source inspection, even if the workspace changes.
      const file =
        target === session.entry.path
          ? session.entry
          : await readFile(target, session.directory);
      const source = `${new URL(context.req.url).origin}${prefix}`;
      context.header("Cache-Control", "no-store");
      context.header("Content-Type", file.contentType);
      context.header("X-Content-Type-Options", "nosniff");
      context.header("Referrer-Policy", "no-referrer");
      // Sandboxed frames have an opaque origin. Modules and fonts still need CORS.
      context.header("Access-Control-Allow-Origin", "*");
      context.header(
        "Content-Security-Policy",
        [
          "sandbox allow-scripts",
          "default-src 'none'",
          `script-src 'unsafe-inline' ${source}`,
          `style-src 'unsafe-inline' ${source} https://fonts.googleapis.com`,
          `img-src data: blob: ${source}`,
          `font-src data: ${source} https://fonts.gstatic.com`,
          `media-src data: blob: ${source}`,
          `connect-src ${source}`,
          "object-src 'none'",
          "frame-src 'none'",
          "base-uri 'none'",
          "form-action 'none'",
        ].join("; "),
      );
      return context.body(new Uint8Array(file.contents));
    } catch {
      return context.text("Not found", 404);
    }
  });

  return (root, entry) => {
    for (const [id, session] of sessions) {
      if (session.expiresAt <= Date.now() || session.workspaceRoot !== root) {
        sessions.delete(id);
      }
    }
    let bytes = [...sessions.values()].reduce(
      (sum, session) => sum + session.entry.sizeBytes,
      entry.sizeBytes,
    );
    while (sessions.size >= MAX_SESSIONS || bytes > MAX_RETAINED_BYTES) {
      const id = sessions.keys().next().value!;
      bytes -= sessions.get(id)!.entry.sizeBytes;
      sessions.delete(id);
    }
    const id = randomBytes(24).toString("hex");
    sessions.set(id, {
      workspaceRoot: root,
      directory: path.dirname(entry.path),
      entry,
      expiresAt: Date.now() + SESSION_LIFETIME_MS,
    });
    return `${PREFIX}${id}/${encodeURIComponent(entry.filename)}`;
  };
}
