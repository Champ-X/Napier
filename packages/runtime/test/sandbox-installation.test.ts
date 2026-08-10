import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import {
  loadSandboxInstallation,
  saveSandboxInstallation,
} from "../src/sandbox-installation.js";
import type { ContainerImageIdentity } from "../src/sandbox-container-runtime.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Sandbox installation", () => {
  it("persists a private hash-bound OCI identity and activates it on restart", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-sandbox-install-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "data");
    await Promise.all([mkdir(workspaceRoot), mkdir(dataRoot)]);
    const installation = await saveSandboxInstallation(
      dataRoot,
      "napier-sandbox:0.1.0",
      identity(),
      new Date("2026-08-11T00:00:00.000Z"),
    );

    expect(await loadSandboxInstallation(dataRoot)).toEqual(installation);
    const mode = (await stat(path.join(dataRoot, "sandbox.json"))).mode;
    expect(mode & 0o777).toBe(0o600);

    const runtime = await createLocalAgentRuntime({ workspaceRoot, dataRoot });
    try {
      expect(runtime.sandbox.id).toBe("oci-container");
    } finally {
      await runtime.shutdown();
    }
  });

  it("rejects content drift instead of silently falling back", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-sandbox-install-"));
    roots.push(root);
    await saveSandboxInstallation(root, "napier-sandbox:0.1.0", identity());
    const filePath = path.join(root, "sandbox.json");
    const content = await readFile(filePath, "utf8");
    await chmod(filePath, 0o600);
    await writeFile(
      filePath,
      content.replace("napier-sandbox:0.1.0", "napier-sandbox:drifted"),
      "utf8",
    );

    await expect(loadSandboxInstallation(root)).rejects.toThrow(
      "hash mismatch",
    );
  });
});

function identity(): ContainerImageIdentity {
  return {
    imageId: `sha256:${"a".repeat(64)}`,
    clientExecutable: process.execPath,
    clientExecutableSha256: "b".repeat(64),
    daemon: {
      location: "local",
      endpointSha256: "c".repeat(64),
    },
    user: {
      userId: 501,
      groupId: 20,
      identitySha256: "d".repeat(64),
    },
    identitySha256: "e".repeat(64),
  };
}
