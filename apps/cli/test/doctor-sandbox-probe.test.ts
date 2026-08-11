import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { UnsupportedSandboxAdapter } from "@napier/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultSandboxProbe } from "../src/doctor-sandbox-probe.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Doctor Sandbox probe", () => {
  it("guides fresh users through locked exact-preview Setup", async () => {
    const workspace = await fixtureWorkspace();
    const containerRuntimeAvailable = vi.fn(async () => true);

    const check = await defaultSandboxProbe(
      workspace,
      new AbortController().signal,
      new UnsupportedSandboxAdapter("doctor-test"),
      { containerRuntimeAvailable },
    );

    expect(check).toEqual(
      expect.objectContaining({
        id: "sandbox",
        status: "warning",
        code: "sandbox_container_available",
        message: expect.stringContaining(
          "napier setup --workspace 'WORKSPACE_PATH' --component sandbox",
        ),
      }),
    );
    expect(check.message).not.toContain("NAPIER_CONTAINER_SANDBOX_IMAGE");
    expect(containerRuntimeAvailable).toHaveBeenCalledOnce();
  });
});

async function fixtureWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-doctor-sandbox-"));
  roots.push(root);
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  return workspace;
}
