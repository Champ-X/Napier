import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AgentProfile, AgentProfileRevision } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { createAgentProfileRevision } from "../src/agents.js";
import {
  DEFAULT_AGENT_CAPABILITY_CONTRACT_VERSION,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V3,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V3_SHA256,
} from "../src/default-agent-capability-contract.js";
import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import { UnsupportedSandboxAdapter } from "../src/sandbox.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("default Agent Capability Contract v4", () => {
  it("seeds full Safe Automation with relaxed Run and Subagent limits", async () => {
    const fixture = await createFixture();
    const services = await fixture.create();
    try {
      const agent = services.store.listAgents()[0]!;
      expect(DEFAULT_AGENT_CAPABILITY_CONTRACT_VERSION).toBe(4);
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
          contractVersion: 4,
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

  it("upgrades a bound V3 recommendation to full V4 capabilities", async () => {
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
    const v3Profile: AgentProfile = {
      ...state.agents[agentIndex]!,
      ...structuredClone(DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V3),
    };
    state.agents[agentIndex] = v3Profile;
    const revisionIndex = state.agentRevisions.findIndex(
      (candidate) =>
        candidate.agentId === seeded.id &&
        candidate.revision === seeded.revision,
    );
    state.agentRevisions[revisionIndex] = createAgentProfileRevision(
      v3Profile,
      { source: "created", createdAt: v3Profile.createdAt },
    );
    const binding = state.agentCapabilityBindings.find(
      (candidate) => candidate.agentId === seeded.id,
    )!;
    binding.contractVersion = 3;
    binding.recommendationSha256 =
      DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V3_SHA256;
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    const services = await fixture.create();
    try {
      const stale = await services.agentCapabilities.project(seeded.id);
      expect(stale).toEqual(
        expect.objectContaining({
          contractVersion: 4,
          driftState: "stale",
          ownership: "recommended",
          upgradePreview: expect.objectContaining({
            sourceContractVersion: 3,
            targetContractVersion: 4,
            explicitOverrideFields: [],
            operations: expect.arrayContaining([
              expect.objectContaining({
                field: "toolPolicy",
                operation: "replace",
                value: "workspace",
              }),
              expect.objectContaining({
                field: "enabledTools",
                operation: "add",
                value: "workspace_process",
              }),
              expect.objectContaining({
                field: "enabledSubagents",
                operation: "add",
                value: "coder",
              }),
            ]),
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
          contractVersion: 4,
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
