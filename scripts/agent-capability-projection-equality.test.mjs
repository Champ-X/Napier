import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../apps/cli/dist/cli.js";
import { createApp, createServices } from "../apps/server/dist/app.js";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent capability projection parity", () => {
  it("returns the identical deterministic projection through CLI and Web HTTP on one persisted sentinel Store", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-projection-parity-"),
    );
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);
    const applied = await runCapabilityCli(
      [
        "capabilities",
        "--workspace",
        workspaceRoot,
        "--data-root",
        dataRoot,
        "--preset",
        "browser",
        "--apply",
        "--jsonl",
      ],
      root,
    );
    expect(applied).toEqual(
      expect.objectContaining({ action: "applied", agentRevision: 2 }),
    );
    const storeIdentity = await realpath(dataRoot);
    const beforeHttpSha256 = await sha256File(
      path.join(storeIdentity, "workspace.json"),
    );
    const cli = await runCapabilityCli(
      [
        "capabilities",
        "--workspace",
        workspaceRoot,
        "--data-root",
        storeIdentity,
        "--jsonl",
      ],
      root,
    );
    expect(cli.schemaVersion).toBe(1);
    expect(cli.action).toBe("status");
    expect(cli.projection).toEqual(
      expect.objectContaining({
        agentId: cli.agentId,
        agentRevision: cli.agentRevision,
      }),
    );

    const services = await createServices({
      workspaceRoot,
      dataRoot: storeIdentity,
      env: {},
    });
    try {
      const response = await createApp(services).request(
        `/api/agents/${cli.agentId}/capabilities`,
      );
      expect(response.status).toBe(200);
      const web = await response.json();
      expect(web).toEqual(cli.projection);
      expect(web.projectionSha256).toBe(cli.projection.projectionSha256);
    } finally {
      await services.shutdownLocalRuntime();
    }
    expect(await sha256File(path.join(storeIdentity, "workspace.json"))).toBe(
      beforeHttpSha256,
    );
  });
});

async function runCapabilityCli(args, cwd) {
  const stdout = new CaptureWritable();
  const stderr = new CaptureWritable();
  expect(
    await runCli(args, { cwd, env: {}, stdout, stderr }),
  ).toBe(0);
  expect(stderr.text()).toBe("");
  return JSON.parse(stdout.text());
}

async function sha256File(filePath) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

class CaptureWritable extends Writable {
  chunks = [];

  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  text() {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}
