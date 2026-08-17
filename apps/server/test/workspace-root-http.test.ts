import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import type { BootstrapResponse, WorkspaceSummary } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  createApp,
  createServices as createNapierServices,
  type NapierServices,
} from "../src/app.js";
import { processReadySandbox } from "./process-run-readiness-test-fixture.js";

const temporaryRoots: string[] = [];
const openServices: NapierServices[] = [];

async function createServices(
  options: Parameters<typeof createNapierServices>[0],
): Promise<NapierServices> {
  const services = await createNapierServices({
    sandbox: processReadySandbox("workspace-rebind-readiness"),
    ...options,
  });
  openServices.push(services);
  return services;
}

async function stopServices(services: NapierServices): Promise<void> {
  await services.recovery.stop();
  await services.automation.stop();
  await services.channels.stop();
  await services.workspaceProcesses.shutdown();
  await services.extensions.shutdown();
  services.store.close();
}

afterEach(async () => {
  for (const services of openServices.splice(0)) {
    await stopServices(services).catch(() => undefined);
  }
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function responseSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

interface RebindFixture {
  app(): ReturnType<typeof createApp>;
  currentRoot(): string;
  root: string;
}

async function scaffold(): Promise<RebindFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-rebind-server-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace-a");
  await mkdir(workspaceRoot, { recursive: true });
  let services = await createServices({
    dataRoot: path.join(root, "data-a"),
    workspaceRoot,
  });
  let app = createApp(services, { rebindWorkspace });
  // Mirror index.ts: teardown current graph, rebuild on the new root.
  async function rebindWorkspace(absoluteRoot: string): Promise<WorkspaceSummary> {
    const previous = services;
    const index = openServices.indexOf(previous);
    if (index >= 0) openServices.splice(index, 1);
    await stopServices(previous);
    services = await createServices({
      dataRoot: path.join(absoluteRoot, ".napier"),
      workspaceRoot: absoluteRoot,
    });
    app = createApp(services, { rebindWorkspace });
    return services.store.getWorkspaceSummary();
  }
  return {
    app: () => app,
    currentRoot: () => services.store.getWorkspaceSummary().root,
    root,
  };
}

describe("workspace root rebind endpoint", () => {
  it("rebinds to a new folder and the next bootstrap reflects it", async () => {
    const fixture = await scaffold();
    const nextRoot = path.join(fixture.root, "workspace-b");
    await mkdir(nextRoot, { recursive: true });

    const response = await fixture.app().request("/api/workspace/root", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root: nextRoot }),
    });
    expect(response.status).toBe(200);
    const summary = (await response.json()) as WorkspaceSummary;
    expect(summary.root).toBe(await realpathOf(nextRoot));
    expect(response.headers.get("x-napier-content-sha256")).toBe(
      responseSha256(summary),
    );

    const bootstrap = await fixture.app().request("/api/bootstrap");
    const body = (await bootstrap.json()) as BootstrapResponse;
    expect(body.workspace.root).toBe(await realpathOf(nextRoot));
  });

  it("rejects a non-existent folder with 404 and a relative path with 400", async () => {
    const fixture = await scaffold();
    const missing = await fixture.app().request("/api/workspace/root", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root: path.join(fixture.root, "does-not-exist") }),
    });
    expect(missing.status).toBe(404);

    const relative = await fixture.app().request("/api/workspace/root", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root: "relative/dir" }),
    });
    expect(relative.status).toBe(400);
  });

  it("rejects rebinding to the current root with 409", async () => {
    const fixture = await scaffold();
    const current = fixture.currentRoot();
    const response = await fixture.app().request("/api/workspace/root", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root: current }),
    });
    expect(response.status).toBe(409);
  });

  it("returns 409 when the runtime provides no rebind capability", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-rebind-server-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot,
    });
    const app = createApp(services); // no rebindWorkspace option
    const response = await app.request("/api/workspace/root", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root: path.join(root, "workspace") }),
    });
    expect(response.status).toBe(409);
  });
});

async function realpathOf(value: string): Promise<string> {
  const { realpath } = await import("node:fs/promises");
  return realpath(value);
}
