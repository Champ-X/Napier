import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
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
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("recent workspaces registry", () => {
  it("returns empty before anything is recorded", async () => {
    expect(await readRecentWorkspaces()).toEqual([]);
  });

  it("records a stable, de-duplicated order with derived names", async () => {
    const alpha = path.join(
      process.env["NAPIER_STATE_HOME"]!,
      "projects",
      "alpha",
    );
    const beta = path.join(
      process.env["NAPIER_STATE_HOME"]!,
      "projects",
      "beta",
    );
    await Promise.all([
      mkdir(alpha, { recursive: true }),
      mkdir(beta, { recursive: true }),
    ]);
    await recordRecentWorkspace(alpha);
    await recordRecentWorkspace(beta);
    await recordRecentWorkspace(alpha);

    const recent = await readRecentWorkspaces();
    const canonicalAlpha = await realpath(alpha);
    const canonicalBeta = await realpath(beta);
    expect(recent.map((entry) => entry.root)).toEqual([
      canonicalAlpha,
      canonicalBeta,
    ]);
    expect(recent[0]?.name).toBe("alpha");
  });

  it("ignores relative paths", async () => {
    await recordRecentWorkspace("relative/dir");
    expect(await readRecentWorkspaces()).toEqual([]);
  });

  it("serves the recent list over HTTP", async () => {
    const gamma = path.join(
      process.env["NAPIER_STATE_HOME"]!,
      "projects",
      "gamma",
    );
    await mkdir(gamma, { recursive: true });
    await recordRecentWorkspace(gamma);
    const app = new Hono();
    registerRecentWorkspacesHttp(app);

    const response = await app.request("/api/workspace/recent");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<{ root: string }>;
    expect(body[0]?.root).toBe(await realpath(gamma));
    expect(response.headers.get("x-napier-content-sha256")).toBeTruthy();
  });

  it("serves thread summaries only for registered workspace roots", async () => {
    const root = path.join(
      process.env["NAPIER_STATE_HOME"]!,
      "projects",
      "threaded",
    );
    const other = path.join(
      process.env["NAPIER_STATE_HOME"]!,
      "projects",
      "other",
    );
    await Promise.all([
      mkdir(root, { recursive: true }),
      mkdir(other, { recursive: true }),
    ]);
    await recordRecentWorkspace(root);
    const app = new Hono();
    registerRecentWorkspacesHttp(app, async (workspaceRoot) => [
      {
        id: "thread_1",
        title: path.basename(workspaceRoot),
        agentId: "agent_1",
        status: "idle",
        createdAt: "2026-08-18T00:00:00.000Z",
        updatedAt: "2026-08-18T00:00:00.000Z",
        lastMessage: "Ready",
        eventCount: 1,
      },
    ]);

    const response = await app.request(
      `/api/workspace/threads?root=${encodeURIComponent(root)}`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([{ title: "threaded" }]);
    expect(response.headers.get("x-napier-content-sha256")).toBeTruthy();

    const rejected = await app.request(
      `/api/workspace/threads?root=${encodeURIComponent(other)}`,
    );
    expect(rejected.status).toBe(404);
  });

  it("prunes missing and transient Napier workspaces from the persisted registry", async () => {
    const stateHome = process.env["NAPIER_STATE_HOME"]!;
    const durable = path.join(stateHome, "projects", "durable");
    await mkdir(durable, { recursive: true });
    await mkdir(stateHome, { recursive: true });
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(
        path.join(stateHome, "recent-workspaces.json"),
        JSON.stringify([
          {
            root: durable,
            name: "durable",
            lastOpenedAt: "2026-08-18T00:00:00.000Z",
          },
          {
            root: path.join(stateHome, "missing"),
            name: "missing",
            lastOpenedAt: "2026-08-17T00:00:00.000Z",
          },
          {
            root: path.join(
              tmpdir(),
              "napier-sdk-production-trace-fixture",
              "workspace",
            ),
            name: "workspace",
            lastOpenedAt: "2026-08-16T00:00:00.000Z",
          },
        ]),
        "utf8",
      ),
    );

    const canonicalDurable = await realpath(durable);
    expect((await readRecentWorkspaces()).map((entry) => entry.root)).toEqual([
      canonicalDurable,
    ]);
    const persisted = JSON.parse(
      await readFile(path.join(stateHome, "recent-workspaces.json"), "utf8"),
    ) as Array<{ root: string }>;
    expect(persisted.map((entry) => entry.root)).toEqual([canonicalDurable]);
  });
});
