import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { agentCapabilityPresetUpdate } from "@napier/contracts/agent-capabilities";
import { afterEach, describe, expect, it } from "vitest";

import { applyAgentCapabilityPresetOverride } from "../src/agent-capability-override.js";
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

describe("temporary Agent capability preset overrides", () => {
  it("uses the first-class Skill loader in every Skill-bearing preset", () => {
    const profile = {
      id: "agent_override",
      name: "Override",
      description: "Test Agent",
      systemPrompt: "Stay bounded.",
      model: { provider: "deepseek", id: "deepseek-v4-flash" },
      thinkingLevel: "minimal" as const,
      toolPolicy: "observe" as const,
      enabledTools: ["read_file"],
      enabledSkills: [],
      enabledSubagents: [],
      revision: 7,
      createdAt: "2026-08-07T00:00:00.000Z",
      updatedAt: "2026-08-07T00:00:00.000Z",
    };
    const before = JSON.stringify(profile);
    const research = applyAgentCapabilityPresetOverride(
      profile,
      "research",
      "user",
    );
    expect(research.enabledTools).toEqual(
      agentCapabilityPresetUpdate("research").enabledTools,
    );
    expect(research.enabledTools).toContain("skill_load");
    expect(research.enabledSkills).toEqual(["research-brief", "data-analysis"]);
    expect(research.revision).toBe(7);
    expect(JSON.stringify(profile)).toBe(before);
    expect(
      applyAgentCapabilityPresetOverride(profile, "browser", "user")
        .enabledTools,
    ).toContain("skill_load");
    expect(
      applyAgentCapabilityPresetOverride(profile, undefined, "user")
        .enabledTools,
    ).not.toContain("skill_load");
    expect(() =>
      applyAgentCapabilityPresetOverride(profile, "research", "schedule"),
    ).toThrow(
      "Temporary Agent capability presets are available only for user Runs",
    );
    expect(() =>
      applyAgentCapabilityPresetOverride(profile, "research", "recovery"),
    ).toThrow(
      "Temporary Agent capability presets are available only for user Runs",
    );
  });

  it("freezes the effective preset into one user Run without revising the Agent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-run-preset-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      sandbox: new UnsupportedSandboxAdapter("run-preset-test"),
    });
    try {
      const agentBefore = services.store.listAgents()[0]!;
      const revisionsBefore = services.store.listAgentRevisions(agentBefore.id);
      const thread = await services.store.createThread({
        title: "Temporary Browser preset",
        agentId: agentBefore.id,
      });

      const overridden = await services.runtime.runPrompt({
        threadId: thread.id,
        text: "Describe the temporary capability boundary.",
        capabilityPreset: "browser",
      });
      const browser = agentCapabilityPresetUpdate("browser");

      expect(overridden.status, overridden.error).toBe("completed");
      expect(overridden.agentRevision).toBe(agentBefore.revision);
      expect(overridden.configuration).toEqual(
        expect.objectContaining({
          toolPolicy: browser.toolPolicy,
          enabledTools: [...browser.enabledTools].sort(),
          enabledSkills: [...browser.enabledSkills].sort(),
          enabledSubagents: [...browser.enabledSubagents].sort(),
        }),
      );
      expect(services.store.getAgent(agentBefore.id)).toEqual(agentBefore);
      expect(services.store.listAgentRevisions(agentBefore.id)).toEqual(
        revisionsBefore,
      );
      const started = (await services.store.listEvents(thread.id)).find(
        (event) =>
          event.runId === overridden.id && event.type === "run.started",
      );
      expect(started?.payload).toEqual(
        expect.objectContaining({
          capabilityPreset: "browser",
          configurationSha256: overridden.configuration?.contentSha256,
        }),
      );

      const ordinary = await services.runtime.runPrompt({
        threadId: thread.id,
        text: "Use the unchanged Agent profile.",
      });
      expect(ordinary.status, ordinary.error).toBe("completed");
      expect(ordinary.configuration).toEqual(
        expect.objectContaining({
          toolPolicy: "observe",
          executionMode: "environment_degraded_read_only",
          enabledTools: expect.arrayContaining([
            "read_file",
            "web_search",
            "web_fetch",
            "browser",
            "research_source",
          ]),
          enabledSkills: [...agentBefore.enabledSkills].sort(),
          enabledSubagents: [],
        }),
      );
      expect(ordinary.configuration?.enabledTools).not.toEqual(
        expect.arrayContaining([
          "apply_patch",
          "run_command",
          "workspace_process",
        ]),
      );
      expect(ordinary.configuration?.contentSha256).not.toBe(
        overridden.configuration?.contentSha256,
      );

      await expect(
        services.runtime.runPrompt({
          threadId: thread.id,
          text: "A scheduled Run must not gain temporary capabilities.",
          source: "schedule",
          capabilityPreset: "research",
        }),
      ).rejects.toThrow(
        "Temporary Agent capability presets are available only for user Runs",
      );
      await expect(
        services.runtime.runPrompt({
          threadId: thread.id,
          text: "A direct recovery call must not gain Browser capabilities.",
          source: "recovery",
          capabilityPreset: "browser",
        }),
      ).rejects.toThrow(
        "Temporary Agent capability presets are available only for user Runs",
      );
      expect(services.store.listRuns(thread.id)).toHaveLength(2);
      expect(services.store.getAgent(agentBefore.id)).toEqual(agentBefore);
    } finally {
      await services.shutdown();
    }
  });

  it("preserves the origin preset across an operator-decision continuation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-preset-decision-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      sandbox: new UnsupportedSandboxAdapter("preset-decision-test"),
    });
    try {
      const agent = services.store.listAgents()[0]!;
      const thread = await services.store.createThread({
        title: "Preset operator continuation",
        agentId: agent.id,
      });
      const provider = fauxProvider({ provider: "preset-decision" });
      provider.setResponses([
        fauxAssistantMessage(
          fauxToolCall("request_operator_decision", {
            header: "Scope",
            question: "Which read-only scope should continue?",
            options: [
              {
                label: "Current",
                description: "Keep the current Browser preset.",
              },
              {
                label: "Stop",
                description: "Stop without continuing.",
              },
            ],
            multiSelect: false,
          }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("PRESET_CONTINUATION_COMPLETED"),
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(provider.provider);

      const origin = await services.runtime.runPrompt({
        threadId: thread.id,
        text: "Request the operator choice.",
        model: { provider: "preset-decision", id: "faux-1" },
        capabilityPreset: "browser",
      });
      const decision = (
        await services.store.listOperatorDecisions(thread.id)
      )[0]!;
      await services.store.answerOperatorDecision(thread.id, decision.id, {
        selectedOptionIds: ["option_1"],
      });
      const continuation = await services.runtime.continueOperatorDecision({
        threadId: thread.id,
        decisionId: decision.id,
      });

      expect(continuation.status, continuation.error).toBe("completed");
      expect(continuation.parentRunId).toBe(origin.id);
      expect(continuation.configuration).toEqual(
        expect.objectContaining({
          agentRevision: origin.configuration?.agentRevision,
          model: origin.configuration?.model,
          toolPolicy: origin.configuration?.toolPolicy,
          enabledTools: origin.configuration?.enabledTools,
          enabledSkills: origin.configuration?.enabledSkills,
          enabledSubagents: origin.configuration?.enabledSubagents,
        }),
      );
      expect(continuation.configuration?.enabledTools).toEqual(
        [...agentCapabilityPresetUpdate("browser").enabledTools].sort(),
      );
      expect(services.store.getAgent(agent.id)).toEqual(agent);
      expect(services.store.listAgentRevisions(agent.id)).toHaveLength(1);
      expect(
        (await services.store.listEvents(thread.id))
          .filter((event) => event.type === "run.started")
          .map((event) => event.payload),
      ).toEqual([
        expect.objectContaining({ capabilityPreset: "browser" }),
        expect.objectContaining({ capabilityPreset: "browser" }),
      ]);
    } finally {
      await services.shutdown();
    }
  });
});
