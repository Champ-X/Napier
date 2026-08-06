import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
  it("returns the identical deterministic projection through CLI and Web HTTP", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-projection-parity-"),
    );
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();
    const code = await runCli(
      [
        "capabilities",
        "--workspace",
        workspaceRoot,
        "--data-root",
        dataRoot,
        "--jsonl",
      ],
      { cwd: root, env: {}, stdout, stderr },
    );
    expect(code).toBe(0);
    expect(stderr.text()).toBe("");
    const cli = JSON.parse(stdout.text());
    expect(cli.schemaVersion).toBe(1);
    expect(cli.action).toBe("status");
    expect(cli.projection).toEqual(
      expect.objectContaining({
        agentId: cli.agentId,
        agentRevision: cli.agentRevision,
      }),
    );

    const services = await createServices({ workspaceRoot, dataRoot, env: {} });
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
  });
});

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
