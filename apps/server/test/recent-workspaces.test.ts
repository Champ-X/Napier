import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readRecentWorkspaces,
  recordRecentWorkspace,
  registerRecentWorkspacesHttp,
} from "../src/recent-workspaces.js";

const temporaryRoots: string[] = [];
let previousStateHome: string | undefined;

beforeEach(async () => {
  previousStateHome = process.env["NAPIER_STATE_HOME"];
  const home = await mkdtemp(path.join(tmpdir(), "napier-recent-"));
  temporaryRoots.push(home);
  process.env["NAPIER_STATE_HOME"] = home;
});

afterEach(async () => {
  if (previousStateHome === undefined) delete process.env["NAPIER_STATE_HOME"];
  else process.env["NAPIER_STATE_HOME"] = previousStateHome;
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("recent workspaces registry", () => {
  it("returns empty before anything is recorded", async () => {
    expect(await readRecentWorkspaces()).toEqual([]);
  });

  it("records most-recent-first, de-duplicated, with derived names", async () => {
    await recordRecentWorkspace("/Users/x/projects/alpha");
    await recordRecentWorkspace("/Users/x/projects/beta");
    await recordRecentWorkspace("/Users/x/projects/alpha");

    const recent = await readRecentWorkspaces();
    expect(recent.map((entry) => entry.root)).toEqual([
      "/Users/x/projects/alpha",
      "/Users/x/projects/beta",
    ]);
    expect(recent[0]?.name).toBe("alpha");
  });

  it("ignores relative paths", async () => {
    await recordRecentWorkspace("relative/dir");
    expect(await readRecentWorkspaces()).toEqual([]);
  });

  it("serves the recent list over HTTP", async () => {
    await recordRecentWorkspace("/Users/x/projects/gamma");
    const app = new Hono();
    registerRecentWorkspacesHttp(app);

    const response = await app.request("/api/workspace/recent");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<{ root: string }>;
    expect(body[0]?.root).toBe("/Users/x/projects/gamma");
    expect(response.headers.get("x-napier-content-sha256")).toBeTruthy();
  });
});
