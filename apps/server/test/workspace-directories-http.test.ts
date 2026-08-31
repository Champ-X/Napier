import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  listWorkspaceDirectory,
  readWorkspaceFilePreview,
  registerWorkspaceDirectoriesHttp,
} from "../src/workspace-directories-http.js";

const temporaryRoots: string[] = [];
let base = "";

beforeEach(async () => {
  const created = await mkdtemp(path.join(tmpdir(), "napier-directories-"));
  temporaryRoots.push(created);
  // macOS routes tmpdir() through the /var -> /private/var symlink; the
  // endpoint canonicalizes via realpath, so the test must compare against the
  // canonical base too.
  base = await realpath(created);
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("workspace directory listing", () => {
  it("returns only subdirectories, sorted, hiding dotfolders and files", async () => {
    await mkdir(path.join(base, "beta"));
    await mkdir(path.join(base, "alpha"));
    await mkdir(path.join(base, ".hidden"));
    await writeFile(path.join(base, "note.txt"), "x", "utf8");

    const listing = await listWorkspaceDirectory(base);

    expect(listing.entries.map((entry) => entry.name)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(listing.entries[0]?.path).toBe(path.join(base, "alpha"));
    expect(listing.entries[0]?.kind).toBe("directory");
    expect(listing.parent).toBe(path.dirname(base));
    expect(listing.truncated).toBe(false);
  });

  it("includes files after directories for the workspace file-tree mode", async () => {
    await mkdir(path.join(base, "src"));
    await writeFile(path.join(base, "zeta.ts"), "z", "utf8");
    await writeFile(path.join(base, "alpha.md"), "a", "utf8");
    await writeFile(path.join(base, ".secret"), "hidden", "utf8");

    const listing = await listWorkspaceDirectory(base, true);

    expect(listing.entries.map(({ name, kind }) => [name, kind])).toEqual([
      ["src", "directory"],
      ["alpha.md", "file"],
      ["zeta.ts", "file"],
    ]);
  });

  it("paginates large folders without permanently dropping later entries", async () => {
    await Promise.all(
      Array.from({ length: 205 }, (_, index) =>
        writeFile(
          path.join(base, `file-${String(index).padStart(3, "0")}.txt`),
          "x",
          "utf8",
        ),
      ),
    );

    const first = await listWorkspaceDirectory(base, true, base);
    expect(first.entries).toHaveLength(200);
    expect(first.truncated).toBe(true);
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/u);

    const second = await listWorkspaceDirectory(
      base,
      true,
      base,
      first.nextCursor,
    );
    expect(second.entries).toHaveLength(5);
    expect(second.truncated).toBe(false);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...first.entries, ...second.entries].map((entry) => entry.path))
        .size,
    ).toBe(205);
  });

  it("reports a null parent at the filesystem root", async () => {
    const listing = await listWorkspaceDirectory("/");
    expect(listing.path).toBe("/");
    expect(listing.parent).toBeNull();
  });

  it("canonicalizes symlinked targets", async () => {
    const real = path.join(base, "real");
    const link = path.join(base, "link");
    await mkdir(real);
    await mkdir(path.join(real, "child"));
    await symlink(real, link);

    const listing = await listWorkspaceDirectory(link);
    // realpath resolves the symlink, so the returned path is the canonical one.
    expect(listing.path).toBe(await realpath(real));
    expect(listing.entries.map((entry) => entry.name)).toEqual(["child"]);
  });

  it("accepts the active workspace through its lexical symlink alias", async () => {
    const real = path.join(base, "real-root");
    const link = path.join(base, "linked-root");
    await mkdir(real);
    await mkdir(path.join(real, "child"));
    await symlink(real, link);

    const listing = await listWorkspaceDirectory(link, true, link);
    expect(listing.path).toBe(await realpath(real));
    expect(listing.entries.map((entry) => entry.name)).toEqual(["child"]);
  });

  it("preserves legal spaces at the edge of a directory name", async () => {
    const spaced = path.join(base, "folder ");
    await mkdir(spaced);

    await expect(listWorkspaceDirectory(spaced, true, base)).resolves.toEqual(
      expect.objectContaining({ path: await realpath(spaced) }),
    );
  });

  it("contains file-tree browsing to the active workspace", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "napier-outside-"));
    temporaryRoots.push(outside);
    const outsideFile = path.join(outside, "outside.txt");
    await writeFile(outsideFile, "outside", "utf8");

    for (const target of [
      outside,
      outsideFile,
      path.join(outside, "missing"),
    ]) {
      await expect(listWorkspaceDirectory(target, true, base)).rejects.toThrow(
        "outside the active workspace",
      );
    }
    await expect(listWorkspaceDirectory(base, true, base)).resolves.toEqual(
      expect.objectContaining({ path: base, parent: null }),
    );
  });

  it("rejects an unknown pagination cursor", async () => {
    await expect(
      listWorkspaceDirectory(
        base,
        true,
        base,
        Buffer.from(path.join(base, "missing.txt"), "utf8").toString(
          "base64url",
        ),
      ),
    ).rejects.toThrow("cursor is invalid");
  });

  it("serves listings over HTTP with a content hash header", async () => {
    await mkdir(path.join(base, "child"));
    const app = new Hono();
    registerWorkspaceDirectoriesHttp(app);

    const response = await app.request(
      `/api/workspace/directories?path=${encodeURIComponent(base)}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      entries: Array<{ name: string }>;
    };
    expect(body.entries.map((entry) => entry.name)).toEqual(["child"]);
    expect(response.headers.get("x-napier-content-sha256")).toBeTruthy();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("serves files when the file-tree mode is requested", async () => {
    await writeFile(path.join(base, "README.md"), "read me", "utf8");
    const app = new Hono();
    registerWorkspaceDirectoriesHttp(app);

    const response = await app.request(
      `/api/workspace/directories?path=${encodeURIComponent(base)}&files=1`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      entries: Array<{ name: string; kind: string }>;
    };
    expect(body.entries).toEqual([
      expect.objectContaining({ name: "README.md", kind: "file" }),
    ]);
  });

  it("previews a regular file inside the active workspace", async () => {
    const file = path.join(base, "preview.html");
    await writeFile(file, "<main>preview</main>", "utf8");

    const preview = await readWorkspaceFilePreview(file, base);

    expect(preview.path).toBe(file);
    expect(preview.contentType).toBe("text/html; charset=utf-8");
    expect(preview.contents.toString("utf8")).toBe("<main>preview</main>");
    expect(preview.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("serves an integrity-bound workspace file preview over HTTP", async () => {
    const file = path.join(base, "preview.png");
    const contents = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await writeFile(file, contents);
    const app = new Hono();
    registerWorkspaceDirectoriesHttp(app, undefined, () => base);

    const response = await app.request(
      `/api/workspace/file?path=${encodeURIComponent(file)}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toContain(
      'inline; filename="preview.png"',
    );
    expect(response.headers.get("x-napier-content-sha256")).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(contents);
  });

  it("rejects workspace file previews outside the active root", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "napier-outside-file-"));
    temporaryRoots.push(outside);
    const file = path.join(outside, "outside.txt");
    await writeFile(file, "outside", "utf8");

    await expect(readWorkspaceFilePreview(file, base)).rejects.toThrow(
      "outside the active workspace",
    );
    const app = new Hono();
    registerWorkspaceDirectoriesHttp(app, undefined, () => base);
    const response = await app.request(
      `/api/workspace/file?path=${encodeURIComponent(file)}`,
    );
    expect(response.status).toBe(403);
  });

  it("opens the native directory picker without a custom browser dialog", async () => {
    const app = new Hono();
    registerWorkspaceDirectoriesHttp(app, async () => ({
      cancelled: false,
      path: base,
    }));

    const response = await app.request("/api/workspace/directory-picker", {
      method: "POST",
      headers: { "X-Napier-Intent": "choose-workspace" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cancelled: false, path: base });
    expect(response.headers.get("x-napier-content-sha256")).toBeTruthy();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("treats closing the native directory picker as a quiet cancellation", async () => {
    const app = new Hono();
    registerWorkspaceDirectoriesHttp(app, async () => ({ cancelled: true }));

    const response = await app.request("/api/workspace/directory-picker", {
      method: "POST",
      headers: { "X-Napier-Intent": "choose-workspace" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cancelled: true });
  });

  it("rejects picker requests without an explicit same-app intent", async () => {
    const app = new Hono();
    registerWorkspaceDirectoriesHttp(app, async () => ({ cancelled: true }));

    const response = await app.request("/api/workspace/directory-picker", {
      method: "POST",
    });

    expect(response.status).toBe(403);
  });

  it("rejects browser requests explicitly marked as cross-site", async () => {
    const app = new Hono();
    registerWorkspaceDirectoriesHttp(app, async () => ({ cancelled: true }));

    const response = await app.request("/api/workspace/directory-picker", {
      method: "POST",
      headers: {
        "Sec-Fetch-Site": "cross-site",
        "X-Napier-Intent": "choose-workspace",
      },
    });

    expect(response.status).toBe(403);
  });

  it("rejects a non-local Origin even when browser metadata is forged", async () => {
    const app = new Hono();
    registerWorkspaceDirectoriesHttp(app, async () => ({ cancelled: true }));

    const response = await app.request("/api/workspace/directory-picker", {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "same-origin",
        "X-Napier-Intent": "choose-workspace",
      },
    });

    expect(response.status).toBe(403);
  });

  it("allows only one native picker at a time", async () => {
    let release!: (result: { cancelled: true }) => void;
    const pending = new Promise<{ cancelled: true }>((resolve) => {
      release = resolve;
    });
    const app = new Hono();
    registerWorkspaceDirectoriesHttp(app, () => pending);
    const request = {
      method: "POST",
      headers: { "X-Napier-Intent": "choose-workspace" },
    } as const;

    const first = app.request("/api/workspace/directory-picker", request);
    await Promise.resolve();
    const second = await app.request(
      "/api/workspace/directory-picker",
      request,
    );

    expect(second.status).toBe(409);
    release({ cancelled: true });
    expect((await first).status).toBe(200);
  });

  it("rejects a relative path with 400", async () => {
    const app = new Hono();
    registerWorkspaceDirectoriesHttp(app);
    const response = await app.request(
      "/api/workspace/directories?path=relative/dir",
    );
    expect(response.status).toBe(400);
  });

  it("returns 404 for a missing directory", async () => {
    const app = new Hono();
    registerWorkspaceDirectoriesHttp(app);
    const response = await app.request(
      `/api/workspace/directories?path=${encodeURIComponent(
        path.join(base, "does-not-exist"),
      )}`,
    );
    expect(response.status).toBe(404);
  });

  it("returns 400 when the path is a file", async () => {
    const file = path.join(base, "note.txt");
    await writeFile(file, "x", "utf8");
    const app = new Hono();
    registerWorkspaceDirectoriesHttp(app);
    const response = await app.request(
      `/api/workspace/directories?path=${encodeURIComponent(file)}`,
    );
    expect(response.status).toBe(400);
  });
});
