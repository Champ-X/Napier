import { PassThrough } from "node:stream";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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

describe("Thread Run readiness HTTP", () => {
  it("blocks process modes before Run creation and recovers after exact Setup", async () => {
    const fixture = await createFixture();
    const services = await createServices({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      env: {},
      sandbox: new UnsupportedSandboxAdapter("readiness-http-before"),
      sandboxSetup: setupDependencies(),
    });
    openServices.push(services);
    const app = createApp(services);
    const thread = await services.store.createThread({
      title: "Readiness-gated task",
      agentId: services.store.listAgents()[0]!.id,
    });

    for (const capabilityPreset of ["coding", "safe_automation"] as const) {
      const blocked = await prompt(app, thread.id, capabilityPreset);
      expect(blocked.status).toBe(409);
      expect(blocked.headers.get("cache-control")).toBe("no-store");
      expect(blocked.headers.get("x-napier-run-readiness")).toBe(
        "sandbox_unavailable",
      );
      expect(blocked.headers.get("content-type")).toContain("application/json");
      expect(blocked.headers.get("x-napier-error-code")).toBe("conflict");
      expect(
        blocked.headers.get("x-napier-agent-capability-projection-sha256"),
      ).toMatch(/^[a-f0-9]{64}$/u);
      const errorBody = await blocked.json();
      expect(errorBody).toEqual({
        error: expect.stringContaining(
          "napier setup --workspace 'WORKSPACE_PATH' --component sandbox",
        ),
      });
      expect(blocked.headers.get("x-napier-content-sha256")).toBe(
        sha256(JSON.stringify(errorBody)),
      );
      expect(blocked.headers.get("x-napier-error-message-sha256")).toBe(
        sha256(errorBody.error),
      );
      expect(services.store.listRuns(thread.id)).toHaveLength(0);
    }

    const research = await prompt(app, thread.id, "research");
    expect(research.status).toBe(200);
    await research.text();
    expect(services.store.listRuns(thread.id)).toHaveLength(1);

    const preview = await (await app.request("/api/setup/sandbox")).json();
    const applied = await app.request("/api/setup/sandbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedPreviewSha256: preview.contentSha256,
      }),
    });
    expect(applied.status).toBe(200);

    const recovered = await prompt(app, thread.id, "coding");
    expect(recovered.status).toBe(200);
    await recovered.text();
    expect(services.store.listRuns(thread.id)).toHaveLength(2);
  });

  it("requires exact invalid-binding removal before ordinary Setup and Run recovery", async () => {
    const fixture = await createFixture();
    await mkdir(fixture.dataRoot);
    await writeFile(
      path.join(fixture.dataRoot, "sandbox.json"),
      '{"broken":true}\n',
    );
    const services = await createServices({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      env: {},
      sandboxSetup: setupDependencies(),
    });
    openServices.push(services);
    const app = createApp(services);
    const thread = await services.store.createThread({
      title: "Invalid Sandbox recovery",
      agentId: services.store.listAgents()[0]!.id,
    });

    const blocked = await prompt(app, thread.id, "coding");
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({
      error: expect.stringContaining("--component sandbox --uninstall"),
    });
    expect(services.store.listRuns(thread.id)).toHaveLength(0);

    const setupPreview = await (await app.request("/api/setup/sandbox")).json();
    const unsafeReplace = await app.request("/api/setup/sandbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedPreviewSha256: setupPreview.contentSha256,
      }),
    });
    expect(unsafeReplace.status).toBe(409);
    expect(await unsafeReplace.json()).toEqual({
      error: expect.stringContaining("must be exact-uninstalled before setup"),
    });

    const uninstallPreview = await (
      await app.request("/api/setup/sandbox/uninstall")
    ).json();
    expect(uninstallPreview).toEqual(
      expect.objectContaining({
        status: "invalid",
        active: false,
        bindingSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const removed = await app.request("/api/setup/sandbox/uninstall", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedPreviewSha256: uninstallPreview.contentSha256,
      }),
    });
    expect(removed.status).toBe(200);

    const applied = await app.request("/api/setup/sandbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedPreviewSha256: setupPreview.contentSha256,
      }),
    });
    expect(applied.status).toBe(200);

    const recovered = await prompt(app, thread.id, "coding");
    expect(recovered.status).toBe(200);
    await recovered.text();
    expect(services.store.listRuns(thread.id)).toHaveLength(1);
  });
});

async function createFixture(): Promise<{
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-run-readiness-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  return { workspaceRoot, dataRoot: path.join(root, "state") };
}

function prompt(
  app: ReturnType<typeof createApp>,
  threadId: string,
  capabilityPreset: "coding" | "research" | "safe_automation",
): Promise<Response> {
  return app.request(`/api/threads/${threadId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: "Complete one bounded task.",
      capabilityPreset,
    }),
  });
}

function setupDependencies() {
  const identity = imageIdentity();
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
        verification: "verification_ready",
        shell: "shell_ready",
        python: "python_ready",
        git: "git_ready",
        lsp: "lsp_ready",
        dap: "dap_ready",
        service: "service_ready",
      },
    }),
    activate: async () => new ReadySandboxAdapter(),
    fallback: () => new UnsupportedSandboxAdapter("readiness-http-before"),
  };
}

class ReadySandboxAdapter implements OsSandboxAdapter {
  readonly id = "readiness-http-ready";
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
