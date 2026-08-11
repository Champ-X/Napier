import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import type {
  SandboxSetupPreview,
  SandboxSetupResult,
  SandboxUninstallPreview,
  SandboxUninstallResult,
} from "@napier/contracts/sandbox-setup";
import type {
  OsSandboxAdapter,
  SandboxedProcess,
  SandboxLaunchRequest,
} from "@napier/runtime";
import {
  canonicalJson,
  sha256,
  UnsupportedSandboxAdapter,
} from "@napier/runtime";
import type { ContainerImageIdentity } from "@napier/runtime/sandbox-container-runtime";
import { afterEach, describe, expect, it } from "vitest";

import { createApp, createServices } from "../src/app.js";

const roots: string[] = [];
const openServices: Awaited<ReturnType<typeof createServices>>[] = [];

afterEach(async () => {
  for (const services of openServices.splice(0)) {
    await services.shutdownLocalRuntime();
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Sandbox setup HTTP", () => {
  it("applies an exact preview and hot-switches current readiness without task state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-sandbox-http-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "data");
    await mkdir(workspaceRoot);
    const services = await createServices({
      workspaceRoot,
      dataRoot,
      sandbox: new UnsupportedSandboxAdapter("sandbox-http-before"),
      sandboxSetup: dependencies(),
    });
    openServices.push(services);
    const app = createApp(services);
    const agent = services.store.listAgents()[0]!;
    const beforeThreads = services.store.listThreads();
    const beforeRevisionCount = services.store.listAgentRevisions(
      agent.id,
    ).length;

    const before = await services.agentCapabilities.project(agent.id);
    expect(sandboxRecord(before)?.status).toBe("unavailable");

    const previewResponse = await app.request("/api/setup/sandbox");
    expect(previewResponse.status).toBe(200);
    expect(previewResponse.headers.get("cache-control")).toBe("no-store");
    const preview = (await previewResponse.json()) as SandboxSetupPreview;
    expect(preview.status).toBe("ready");
    expect(preview.active).toBe(false);
    expect(previewResponse.headers.get("x-napier-content-sha256")).toBe(
      preview.contentSha256,
    );

    const invalid = await app.request("/api/setup/sandbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedPreviewSha256: preview.contentSha256,
        image: "untrusted",
      }),
    });
    expect(invalid.status).toBe(400);

    const stale = await app.request("/api/setup/sandbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedPreviewSha256: "0".repeat(64) }),
    });
    expect(stale.status).toBe(409);

    const applyResponse = await app.request("/api/setup/sandbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedPreviewSha256: preview.contentSha256,
      }),
    });
    expect(applyResponse.status).toBe(200);
    const result = (await applyResponse.json()) as SandboxSetupResult;
    expect(result).toEqual(
      expect.objectContaining({
        status: "ready",
        action: "reused",
        checks: expect.objectContaining({ shell: "shell_ready" }),
      }),
    );
    expect(applyResponse.headers.get("x-napier-content-sha256")).toBe(
      result.contentSha256,
    );
    const activePreview = (await (
      await app.request("/api/setup/sandbox")
    ).json()) as SandboxSetupPreview;
    expect(activePreview.active).toBe(true);

    const after = await services.agentCapabilities.project(agent.id);
    expect(sandboxRecord(after)).toEqual(
      expect.objectContaining({
        id: "sandbox:test-sandbox-ready",
        status: "ready",
      }),
    );
    expect(services.store.listThreads()).toEqual(beforeThreads);
    expect(services.store.getAgent(agent.id)).toEqual(agent);
    expect(services.store.listAgentRevisions(agent.id)).toHaveLength(
      beforeRevisionCount,
    );
    await expect(
      access(path.join(dataRoot, "sandbox.json")),
    ).resolves.toBeUndefined();

    const uninstallResponse = await app.request(
      "/api/setup/sandbox/uninstall",
    );
    expect(uninstallResponse.status).toBe(200);
    const uninstallPreview =
      (await uninstallResponse.json()) as SandboxUninstallPreview;
    expect(uninstallPreview).toEqual(
      expect.objectContaining({
        status: "installed",
        active: true,
        imageRetained: true,
        fallbackSandbox: "unsupported",
      }),
    );
    const staleUninstall = await app.request(
      "/api/setup/sandbox/uninstall",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedPreviewSha256: "0".repeat(64) }),
      },
    );
    expect(staleUninstall.status).toBe(409);
    await expect(
      access(path.join(dataRoot, "sandbox.json")),
    ).resolves.toBeUndefined();

    const uninstallApply = await app.request(
      "/api/setup/sandbox/uninstall",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedPreviewSha256: uninstallPreview.contentSha256,
        }),
      },
    );
    expect(uninstallApply.status).toBe(200);
    expect(
      (await uninstallApply.json()) as SandboxUninstallResult,
    ).toEqual(
      expect.objectContaining({
        action: "uninstalled",
        imageRetained: true,
        fallbackSandbox: "unsupported",
      }),
    );
    await expect(access(path.join(dataRoot, "sandbox.json"))).rejects.toThrow();
    expect(
      sandboxRecord(await services.agentCapabilities.project(agent.id)),
    ).toEqual(
      expect.objectContaining({
        id: "sandbox:unsupported",
        status: "unavailable",
      }),
    );
    expect(services.store.listThreads()).toEqual(beforeThreads);
    expect(services.store.getAgent(agent.id)).toEqual(agent);
    expect(services.store.listAgentRevisions(agent.id)).toHaveLength(
      beforeRevisionCount,
    );
  });

  it("leaves no persisted installation when hot activation fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-sandbox-http-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "data");
    await mkdir(workspaceRoot);
    const setup = dependencies();
    setup.activate = async () => {
      throw new Error("activation failed");
    };
    const services = await createServices({
      workspaceRoot,
      dataRoot,
      sandbox: new UnsupportedSandboxAdapter("sandbox-http-failure"),
      sandboxSetup: setup,
    });
    openServices.push(services);
    const app = createApp(services);
    const preview = (await (
      await app.request("/api/setup/sandbox")
    ).json()) as SandboxSetupPreview;

    const response = await app.request("/api/setup/sandbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedPreviewSha256: preview.contentSha256,
      }),
    });

    expect(response.status).toBe(409);
    await expect(access(path.join(dataRoot, "sandbox.json"))).rejects.toThrow();
    expect(
      sandboxRecord(
        await services.agentCapabilities.project(
          services.store.listAgents()[0]!.id,
        ),
      )?.status,
    ).toBe("unavailable");
  });
});

