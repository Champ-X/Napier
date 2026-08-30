import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import {
  inspectSandboxInstallationBinding,
  loadSandboxInstallation,
  removeSandboxInstallation,
  saveSandboxInstallation,
} from "../src/sandbox-installation.js";
import type { ContainerImageIdentity } from "../src/sandbox-container-runtime.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";

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

  it("lets explicit host-direct recovery override a persisted OCI binding", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-sandbox-install-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "data");
    await Promise.all([mkdir(workspaceRoot), mkdir(dataRoot)]);
    const installation = await saveSandboxInstallation(
      dataRoot,
      "napier-sandbox:0.1.0",
      identity(),
    );

    const runtime = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      env: { NAPIER_HOST_DIRECT_SANDBOX: "1" },
    });
    try {
      expect(runtime.sandbox.id).toBe("host-direct");
      expect(await loadSandboxInstallation(dataRoot)).toEqual(installation);
    } finally {
      await runtime.shutdown();
    }
  });

  it("persists and reloads external release provenance without breaking schema 1", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-sandbox-install-"));
    roots.push(root);
    const digest = `sha256:${"f".repeat(64)}`;
    const installation = await saveSandboxInstallation(
      root,
      `ghcr.io/champ-x/napier-sandbox@${digest}`,
      identity(),
      new Date("2026-08-12T00:00:00.000Z"),
      {
        acquisition: "external_release",
        releaseDigest: digest,
        releaseSourceSha: "a".repeat(40),
        releaseReceiptSha256: "b".repeat(64),
      },
    );

    expect(installation).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        acquisition: "external_release",
        releaseDigest: digest,
      }),
    );
    await expect(loadSandboxInstallation(root)).resolves.toEqual(installation);

    const legacy = await saveSandboxInstallation(
      path.join(root, "legacy"),
      "napier-sandbox:0.1.0",
      identity(),
    );
    expect(legacy.schemaVersion).toBe(1);
    await expect(
      loadSandboxInstallation(path.join(root, "legacy")),
    ).resolves.toEqual(legacy);
  });

  it("rejects release provenance that does not match its digest-qualified reference", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-sandbox-install-"));
    roots.push(root);
    const digest = `sha256:${"f".repeat(64)}`;
    const installation = await saveSandboxInstallation(
      root,
      `ghcr.io/champ-x/napier-sandbox@${digest}`,
      identity(),
      new Date("2026-08-12T00:00:00.000Z"),
      {
        acquisition: "external_release",
        releaseDigest: digest,
        releaseSourceSha: "a".repeat(40),
        releaseReceiptSha256: "b".repeat(64),
      },
    );
    const drifted = {
      ...installation,
      imageReference: `ghcr.io/champ-x/napier-sandbox@sha256:${"e".repeat(64)}`,
    };
    const { contentSha256: _contentSha256, ...content } = drifted;
    drifted.contentSha256 = sha256(canonicalJson(content));
    await writeFile(
      path.join(root, "sandbox.json"),
      `${JSON.stringify(drifted)}\n`,
    );

    await expect(loadSandboxInstallation(root)).rejects.toThrow(
      "provenance is invalid",
    );
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

  it("removes only the exact persisted binding and leaves its directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-sandbox-install-"));
    roots.push(root);
    const installation = await saveSandboxInstallation(
      root,
      "napier-sandbox:0.1.0",
      identity(),
    );

    const binding = await inspectSandboxInstallationBinding(root);
    await removeSandboxInstallation(root, binding.bindingSha256!);

    await expect(loadSandboxInstallation(root)).resolves.toBeUndefined();
    await expect(stat(root)).resolves.toEqual(
      expect.objectContaining({ isDirectory: expect.any(Function) }),
    );
  });

  it("restores a drifted binding when uninstall CAS validation fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-sandbox-install-"));
    roots.push(root);
    const installation = await saveSandboxInstallation(
      root,
      "napier-sandbox:0.1.0",
      identity(),
    );
    const filePath = path.join(root, "sandbox.json");
    await writeFile(
      filePath,
      `${JSON.stringify({ ...installation, verifiedAt: new Date().toISOString() })}\n`,
      "utf8",
    );

    await expect(
      removeSandboxInstallation(root, installation.contentSha256),
    ).rejects.toThrow();
    await expect(access(filePath)).resolves.toBeUndefined();
  });

  it("starts fail closed with an invalid binding and exact-removes it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-sandbox-install-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "data");
    await Promise.all([mkdir(workspaceRoot), mkdir(dataRoot)]);
    await writeFile(path.join(dataRoot, "sandbox.json"), '{"broken":true}\n');

    const runtime = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      env: {},
    });
    try {
      expect(runtime.sandbox.id).toBe("configured-sandbox-invalid");
      const preview = await runtime.sandboxSetup.uninstallPreview();
      expect(preview).toEqual(
        expect.objectContaining({
          status: "invalid",
          active: false,
          imageRetained: true,
          bindingSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      );

      const result = await runtime.sandboxSetup.uninstall({
        expectedPreviewSha256: preview.contentSha256,
      });
      expect(result).toEqual(
        expect.objectContaining({
          action: "uninstalled",
          bindingSha256: preview.bindingSha256,
        }),
      );
      expect("imageId" in result).toBe(false);
      expect(runtime.sandbox.id).not.toBe("configured-sandbox-invalid");
      await expect(
        access(path.join(dataRoot, "sandbox.json")),
      ).rejects.toThrow();
    } finally {
      await runtime.shutdown();
    }
  });

  it("recovers a single interrupted uninstall tombstone on restart", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-sandbox-install-"));
    roots.push(root);
    const installation = await saveSandboxInstallation(
      root,
      "napier-sandbox:0.1.0",
      identity(),
    );
    const filePath = path.join(root, "sandbox.json");
    await rename(
      filePath,
      path.join(root, "sandbox.json.1234.0123456789abcdef.remove"),
    );

    await expect(loadSandboxInstallation(root)).resolves.toEqual(installation);
    await expect(access(filePath)).resolves.toBeUndefined();
  });

  it("never grants automatic removal authority to a symlink binding", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-sandbox-install-"));
    roots.push(root);
    const target = path.join(root, "external.json");
    await writeFile(target, "{}\n");
    await symlink(target, path.join(root, "sandbox.json"));

    await expect(inspectSandboxInstallationBinding(root)).resolves.toEqual({
      status: "invalid",
    });
  });
});

function identity(): ContainerImageIdentity {
  return {
    imageId: `sha256:${"a".repeat(64)}`,
    imagePlatform: "linux/arm64",
    clientExecutable: process.execPath,
    clientExecutableSha256: "b".repeat(64),
    daemon: {
      location: "local",
      endpointSha256: "c".repeat(64),
    },
    user: {
      userId: 501,
      groupId: 20,
      mapping: "injected",
      identitySha256: "d".repeat(64),
    },
    identitySha256: "e".repeat(64),
  };
}
