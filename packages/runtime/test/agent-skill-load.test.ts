import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  isSkillLoadFailureV1,
  isSkillLoadReceiptV1,
  isSkillLoadSelectionV1,
} from "@napier/contracts/skill-load";
import { afterEach, describe, expect, it } from "vitest";

import { AgentCapabilityRuntime } from "../src/agent-capability-runtime.js";
import { buildProjectSkillSnapshot } from "../src/project-skill-snapshot.js";
import { createSkillLoadTool } from "../src/skill-load-tool.js";
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

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-skill-load-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  for (const name of ["research-brief", "data-analysis"]) {
    const directory = path.join(workspaceRoot, "skills", name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: Use ${name} for bounded work.\n---\n# PRIVATE_${name}\n\nFollow this private Skill body.\n`,
    );
  }
  return { root, workspaceRoot };
}

describe("skill_load production tool", () => {
  it("returns only the frozen invocation privately and exact safe lifecycle records publicly", async () => {
    const { root, workspaceRoot } = await fixture();
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      sandbox: new UnsupportedSandboxAdapter("skill-load-test"),
    });
    try {
      const agent = services.store.listAgents()[0]!;
      const thread = await services.store.createThread({
        title: "Load project Skill",
        agentId: agent.id,
      });
      const provider = fauxProvider({ provider: "faux-skill-load" });
      provider.setResponses([
        fauxAssistantMessage(
          fauxToolCall("skill_load", { name: "research-brief" }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("SKILL_LOAD_COMPLETE"),
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(provider.provider);

      const run = await services.runtime.runPrompt({
        threadId: thread.id,
        text: "Load and follow the Research Brief Skill.",
        model: { provider: "faux-skill-load", id: "faux-1" },
        capabilityPreset: "research",
        onRunCreated: async () => {
          await rm(path.join(workspaceRoot, "skills"), { recursive: true });
        },
      });
      expect(run.status, run.error).toBe("completed");
      const events = await services.store.listEvents(thread.id);
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
      expect(record(started?.payload)?.effect).toBe("read");
      expect(isSkillLoadSelectionV1(record(started?.payload)?.details)).toBe(
        true,
      );
      expect(record(started?.payload)?.details).toEqual(
        expect.objectContaining({
          operation: "skill.load",
          agentToolName: "skill_load",
          state: "selected",
          name: "research-brief",
        }),
      );
      expect(isSkillLoadReceiptV1(record(completed?.payload)?.details)).toBe(
        true,
      );
      expect(completed?.payload).toEqual(
        expect.objectContaining({
          operation: "skill.load",
          outputRedacted: true,
          details: expect.objectContaining({ state: "loaded" }),
        }),
      );
      const durable = JSON.stringify(events);
      expect(durable).not.toContain("PRIVATE_research-brief");
      expect(durable).not.toContain("Follow this private Skill body.");
      expect(durable).not.toContain(workspaceRoot);

      const resultContext = events.find(
        (event) => event.type === "context.tool_result",
      );
      const capsuleSha256 = String(
        record(resultContext?.payload)?.capsuleSha256 ?? "",
      );
      expect(capsuleSha256).toMatch(/^[a-f0-9]{64}$/u);
      const privateCapsule =
        await services.runtime.toolInvocationResultCapsules.read(capsuleSha256);
      expect(JSON.stringify(privateCapsule)).toContain(
        "PRIVATE_research-brief",
      );
    } finally {
      await services.shutdown();
    }
  });

  it("emits bounded typed failures and remains usable without the filesystem", async () => {
    const { workspaceRoot } = await fixture();
    const snapshot = await buildProjectSkillSnapshot(workspaceRoot, [
      "research-brief",
    ]);
    const tool = createSkillLoadTool(snapshot);
    await rm(path.join(workspaceRoot, "skills"), { recursive: true });

    const success = await tool.execute(
      "call_success",
      { name: "research-brief" },
      new AbortController().signal,
    );
    expect(isSkillLoadReceiptV1(success.details)).toBe(true);
    expect(success.content[0]).toEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("PRIVATE_research-brief"),
      }),
    );

    const missing = await tool.execute(
      "call_missing",
      { name: "data-analysis" },
      new AbortController().signal,
    );
    expect(isSkillLoadFailureV1(missing.details)).toBe(true);
    expect(missing.details).toEqual(
      expect.objectContaining({
        state: "failed",
        failureCode: "skill_not_enabled",
      }),
    );

    const invalid = await tool.execute(
      "call_invalid",
      { name: "bad_name" },
      new AbortController().signal,
    );
    expect(invalid.details).toEqual(
      expect.objectContaining({ failureCode: "skill_invalid" }),
    );
    expect(invalid.details).not.toHaveProperty("canonicalName");

    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    const cancelled = await tool.execute(
      "call_cancelled",
      { name: "research-brief" },
      controller.signal,
    );
    expect(cancelled.details).toEqual(
      expect.objectContaining({ failureCode: "skill_load_cancelled" }),
    );
  });

  it("constructs skill_load only inside the allowed Research capability path", async () => {
    const { root, workspaceRoot } = await fixture();
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "matrix-state"),
      sandbox: new UnsupportedSandboxAdapter("skill-load-matrix"),
    });
    try {
      const snapshot = await buildProjectSkillSnapshot(workspaceRoot, [
        "research-brief",
        "data-analysis",
      ]);
      const stored = services.store.listAgents()[0]!;
      const research = {
        ...stored,
        enabledTools: [...stored.enabledTools, "skill_load"],
        enabledSkills: ["research-brief", "data-analysis"],
      };
      const capabilities = new AgentCapabilityRuntime(
        services.store,
        services.sandbox,
      );
      const create = (overrides: Record<string, unknown>) =>
        capabilities.createTools({
          profile: research,
          threadId: "thread_matrix",
          runId: "run_matrix",
          projectSkillSnapshot: snapshot,
          ...overrides,
        });
      expect(
        create({ skillLoadAllowed: true }).map((tool) => tool.name),
      ).toContain("skill_load");
      expect(
        create({ skillLoadAllowed: false }).map((tool) => tool.name),
      ).not.toContain("skill_load");
      expect(
        create({ skillLoadAllowed: true, advisorCorrection: true }).map(
          (tool) => tool.name,
        ),
      ).not.toContain("skill_load");
      const disabled = {
        ...stored,
        enabledTools: stored.enabledTools.filter(
          (tool) => tool !== "skill_load",
        ),
      };
      expect(
        capabilities
          .createTools({
            profile: disabled,
            threadId: "thread_matrix",
            runId: "run_matrix",
            projectSkillSnapshot: snapshot,
            skillLoadAllowed: true,
          })
          .map((tool) => tool.name),
      ).not.toContain("skill_load");
    } finally {
      await services.shutdown();
    }
  });
});

function record(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined;
}