function dependencies() {
  const identity = imageIdentity();
  const installation = installationRecord(identity);
  return {
    inspect: async () => ({
      status: "ready" as const,
      identity,
      target: {
        imageReference: "napier-sandbox:0.1.0",
        dockerfileSha256: "1".repeat(64),
        contextSha256: "2".repeat(64),
        platform: process.platform,
        arch: process.arch,
      },
    }),
    verify: async () => ({
      checks: {
        node: "sandbox_process_ready",
        resources: "sandbox_resources_ready",
        shell: "shell_ready",
        python: "python_ready",
        git: "git_ready",
        lsp: "lsp_ready",
        dap: "dap_ready",
        service: "service_ready",
      },
    }),
    activate: async () => new ReadySandboxAdapter(),
    fallback: () =>
      new UnsupportedSandboxAdapter("sandbox-http-before"),
  };
}

class ReadySandboxAdapter implements OsSandboxAdapter {
  readonly id = "test-sandbox-ready";
  readonly setupIdentitySha256 = "e".repeat(64);

  async launch(_request: SandboxLaunchRequest): Promise<SandboxedProcess> {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    queueMicrotask(() => {
      stdout.end("napier_shell_probe_v1");
      stderr.end();
    });
    return {
      stdin,
      stdout,
      stderr,
      exit: Promise.resolve({ code: 0, signal: null }),
      terminate: async () => undefined,
    };
  }
}

function sandboxRecord(projection: {
  readiness: Array<{ id: string; status: string }>;
}) {
  return projection.readiness.find((record) =>
    record.id.startsWith("sandbox:"),
  );
}

function imageIdentity(): ContainerImageIdentity {
  return {
    imageId: `sha256:${"a".repeat(64)}`,
    clientExecutable: process.execPath,
    clientExecutableSha256: "b".repeat(64),
    daemon: { location: "local", endpointSha256: "c".repeat(64) },
    user: {
      userId: 501,
      groupId: 20,
      identitySha256: "d".repeat(64),
    },
    identitySha256: "e".repeat(64),
  };
}

function installationRecord(identity: ContainerImageIdentity) {
  const withoutHash = {
    kind: "napier.sandbox-installation" as const,
    schemaVersion: 1 as const,
    provider: "oci-container" as const,
    imageReference: "napier-sandbox:0.1.0",
    imageId: identity.imageId,
    clientExecutableSha256: identity.clientExecutableSha256,
    daemonEndpointSha256: identity.daemon.endpointSha256,
    userIdentitySha256: identity.user.identitySha256,
    identitySha256: identity.identitySha256,
    verifiedAt: "2026-08-11T00:00:00.000Z",
  };
  return {
    ...withoutHash,
    contentSha256: sha256(canonicalJson(withoutHash)),
  };
}
