import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { StreamFrame } from "@napier/contracts";
import { agentCapabilityPresetUpdate } from "@napier/contracts/agent-capabilities";
import { afterEach, describe, expect, it } from "vitest";

import { createApp, createServices } from "../src/app.js";

const roots: string[] = [];
const servicesToClose: Awaited<ReturnType<typeof createServices>>[] = [];

afterEach(async () => {
  for (const services of servicesToClose.splice(0)) {
    await services.shutdownLocalRuntime();
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("temporary capability preset HTTP", () => {
  it("runs one exact preset without mutating the Agent profile", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-web-preset-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      env: {},
    });
    servicesToClose.push(services);
    const app = createApp(services);
    const agent = services.store.listAgents()[0]!;
    const revisions = services.store.listAgentRevisions(agent.id);
    const thread = await services.store.createThread({
      title: "Temporary Web preset",
      agentId: agent.id,
    });

    const response = await app.request(`/api/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "Use the Browser preset for this Run only.",
        capabilityPreset: "browser",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-napier-capability-preset")).toBe("browser");
    const frames = parseSseFrames(await response.text());
    const started = frames.find(
      (frame) => frame.type === "event" && frame.event.type === "run.started",
    );
    expect(
      started?.type === "event" ? started.event.payload : undefined,
    ).toEqual(expect.objectContaining({ capabilityPreset: "browser" }));
    const run = services.store.listRuns(thread.id)[0]!;
    const browser = agentCapabilityPresetUpdate("browser");
    expect(run.configuration).toEqual(
      expect.objectContaining({
        toolPolicy: browser.toolPolicy,
        enabledTools: [...browser.enabledTools].sort(),
        enabledSkills: [...browser.enabledSkills].sort(),
        enabledSubagents: [...browser.enabledSubagents].sort(),
      }),
    );
    expect(services.store.getAgent(agent.id)).toEqual(agent);
    expect(services.store.listAgentRevisions(agent.id)).toEqual(revisions);
  });

  it("rejects an unknown preset before creating a Run", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-web-preset-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      env: {},
    });
    servicesToClose.push(services);
    const app = createApp(services);
    const thread = await services.store.createThread({
      title: "Invalid Web preset",
      agentId: services.store.listAgents()[0]!.id,
    });

    const response = await app.request(`/api/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "Do not start this Run.",
        capabilityPreset: "unrestricted_everything",
      }),
    });

    expect(response.status).toBe(400);
    expect(services.store.listRuns(thread.id)).toHaveLength(0);
  });
});

function parseSseFrames(text: string): StreamFrame[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as StreamFrame);
}
