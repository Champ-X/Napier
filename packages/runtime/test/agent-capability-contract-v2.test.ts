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
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V4,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V4_SHA256,
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

describe("default Agent Capability Contract history", () => {
  it("pins V1-V3 history and current full-capability vectors", async () => {
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
    expect(DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V3).toEqual({
      ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2,
      enabledTools: [
        ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2.enabledTools,
        "skill_load",
      ].sort(),
    });
    expect(DEFAULT_AGENT_CAPABILITY_RECOMMENDATION).toBe(
      DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V4,
    );
    expect(DEFAULT_AGENT_CAPABILITY_CONTRACT_VERSION).toBe(4);
    expect(DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_SHA256).toBe(
      DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V4_SHA256,
    );

    const services = await createRuntime();
    try {
      const agent = services.store.listAgents()[0]!;
      expect(managedCapabilitySha256(agent)).toBe(
        "998ef4368f87b808689fe5cd5640762d74bf644a7fbf8cefda214b440ba989e1",
      );
      const preview = createCapabilityRestorePreview({
        ...agent,
        revision: 7,
        enabledTools: ["read_file", "list_files"],
        enabledSkills: [],
        enabledSubagents: [],
      });
      expect(preview.diffSha256).toBe(
        "1ceab840365f7dde5a9179472cc30352017fab1210e2684397af0f05ed2b9f6e",
      );
      expect(
        (await services.agentCapabilities.project(agent.id)).projectionSha256,
      ).toBe(
        "79b954dd03fb39c6de459cf25896bde1ff41751948a51f7401682121c262b265",
      );
    } finally {
      await services.shutdown();
    }
  });

  it("projects a bound V2 profile as stale and upgrades it to V4", async () => {
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
      toolPolicy: DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2.toolPolicy,
      enabledTools: [
        ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2.enabledTools,
      ],
      enabledSkills: [
        ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2.enabledSkills,
      ],
      enabledSubagents: [
        ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2.enabledSubagents,
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
          contractVersion: 4,
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
            contractVersion: 4,
            operations: expect.arrayContaining([
              expect.objectContaining({
                field: "toolPolicy",
                operation: "replace",
                value: "workspace",
              }),
              expect.objectContaining({
                field: "enabledTools",
                operation: "add",
                value: "skill_load",
              }),
              expect.objectContaining({
                field: "enabledTools",
                operation: "add",
                value: "workspace_process",
              }),
            ]),
          }),
          upgradePreview: expect.objectContaining({
            sourceContractVersion: 2,
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
                value: "skill_load",
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
          driftState: "current",
          ownership: "recommended",
          configuredSkills:
            DEFAULT_AGENT_CAPABILITY_RECOMMENDATION.enabledSkills,
          configuredTools: expect.arrayContaining([
            "skill_load",
            "workspace_process",
          ]),
        }),
      );
    } finally {
      await services.shutdown();
    }
  });

  it("upgrades only unowned V2 fields and preserves explicit Skill overrides", async () => {
    const fixture = await createRuntimeFixture();
    const initial = await fixture.create();
    const seeded = initial.store.listAgents()[0]!;
    await initial.shutdown();
    await removeLedger(fixture.dataRoot);

    const statePath = path.join(fixture.dataRoot, "workspace.json");
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      agents: AgentProfile[];
      agentRevisions: AgentProfileRevision[];
      agentCapabilityBindings: Array<{
        agentId: string;
        contractVersion: number;
        recommendationSha256: string;
        source: string;
        ownership: string;
        explicitOverrideFields: string[];
      }>;
    };
    const agentIndex = state.agents.findIndex(
      (candidate) => candidate.id === seeded.id,
    );
    const v2Profile: AgentProfile = {
      ...state.agents[agentIndex]!,
      toolPolicy: DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2.toolPolicy,
      enabledTools: [
        ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2.enabledTools,
      ],
      enabledSkills: ["research-brief"],
      enabledSubagents: [
        ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2.enabledSubagents,
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
    binding.source = "updated";
    binding.ownership = "explicit_overrides";
    binding.explicitOverrideFields = ["enabledSkills"];
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    const services = await fixture.create();
    try {
      const stale = await services.agentCapabilities.project(seeded.id);
      expect(stale).toEqual(
        expect.objectContaining({
          driftState: "stale",
          ownership: "explicit_overrides",
          explicitOverrideFields: ["enabledSkills"],
          configuredSkills: ["research-brief"],
          upgradePreview: expect.objectContaining({
            explicitOverrideFields: ["enabledSkills"],
            operations: expect.arrayContaining([
              expect.objectContaining({
                field: "toolPolicy",
                operation: "replace",
                value: "workspace",
              }),
              expect.objectContaining({
                field: "enabledTools",
                operation: "add",
                value: "skill_load",
              }),
            ]),
          }),
        }),
      );
      expect(stale.upgradePreview?.operations).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "enabledSkills" }),
        ]),
      );
      const upgraded = await services.agentCapabilities.upgrade(seeded.id, {
        schemaVersion: 1,
        expectedRevision: stale.agentRevision,
        diffSha256: stale.upgradePreview!.diffSha256,
      });
      expect(upgraded.projection).toEqual(
        expect.objectContaining({
          driftState: "current",
          ownership: "explicit_overrides",
          explicitOverrideFields: ["enabledSkills"],
          configuredSkills: ["research-brief"],
          configuredTools: expect.arrayContaining([
            "skill_load",
            "workspace_process",
          ]),
        }),
      );
      expect(
        services.store.getAgentCapabilityBinding(
          seeded.id,
          upgraded.projection.agentRevision,
        ),
      ).toEqual(
        expect.objectContaining({
          status: "valid",
          binding: expect.objectContaining({
            source: "contract_upgrade",
            ownership: "explicit_overrides",
            explicitOverrideFields: ["enabledSkills"],
          }),
        }),
      );
    } finally {
      await services.shutdown();
    }
  });

  it("refuses to infer a safe upgrade for an unmanaged custom Profile", async () => {
    const services = await createRuntime();
    try {
      const seeded = services.store.listAgents()[0]!;
      const state = (
        services.store as unknown as {
          state: { agentCapabilityBindings: unknown[] };
        }
      ).state;
      state.agentCapabilityBindings = [];
      const projection = await services.agentCapabilities.project(seeded.id);
      expect(projection).toEqual(
        expect.objectContaining({
          driftState: "custom_unmanaged",
          ownership: "unmanaged",
        }),
      );
      expect(projection).not.toHaveProperty("upgradePreview");
      await expect(
        services.agentCapabilities.upgrade(seeded.id, {
          schemaVersion: 1,
          expectedRevision: seeded.revision,
          diffSha256: projection.restorePreview.diffSha256,
        }),
      ).rejects.toThrow(
        "Capability profile is unmanaged; use explicit restore after review",
      );
      expect(services.store.getAgent(seeded.id)).toEqual(seeded);
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
