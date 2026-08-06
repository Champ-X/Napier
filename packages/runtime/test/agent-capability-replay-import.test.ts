import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import { UnsupportedSandboxAdapter } from "../src/sandbox.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent capability replay import", () => {
  it("keeps source ownership and marks the imported Agent custom_unmanaged", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-capability-replay-"),
    );
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);
    const create = () =>
      createLocalAgentRuntime({
        workspaceRoot,
        dataRoot,
        env: {},
        sandbox: new UnsupportedSandboxAdapter("capability-replay-test"),
      });
    let services = await create();
    const seeded = services.store.listAgents()[0]!;
    const customized = await services.store.updateAgent(seeded.id, {
      enabledSkills: ["custom-skill"],
    });
    const sourceThread = services.store.listThreads()[0]!;
    const bundle = await exportThreadReplayBundle(
      services.store,
      sourceThread.id,
    );
    const imported = await services.store.importThreadReplayBundle(bundle);

    expect(imported.agent.id).not.toBe(customized.id);
    expect(imported.thread.agentId).toBe(imported.agent.id);
    expect(await services.agentCapabilities.project(customized.id)).toEqual(
      expect.objectContaining({
        ownership: "explicit_overrides",
        explicitOverrideFields: ["enabledSkills"],
      }),
    );
    expect(await services.agentCapabilities.project(imported.agent.id)).toEqual(
      expect.objectContaining({
        agentId: imported.agent.id,
        driftState: "custom_unmanaged",
        ownership: "unmanaged",
        explicitOverrideFields: [],
        configuredSkills: ["custom-skill"],
      }),
    );

    await services.shutdown();
    services = await create();
    try {
      expect(
        await services.agentCapabilities.project(imported.agent.id),
      ).toEqual(
        expect.objectContaining({
          driftState: "custom_unmanaged",
          ownership: "unmanaged",
          configuredSkills: ["custom-skill"],
        }),
      );
    } finally {
      await services.shutdown();
    }
  });
});
