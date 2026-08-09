import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  isStandardSkillCatalogBindingV2,
  isStandardSkillLoadReceiptV2,
  isStandardSkillLoadSelectionV2,
} from "@napier/contracts/skill-load-standard";
import { afterEach, describe, expect, it } from "vitest";

import {
  createLocalAgentRuntime,
  UnsupportedSandboxAdapter,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("standard Skill production Run", () => {
  it("loads a project .agents Skill with V2 evidence and no profile mutation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-standard-run-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const skillRoot = path.join(
      workspaceRoot,
      ".agents",
      "skills",
      "research-brief",
    );
    await mkdir(skillRoot, { recursive: true });
    await writeFile(
      path.join(skillRoot, "SKILL.md"),
      [
        "---",
        "name: research-brief",
        "description: Standard directory production fixture.",
        "---",
        "# PRIVATE_STANDARD_RESEARCH_BRIEF",
        "",
        "Follow the standard directory workflow.",
        "",
      ].join("\n"),
    );
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      sandbox: new UnsupportedSandboxAdapter("standard-skill-run-test"),
    });
    try {
      const agent = services.store.listAgents()[0]!;
      const profileBefore = JSON.stringify(agent);
      const thread = await services.store.createThread({
        title: "Load standard project Skill",
        agentId: agent.id,
      });
      const provider = fauxProvider({ provider: "faux-standard-skill" });
      provider.setResponses([
        fauxAssistantMessage(
          fauxToolCall("skill_load", { name: "research-brief" }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("STANDARD_SKILL_LOAD_COMPLETE"),
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(provider.provider);

      const run = await services.runtime.runPrompt({
        threadId: thread.id,
        text: "Load and apply the Research Brief Skill.",
        model: { provider: "faux-standard-skill", id: "faux-1" },
        capabilityPreset: "research",
        onRunCreated: async () => {
          await rm(path.join(workspaceRoot, ".agents"), {
            recursive: true,
            force: true,
          });
        },
      });
      expect(run.status, run.error).toBe("completed");

      const events = await services.store.listEvents(thread.id);
      const context = events.find((event) => event.type === "context.skills");
      const started = events.find(
        (event) =>
          event.type === "tool.started" &&
          record(event.payload)?.toolName === "skill_load",
      );
      const completed = events.find(
        (event) =>
          event.type === "tool.completed" &&
          record(event.payload)?.toolName === "skill_load",
      );
      expect(isStandardSkillCatalogBindingV2(context?.payload)).toBe(true);
      expect(context?.payload).toEqual(
        expect.objectContaining({
          configuredSkillRequests: expect.arrayContaining([
            expect.objectContaining({
              canonicalName: "research-brief",
              source: "project",
              rootKind: "project_standard",
            }),
          ]),
        }),
      );
      expect(
        isStandardSkillLoadSelectionV2(record(started?.payload)?.details),
      ).toBe(true);
      expect(
        isStandardSkillLoadReceiptV2(record(completed?.payload)?.details),
      ).toBe(true);
      expect(record(completed?.payload)?.details).toEqual(
        expect.objectContaining({
          source: "project",
          rootKind: "project_standard",
          relativePath: ".agents/skills/research-brief/SKILL.md",
        }),
      );

      const durable = JSON.stringify(events);
      expect(durable).not.toContain("PRIVATE_STANDARD_RESEARCH_BRIEF");
      expect(durable).not.toContain(workspaceRoot);
      expect(JSON.stringify(services.store.getAgent(agent.id))).toBe(
        profileBefore,
      );
    } finally {
      await services.shutdown();
    }
  });
});

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
