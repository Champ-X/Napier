import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { StreamFrame } from "@napier/contracts";
import { agentCapabilityPresetUpdate } from "@napier/contracts/agent-capabilities";
import { afterEach, describe, expect, it } from "vitest";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";

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
  it.each(["read_only", "safe_automation", "full_access"] as const)(
    "keeps a custom Skill loadable through the %s message and capability APIs",
    async (capabilityPreset) => {
      const root = await mkdtemp(
        path.join(tmpdir(), "napier-web-custom-skill-"),
      );
      roots.push(root);
      const workspaceRoot = path.join(root, "workspace");
      const skill = path.join(
        workspaceRoot,
        ".agents/skills/private-knowledge",
      );
      await mkdir(skill, { recursive: true });
      await writeFile(
        path.join(skill, "SKILL.md"),
        "---\nname: private-knowledge\ndescription: Query the private knowledge service.\n---\n\nPRIVATE_KNOWLEDGE_INSTRUCTIONS\n",
      );
      const services = await createServices({
        workspaceRoot,
        dataRoot: path.join(root, "state"),
        env: {},
      });
      servicesToClose.push(services);
      const app = createApp(services);
      const original = services.store.listAgents()[0]!;
      const agent = await services.store.updateAgent(original.id, {
        enabledSkills: ["private-knowledge"],
      });
      const revisions = services.store.listAgentRevisions(agent.id);
      const thread = await services.store.createThread({
        title: "Knowledge Skill",
        agentId: agent.id,
      });
      const provider = fauxProvider({ provider: "custom-skill-http" });
      provider.setResponses([
        fauxAssistantMessage(
          fauxToolCall("skill_load", { name: "private-knowledge" }),
          { stopReason: "toolUse" },
        ),
        (context) => {
          expect(JSON.stringify(context.messages)).toContain(
            "PRIVATE_KNOWLEDGE_INSTRUCTIONS",
          );
          return fauxAssistantMessage("CUSTOM_SKILL_LOADED");
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(provider.provider);
      const projection = await (
        await app.request(
          `/api/agents/${agent.id}/capabilities?preset=${capabilityPreset}`,
        )
      ).json();
      expect(projection.configuredSkills).toEqual(["private-knowledge"]);
      const response = await app.request(`/api/threads/${thread.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "Use the private knowledge Skill.",
          capabilityPreset,
          model: { provider: "custom-skill-http", id: "faux-1" },
        }),
      });
      expect(response.status).toBe(200);
      const frames = parseSseFrames(await response.text());
      const run = services.store.listRuns(thread.id)[0]!;
      expect(run.status, run.error).toBe("completed");
      expect(run.configuration?.enabledSkills).toEqual(["private-knowledge"]);
      expect(frames).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "event",
            event: expect.objectContaining({
              type: "tool.completed",
              payload: expect.objectContaining({
                toolName: "skill_load",
                details: expect.objectContaining({
                  name: "private-knowledge",
                  state: "loaded",
                }),
              }),
            }),
          }),
        ]),
      );
      expect(services.store.getAgent(agent.id)).toEqual(agent);
      expect(services.store.listAgentRevisions(agent.id)).toEqual(revisions);
    },
  );

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
