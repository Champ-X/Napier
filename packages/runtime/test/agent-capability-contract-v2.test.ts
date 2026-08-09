import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AgentProfile, AgentProfileRevision } from "@napier/contracts";

import { createAgentProfileRevision } from "../src/agents.js";
import {
  DEFAULT_AGENT_CAPABILITY_CONTRACT_VERSION,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_SHA256,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V1,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V1_SHA256,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2_SHA256,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V3,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V3_SHA256,
  createCapabilityRestorePreview,
  managedCapabilitySha256,
} from "../src/default-agent-capability-contract.js";
import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import { UnsupportedSandboxAdapter } from "../src/sandbox.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("default Agent Capability Contract v3", () => {
  it("pins V1/V2 history and current Skill loader vectors", async () => {
    expect(DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V1).toEqual({
      toolPolicy: "observe",
      enabledTools: [
        "apply_patch",
        "browser",
        "data_frame",
        "git_branch_create_apply",
        "git_branch_create_preview",
        "git_branch_switch_apply",
        "git_branch_switch_preview",
        "git_commit_apply",
        "git_commit_preview",
        "git_inspect",
        "git_review_apply",
        "git_review_preview",
        "git_stage_apply",
        "git_stage_preview",
        "inspect_code",
        "inspect_data",
        "list_files",
        "list_symbols",
        "read_file",
        "read_symbol",
        "research_source",
        "search_files",
        "sqlite_query",
        "verify_workspace",
        "web_fetch",
        "web_search",
      ],
      enabledSkills: [
        "artifact-studio",
        "data-analysis",
        "research-brief",
        "software-delivery",
      ],
      enabledSubagents: ["general", "researcher", "reviewer"],
    });
    expect(DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V1_SHA256).toBe(
      "17a5fb30b02770c24dff24213ade809fb1bcd452f50f9b0eb8b36a6d03c29786",
    );
    expect(DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2).toEqual({
      ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V1,
      enabledSkills: [
        "artifact-studio",
        "browser-automation",
        "data-analysis",
        "research-brief",
        "software-delivery",
      ],
    });
    expect(DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2_SHA256).toBe(
      "79c836e15a89df6ad76270de296665217aac7bb04b81421b9e6dc80487ea7613",
    );
    expect(DEFAULT_AGENT_CAPABILITY_RECOMMENDATION).toEqual({
      ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2,
      enabledTools: [
        ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2.enabledTools,
        "skill_load",
      ].sort(),
    });
    expect(DEFAULT_AGENT_CAPABILITY_RECOMMENDATION).toBe(
      DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V3,
    );
    expect(DEFAULT_AGENT_CAPABILITY_CONTRACT_VERSION).toBe(3);
    expect(DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_SHA256).toBe(
      DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V3_SHA256,
    );

    const services = await createRuntime();
    try {
      const agent = services.store.listAgents()[0]!;
      expect(managedCapabilitySha256(agent)).toBe(
        "5dcd6cce2e85958e7aedf0f1a7451b89b9a66f1601d36bf081840772b5ab56c4",
      );
      const preview = createCapabilityRestorePreview({
        ...agent,
        revision: 7,
        enabledTools: ["read_file", "list_files"],
        enabledSkills: [],
        enabledSubagents: [],
      });
      expect(preview.diffSha256).toBe(
        "22f7c14f45998eac250bed9bbf34535884fb2feb8ea964d6490677b41c5b1ed1",
      );
      expect(
        (await services.agentCapabilities.project(agent.id)).projectionSha256,
      ).toBe(
        "e55355eef68e5f0c48f3715d65f1bba526f7a9bf145368995f2ca7a8a9f24596",
      );
    } finally {
      await services.shutdown();
    }
  });

  it("projects a bound V2 profile as stale and restores it to V3", async () => {
    const fixture = await createRuntimeFixture();
    const initial = await fixture.create();
    const seeded = initial.store.listAgents()[0]!;
    await initial.shutdown();
    await removeLedger(fixture.dataRoot);

    const state = JSON.parse(
      await readFile(path.join(fixture.dataRoot, "workspace.json"), "utf8"),
    ) as {
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
    const v2Profile: AgentProfile = {
      ...state.agents[agentIndex]!,
      enabledTools: [
        ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2.enabledTools,
      ],
      enabledSkills: [
        ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2.enabledSkills,
      ],
    };
    state.agents[agentIndex] = v2Profile;
    const revisionIndex = state.agentRevisions.findIndex(
      (candidate) =>
        candidate.agentId === seeded.id &&
        candidate.revision === seeded.revision,
    );
    state.agentRevisions[revisionIndex] = createAgentProfileRevision(
      v2Profile,
      {
        source: "created",
        createdAt: v2Profile.createdAt,
      },
    );
    const binding = state.agentCapabilityBindings.find(
      (candidate) => candidate.agentId === seeded.id,
    )!;
    binding.contractVersion = 2;
    binding.recommendationSha256 =
      DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2_SHA256;
    await writeFile(
      path.join(fixture.dataRoot, "workspace.json"),
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8",
    );

    const services = await fixture.create();
    try {
      const stale = await services.agentCapabilities.project(seeded.id);
      expect(stale).toEqual(
        expect.objectContaining({
          contractVersion: 3,
          driftState: "stale",
          ownership: "recommended",
          configuredSkills: [
            "artifact-studio",
            "browser-automation",
            "data-analysis",
            "research-brief",
            "software-delivery",
          ],
          restorePreview: expect.objectContaining({
            contractVersion: 3,
            operations: [
              expect.objectContaining({
                field: "enabledTools",
                operation: "add",
                value: "skill_load",
              }),
            ],
          }),
        }),
      );
      const restored = await services.agentCapabilities.restore(seeded.id, {
        schemaVersion: 1,
        expectedRevision: stale.agentRevision,
        diffSha256: stale.restorePreview.diffSha256,
      });
      expect(restored.projection).toEqual(
        expect.objectContaining({
          driftState: "current",
          ownership: "recommended",
          configuredSkills:
            DEFAULT_AGENT_CAPABILITY_RECOMMENDATION.enabledSkills,
          configuredTools: expect.arrayContaining(["skill_load"]),
        }),
      );
    } finally {
      await services.shutdown();
    }
  });
});

async function createRuntime() {
  const fixture = await createRuntimeFixture();
  return fixture.create();
}

async function createRuntimeFixture() {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-capability-contract-v2-"),
  );
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
        sandbox: new UnsupportedSandboxAdapter("capability-contract-v2-test"),
      }),
  };
}

async function removeLedger(dataRoot: string): Promise<void> {
  await Promise.all(
    ["ledger.sqlite", "ledger.sqlite-shm", "ledger.sqlite-wal"].map((name) =>
      rm(path.join(dataRoot, name), { force: true }),
    ),
  );
}
