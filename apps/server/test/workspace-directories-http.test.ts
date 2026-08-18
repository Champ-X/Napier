import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  listWorkspaceDirectory,
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
    expect(listing.parent).toBe(path.dirname(base));
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
