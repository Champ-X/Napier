import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AgentProfile, AgentProfileRevision } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { createAgentProfileRevision } from "../src/agents.js";
import {
  DEFAULT_AGENT_CAPABILITY_CONTRACT_VERSION,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V4,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V4_SHA256,
} from "../src/default-agent-capability-contract.js";
import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import { UnsupportedSandboxAdapter } from "../src/sandbox.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("default Agent Capability Contract v5", () => {
  it("seeds full Safe Automation with relaxed Run and Subagent limits", async () => {
    const fixture = await createFixture();
    const services = await fixture.create();
    try {
      const agent = services.store.listAgents()[0]!;
      expect(DEFAULT_AGENT_CAPABILITY_CONTRACT_VERSION).toBe(5);
      expect(agent).toEqual(
        expect.objectContaining({
          toolPolicy: "workspace",
          enabledTools: DEFAULT_AGENT_CAPABILITY_RECOMMENDATION.enabledTools,
          enabledSkills: DEFAULT_AGENT_CAPABILITY_RECOMMENDATION.enabledSkills,
          enabledSubagents:
            DEFAULT_AGENT_CAPABILITY_RECOMMENDATION.enabledSubagents,
          runLimits: {
            maxTurns: 64,
            maxTotalTokens: 1_000_000,
            maxCostUsd: 25,
            timeoutMs: 1_800_000,
          },
          subagentLimits: {
            maxConcurrent: 4,
            maxTotal: 8,
            maxTurns: 16,
            timeoutMs: 300_000,
          },
        }),
      );
      expect(agent.enabledTools).toHaveLength(45);
      expect(agent.enabledSkills).toContain("frontend-design");
      expect(agent.enabledTools).toEqual(
        expect.arrayContaining([
          "apply_patch",
          "browser",
          "javascript_kernel",
          "python_kernel",
          "skill_load",
          "verify_workspace",
          "web_fetch_save",
          "workspace_file_apply",
          "workspace_process",
        ]),
      );
      const projection = await services.agentCapabilities.project(agent.id);
      expect(projection).toEqual(
        expect.objectContaining({
          contractVersion: 5,
          driftState: "current",
          ownership: "recommended",
          configuredTools: expect.arrayContaining([
            "apply_patch",
            "browser",
            "workspace_process",
          ]),
        }),
      );
    } finally {
      await services.shutdown();
    }
  });

  it("upgrades a bound V4 recommendation to V5 with Frontend Design", async () => {
    const fixture = await createFixture();
    const seededRuntime = await fixture.create();
    const seeded = seededRuntime.store.listAgents()[0]!;
    await seededRuntime.shutdown();
    await rm(path.join(fixture.dataRoot, "ledger.sqlite"), { force: true });

    const statePath = path.join(fixture.dataRoot, "workspace.json");
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      agents: AgentProfile[];
      agentRevisions: AgentProfileRevision[];
      agentCapabilityBindings: Array<{
        agentId: string;
        contractVersion: number;
        recommendationSha256: string;
      }>;
    };
    const agentIndex = state.agents.findIndex(
      (candidate) => candidate.id === seeded.id,
    );
    const v4Profile: AgentProfile = {
      ...state.agents[agentIndex]!,
      ...structuredClone(DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V4),
    };
    state.agents[agentIndex] = v4Profile;
    const revisionIndex = state.agentRevisions.findIndex(
      (candidate) =>
        candidate.agentId === seeded.id &&
        candidate.revision === seeded.revision,
    );
    state.agentRevisions[revisionIndex] = createAgentProfileRevision(
      v4Profile,
      { source: "created", createdAt: v4Profile.createdAt },
    );
    const binding = state.agentCapabilityBindings.find(
      (candidate) => candidate.agentId === seeded.id,
    )!;
    binding.contractVersion = 4;
    binding.recommendationSha256 =
      DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V4_SHA256;
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    const services = await fixture.create();
    try {
      const stale = await services.agentCapabilities.project(seeded.id);
      expect(stale).toEqual(
        expect.objectContaining({
          contractVersion: 5,
          driftState: "stale",
          ownership: "recommended",
          upgradePreview: expect.objectContaining({
            sourceContractVersion: 4,
            targetContractVersion: 5,
            explicitOverrideFields: [],
            operations: [
              expect.objectContaining({
                field: "enabledSkills",
                operation: "add",
                value: "frontend-design",
              }),
            ],
          }),
        }),
      );
      const upgraded = await services.agentCapabilities.upgrade(seeded.id, {
        schemaVersion: 1,
        expectedRevision: stale.agentRevision,
        diffSha256: stale.upgradePreview!.diffSha256,
      });
      expect(upgraded.projection).toEqual(
        expect.objectContaining({
          contractVersion: 5,
          driftState: "current",
          ownership: "recommended",
          configuredTools: DEFAULT_AGENT_CAPABILITY_RECOMMENDATION.enabledTools,
          configuredSkills:
            DEFAULT_AGENT_CAPABILITY_RECOMMENDATION.enabledSkills,
        }),
      );
    } finally {
      await services.shutdown();
    }
  });
});

async function createFixture(): Promise<{
  dataRoot: string;
  create: () => ReturnType<typeof createLocalAgentRuntime>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-capability-v4-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "state");
  await mkdir(workspaceRoot);
  return {
    dataRoot,
    create: () =>
      createLocalAgentRuntime({
        workspaceRoot,
        dataRoot,
        env: {},
        sandbox: new UnsupportedSandboxAdapter("capability-v4-test"),
      }),
  };
}
