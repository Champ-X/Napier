import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import { UnsupportedSandboxAdapter } from "../src/sandbox.js";
import { SqliteLedger } from "../src/sqlite-ledger.js";
import {
  DEFAULT_AGENT_CAPABILITY_CONTRACT_HISTORY,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_SHA256,
  createAgentCapabilityContractRecommendation,
  createCapabilityRestorePreview,
  managedCapabilityPayload,
  managedCapabilitySha256,
} from "../src/default-agent-capability-contract.js";
import {
  bindingMatchesProfile,
  ensureCurrentCapabilityBindings,
  lookupCapabilityBinding,
  propagateUpdatedCapabilityBinding,
  validateCapabilityBinding,
} from "../src/agent-capability-bindings.js";
import { inspectSandboxReadiness } from "../src/agent-capability-service.js";
import { CapabilityRestorePersistenceError } from "../src/agent-capability-store-mutations.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createRuntime() {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-capability-contract-"),
  );
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  return createLocalAgentRuntime({
    workspaceRoot,
    dataRoot: path.join(root, "state"),
    env: {},
    sandbox: new UnsupportedSandboxAdapter("capability-contract-test"),
  });
}

async function createFixtureRuntime(name: "pre-search" | "search-fetch") {
  const root = await mkdtemp(path.join(tmpdir(), "napier-capability-legacy-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "state");
  await mkdir(workspaceRoot);
  await cp(
    path.join(import.meta.dirname, "fixtures", "capability-contract-v1", name),
    dataRoot,
    { recursive: true },
  );
  const create = () =>
    createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      env: {},
      sandbox: new UnsupportedSandboxAdapter("capability-contract-test"),
    });
  return { create, dataRoot };
}

describe("default Agent Capability Contract v1", () => {
  it.each(["pre-search", "search-fetch"] as const)(
    "verifies the reproducible %s fixture manifest",
    async (name) => {
      const fixtureRoot = path.join(
        import.meta.dirname,
        "fixtures",
        "capability-contract-v1",
        name,
      );
      const manifest = JSON.parse(
        await readFile(path.join(fixtureRoot, "manifest.json"), "utf8"),
      ) as {
        schemaVersion: number;
        name: string;
        sourceCommit: string;
        sourceCommitRelationship: Record<string, string>;
        extractionCommand: string;
        toolVersions: Record<string, string>;
        canonicalManagedPayload: ReturnType<typeof managedCapabilityPayload>;
        managedPayloadSha256: string;
        files: Record<string, string>;
      };
      expect(manifest).toEqual(
        expect.objectContaining({
          schemaVersion: 1,
          name,
          sourceCommit: expect.stringMatching(/^[a-f0-9]{40}$/),
          sourceCommitRelationship: expect.any(Object),
          extractionCommand: expect.stringContaining(
            `git worktree add --detach "$fixture_source" ${manifest.sourceCommit}`,
          ),
          toolVersions: {
            node: "v24.16.0",
            npm: "11.13.0",
            git: "2.50.1 (Apple Git-155)",
            typescript: "5.9.3",
            "@types/node": "24.12.4",
            runtime: "@napier/runtime@0.1.0",
          },
        }),
      );
      expect(manifest.extractionCommand).toContain("npm ci");
      expect(manifest.extractionCommand).toContain("npm run build:core");
      const state = JSON.parse(
        await readFile(path.join(fixtureRoot, "workspace.json"), "utf8"),
      ) as { agents: Array<{ id: string }> };
      const agent = state.agents.find(
        (candidate) => candidate.id === "agent_napier",
      );
      expect(agent).toBeDefined();
      expect(managedCapabilityPayload(agent as never)).toEqual(
        manifest.canonicalManagedPayload,
      );
      expect(managedCapabilitySha256(agent as never)).toBe(
        manifest.managedPayloadSha256,
      );
      for (const [relativePath, expectedSha256] of Object.entries(
        manifest.files,
      )) {
        expect(
          createHash("sha256")
            .update(await readFile(path.join(fixtureRoot, relativePath)))
            .digest("hex"),
        ).toBe(expectedSha256);
      }
    },
  );

  it("pins the literal V1 recommendation, managed, diff, and projection vectors", async () => {
    expect(DEFAULT_AGENT_CAPABILITY_RECOMMENDATION).toEqual({
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
    expect(DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_SHA256).toBe(
      "17a5fb30b02770c24dff24213ade809fb1bcd452f50f9b0eb8b36a6d03c29786",
    );
    const services = await createRuntime();
    try {
      const agent = services.store.listAgents()[0]!;
      expect(managedCapabilitySha256(agent)).toBe(
        "af88ec401700dd0af192113aa688d27029bc209c982cd8dc7289145c37128b9e",
      );
      const preview = createCapabilityRestorePreview({
        ...agent,
        revision: 7,
        enabledTools: ["read_file", "list_files"],
        enabledSkills: [],
        enabledSubagents: [],
      });
      expect(preview.diffSha256).toBe(
        "5fdbd1ad6b20d18686fb63e5bd87c722288abff7894cecf334dcd7795b7e58ff",
      );
      expect(
        (await services.agentCapabilities.project(agent.id)).projectionSha256,
      ).toBe(
        "586ecb73c1df3f98a8ff3f0014aa83694d057fde1742cdf8b04edf632d7cac99",
      );
    } finally {
      await services.shutdown();
    }
  });

  it("seeds a recommendation binding and projects actual policy exposure", async () => {
    const services = await createRuntime();
    try {
      const agent = services.store.listAgents()[0]!;
      const binding = services.store.getAgentCapabilityBinding(
        agent.id,
        agent.revision,
      );
      expect(binding).toEqual(
        expect.objectContaining({
          status: "valid",
          binding: expect.objectContaining({
            source: "seeded",
            ownership: "recommended",
            explicitOverrideFields: [],
          }),
        }),
      );
      expect(managedCapabilityPayload(agent)).toEqual(
        DEFAULT_AGENT_CAPABILITY_RECOMMENDATION,
      );

      const projection = await services.agentCapabilities.project(agent.id);
      expect(projection).toEqual(
        expect.objectContaining({
          driftState: "current",
          ownership: "recommended",
          projectionSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      );
      expect(projection.runtimeExposedTools).toContain("web_search");
      expect(projection.runtimeExposedTools).not.toContain("apply_patch");
      expect(projection.readiness).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "tool:apply_patch",
            status: "blocked_by_policy",
          }),
          expect.objectContaining({
            id: "sandbox:unsupported",
            status: "unavailable",
          }),
          expect.objectContaining({
            id: "skill:research-brief",
            status: "missing",
          }),
        ]),
      );
    } finally {
      await services.shutdown();
    }
  });

  it("tracks coarse explicit overrides and copies target ownership on rollback", async () => {
    const services = await createRuntime();
    try {
      const seeded = services.store.listAgents()[0]!;
      const renamed = await services.store.updateAgent(seeded.id, {
        name: "Napier renamed",
      });
      expect(
        services.store.getAgentCapabilityBinding(renamed.id, renamed.revision),
      ).toEqual(
        expect.objectContaining({
          status: "valid",
          binding: expect.objectContaining({
            ownership: "recommended",
            explicitOverrideFields: [],
          }),
        }),
      );
      const restricted = await services.store.updateAgent(renamed.id, {
        enabledTools: ["list_files", "read_file", "search_files"],
      });
      expect(
        services.store.getAgentCapabilityBinding(
          restricted.id,
          restricted.revision,
        ),
      ).toEqual(
        expect.objectContaining({
          status: "valid",
          binding: expect.objectContaining({
            ownership: "explicit_overrides",
            explicitOverrideFields: ["enabledTools"],
          }),
        }),
      );
      const restrictedAgain = await services.store.updateAgent(restricted.id, {
        enabledTools: ["read_file"],
      });
      expect(
        services.store.getAgentCapabilityBinding(
          restrictedAgain.id,
          restrictedAgain.revision,
        ),
      ).toEqual(
        expect.objectContaining({
          status: "valid",
          binding: expect.objectContaining({
            explicitOverrideFields: ["enabledTools"],
          }),
        }),
      );

      const rolledBack = await services.store.rollbackAgent(
        restrictedAgain.id,
        seeded.revision,
      );
      expect(
        services.store.getAgentCapabilityBinding(
          rolledBack.agent.id,
          rolledBack.agent.revision,
        ),
      ).toEqual(
        expect.objectContaining({
          status: "valid",
          binding: expect.objectContaining({
            source: "rollback",
            ownership: "recommended",
            explicitOverrideFields: [],
          }),
        }),
      );
    } finally {
      await services.shutdown();
    }
  });

  it.each([
    [
      "pre-search" as const,
      "ac15ac4783ddfc45df07e112d5b50db5278d41cabd5eac17a55a1e38e171da70",
    ],
    [
      "search-fetch" as const,
      "2995f55cd7ea5ded57f11febe0342e3086cd48fe7913eb0c9832c603f7b4d265",
    ],
  ])(
    "detects the authentic %s historical fixture without changing its profile",
    async (name, expectedManagedSha256) => {
      const fixture = await createFixtureRuntime(name);
      const services = await fixture.create();
      const before = services.store.getAgent("agent_napier");
      try {
        expect(managedCapabilitySha256(before)).toBe(expectedManagedSha256);
        expect(
          services.store.getAgentCapabilityBinding(before.id, before.revision),
        ).toEqual(
          expect.objectContaining({
            status: "valid",
            binding: expect.objectContaining({
              source: "legacy_detected",
              ownership: "unknown_legacy",
              explicitOverrideFields: [
                "toolPolicy",
                "enabledTools",
                "enabledSkills",
                "enabledSubagents",
              ],
              legacySignatureSha256: expectedManagedSha256,
            }),
          }),
        );
        expect(await services.agentCapabilities.project(before.id)).toEqual(
          expect.objectContaining({ driftState: "stale" }),
        );
        expect(services.store.getAgent(before.id)).toEqual(before);
      } finally {
        await services.shutdown();
      }

      const restarted = await fixture.create();
      try {
        const after = restarted.store.getAgent("agent_napier");
        expect(after).toEqual(before);
        expect(managedCapabilitySha256(after)).toBe(expectedManagedSha256);
        const projection = await restarted.agentCapabilities.project(after.id);
        expect(projection).toEqual(
          expect.objectContaining({
            driftState: "stale",
            ownership: "unknown_legacy",
          }),
        );
        const renamed = await restarted.store.updateAgent(after.id, {
          name: `${after.name} renamed`,
        });
        const renamedProjection = await restarted.agentCapabilities.project(
          renamed.id,
        );
        expect(renamedProjection).toEqual(
          expect.objectContaining({
            driftState: "stale",
            ownership: "unknown_legacy",
            legacySignatureSha256: expectedManagedSha256,
          }),
        );
        const customized = await restarted.store.updateAgent(renamed.id, {
          enabledSkills: [...renamed.enabledSkills, "custom-skill"],
        });
        const customizedProjection = await restarted.agentCapabilities.project(
          customized.id,
        );
        expect(customizedProjection).toEqual(
          expect.objectContaining({
            driftState: "current",
            ownership: "explicit_overrides",
          }),
        );
        expect(customizedProjection).not.toHaveProperty(
          "legacySignatureSha256",
        );
        const restored = await restarted.agentCapabilities.restore(
          customized.id,
          {
            schemaVersion: 1,
            expectedRevision: customized.revision,
            diffSha256: customizedProjection.restorePreview.diffSha256,
          },
        );
        expect(restored.projection).toEqual(
          expect.objectContaining({
            agentRevision: customized.revision + 1,
            driftState: "current",
            ownership: "recommended",
          }),
        );
      } finally {
        await restarted.shutdown();
      }
    },
  );

  it("preserves an unknown configured tool while excluding it from runtime exposure", async () => {
    const services = await createRuntime();
    try {
      const seeded = services.store.listAgents()[0]!;
      const updated = await services.store.updateAgent(seeded.id, {
        enabledTools: [...seeded.enabledTools, "future_tool"],
      });
      const projection = await services.agentCapabilities.project(updated.id);
      expect(projection.configuredTools).toContain("future_tool");
      expect(projection.runtimeExposedTools).not.toContain("future_tool");
      expect(projection.readiness).toContainEqual(
        expect.objectContaining({
          id: "tool:future_tool",
          status: "unknown_configured",
        }),
      );
    } finally {
      await services.shutdown();
    }
  });

  it("fails closed on a simulated future contract binding without changing the profile", async () => {
    const fixture = await createFixtureRuntime("search-fetch");
    const statePath = path.join(fixture.dataRoot, "workspace.json");
    const state = JSON.parse(await readFile(statePath, "utf8")) as Record<
      string,
      unknown
    >;
    state.agentCapabilityBindings = [
      {
        schemaVersion: 1,
        agentId: "agent_napier",
        agentRevision: 1,
        contractId: "napier.default-agent.capabilities",
        contractVersion: 2,
        recommendationSha256: "f".repeat(64),
        source: "seeded",
        ownership: "recommended",
        explicitOverrideFields: [],
        appliedAt: "2026-08-06T18:05:03.298Z",
      },
    ];
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    const services = await fixture.create();
    try {
      const before = services.store.getAgent("agent_napier");
      const projection = await services.agentCapabilities.project(before.id);
      expect(projection).toEqual(
        expect.objectContaining({
          driftState: "broken",
          ownership: "unmanaged",
        }),
      );
      expect(services.store.getAgent(before.id)).toEqual(before);
    } finally {
      await services.shutdown();
    }
  });

  it("prunes deleted Agents but retains corrupt live-Agent orphans as broken", async () => {
    const services = await createRuntime();
    try {
      const seeded = services.store.listAgents()[0]!;
      const current = services.store.getAgentCapabilityBinding(
        seeded.id,
        seeded.revision,
      );
      expect(current.status).toBe("valid");
      if (current.status !== "valid")
        throw new Error("fixture binding missing");
      const records = ensureCurrentCapabilityBindings(
        [
          current.binding,
          { ...current.binding, agentId: "agent_deleted" },
          { ...current.binding, agentRevision: 999 },
        ],
        [seeded],
        services.store.listAgentRevisions(seeded.id),
      );
      expect(records).toEqual([
        current.binding,
        { ...current.binding, agentRevision: 999 },
      ]);
      expect(
        lookupCapabilityBinding(records, seeded.id, seeded.revision, {
          retainedRevisions: services.store.listAgentRevisions(seeded.id),
        }),
      ).toEqual(
        expect.objectContaining({
          status: "broken",
          detail: expect.stringContaining("Orphan"),
        }),
      );
    } finally {
      await services.shutdown();
    }
  });

  it("keeps V1 ownership under a simulated V2 recommendation history", async () => {
    const services = await createRuntime();
    try {
      const profile = services.store.listAgents()[0]!;
      const lookup = services.store.getAgentCapabilityBinding(
        profile.id,
        profile.revision,
      );
      expect(lookup.status).toBe("valid");
      if (lookup.status !== "valid") throw new Error("binding missing");
      const v2 = createAgentCapabilityContractRecommendation(2, {
        ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION,
        enabledSkills: [
          ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION.enabledSkills,
          "future-v2-skill",
        ],
      });
      const history = [...DEFAULT_AGENT_CAPABILITY_CONTRACT_HISTORY, v2];
      expect(validateCapabilityBinding(lookup.binding, history)).toEqual(
        lookup.binding,
      );
      expect(bindingMatchesProfile(lookup.binding, profile, history)).toBe(
        true,
      );
      const renamed = { ...profile, revision: 2, name: "V2 runtime name" };
      const propagated = propagateUpdatedCapabilityBinding(
        lookup.binding,
        profile,
        renamed,
        history,
      );
      expect(propagated).toEqual(
        expect.objectContaining({
          contractVersion: 1,
          recommendationSha256: DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_SHA256,
          ownership: "recommended",
          explicitOverrideFields: [],
        }),
      );
      const customized = {
        ...renamed,
        revision: 3,
        enabledSkills: ["future-v2-skill"],
      };
      const overridden = propagateUpdatedCapabilityBinding(
        propagated,
        renamed,
        customized,
        history,
      );
      expect(overridden).toEqual(
        expect.objectContaining({
          contractVersion: 1,
          recommendationSha256: DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_SHA256,
          ownership: "explicit_overrides",
          explicitOverrideFields: ["enabledSkills"],
        }),
      );
      expect(
        bindingMatchesProfile(overridden!, customized as never, history),
      ).toBe(true);
    } finally {
      await services.shutdown();
    }
  });

  it.each([
    { ownership: "recommended", explicitOverrideFields: ["enabledTools"] },
    { ownership: "explicit_overrides", explicitOverrideFields: [] },
    { source: "seeded", ownership: "unknown_legacy" },
    {
      source: "legacy_detected",
      ownership: "unknown_legacy",
      explicitOverrideFields: [
        "toolPolicy",
        "enabledTools",
        "enabledSkills",
        "enabledSubagents",
      ],
      legacySignatureSha256: "f".repeat(64),
    },
  ])("projects malformed binding combination as broken: %j", async (patch) => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-capability-invalid-binding-"),
    );
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);
    let services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      env: {},
      sandbox: new UnsupportedSandboxAdapter("capability-contract-test"),
    });
    await services.shutdown();
    await removeLedger(dataRoot);
    const statePath = path.join(dataRoot, "workspace.json");
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      agentCapabilityBindings: Array<Record<string, unknown>>;
    };
    state.agentCapabilityBindings = [
      { ...state.agentCapabilityBindings[0]!, ...patch },
    ];
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      env: {},
      sandbox: new UnsupportedSandboxAdapter("capability-contract-test"),
    });
    try {
      expect(await services.agentCapabilities.project("agent_napier")).toEqual(
        expect.objectContaining({
          driftState: "broken",
          ownership: "unmanaged",
        }),
      );
    } finally {
      await services.shutdown();
    }
  });

  it("never reports an available but policy-blocked Sandbox as ready", async () => {
    const readiness = await inspectSandboxReadiness(
      new UnsupportedSandboxAdapter("available-test"),
      async () => true,
    );
    expect(readiness).toEqual(
      expect.objectContaining({
        status: "available_unverified",
        allowedByPolicy: false,
        exposed: false,
      }),
    );
  });

  it("restores only an exact revision and hash-bound preview", async () => {
    const services = await createRuntime();
    try {
      const seeded = services.store.listAgents()[0]!;
      const restricted = await services.store.updateAgent(seeded.id, {
        enabledTools: ["list_files", "read_file", "search_files"],
        enabledSkills: [],
        enabledSubagents: [],
      });
      const preview = createCapabilityRestorePreview(restricted);
      await expect(
        services.agentCapabilities.restore(restricted.id, {
          schemaVersion: 1,
          expectedRevision: restricted.revision,
          diffSha256: "0".repeat(64),
        }),
      ).rejects.toThrow("refresh the preview");
      expect(services.store.getAgent(restricted.id)).toEqual(restricted);

      const restored = await services.agentCapabilities.restore(restricted.id, {
        schemaVersion: 1,
        expectedRevision: restricted.revision,
        diffSha256: preview.diffSha256,
      });
      expect(restored.previousRevision).toBe(restricted.revision);
      expect(restored.projection).toEqual(
        expect.objectContaining({
          driftState: "current",
          ownership: "recommended",
          explicitOverrideFields: [],
        }),
      );
      expect(
        managedCapabilityPayload(services.store.getAgent(restricted.id)),
      ).toEqual(DEFAULT_AGENT_CAPABILITY_RECOMMENDATION);
      await expect(
        services.agentCapabilities.restore(restricted.id, {
          schemaVersion: 1,
          expectedRevision: restricted.revision,
          diffSha256: preview.diffSha256,
        }),
      ).rejects.toThrow("refresh the preview");
    } finally {
      await services.shutdown();
    }
  });

  it("records an explicit metadata restore even when the managed diff is empty", async () => {
    const services = await createRuntime();
    try {
      const seeded = services.store.listAgents()[0]!;
      const preview = await services.agentCapabilities.project(seeded.id);
      expect(preview.restorePreview.operations).toEqual([]);
      const restored = await services.agentCapabilities.restore(seeded.id, {
        schemaVersion: 1,
        expectedRevision: seeded.revision,
        diffSha256: preview.restorePreview.diffSha256,
      });
      expect(restored.projection.agentRevision).toBe(seeded.revision + 1);
      expect(
        services.store.getAgentRevision(
          seeded.id,
          restored.projection.agentRevision,
        ),
      ).toEqual(
        expect.objectContaining({ source: "migrated", changedFields: [] }),
      );
      expect(
        services.store.getAgentCapabilityBinding(
          seeded.id,
          restored.projection.agentRevision,
        ),
      ).toEqual(
        expect.objectContaining({
          status: "valid",
          binding: expect.objectContaining({ source: "explicit_restore" }),
        }),
      );
    } finally {
      await services.shutdown();
    }
  });

  it("retains malformed non-array metadata as actionable broken state across restarts", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-capability-corrupt-"),
    );
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);
    let services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      env: {},
      sandbox: new UnsupportedSandboxAdapter("capability-contract-test"),
    });
    await services.shutdown();
    await removeLedger(dataRoot);
    const statePath = path.join(dataRoot, "workspace.json");
    const state = JSON.parse(await readFile(statePath, "utf8")) as Record<
      string,
      unknown
    >;
    state.agentCapabilityBindings = { corrupt: true };
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      env: {},
      sandbox: new UnsupportedSandboxAdapter("capability-contract-test"),
    });
    expect(await services.agentCapabilities.project("agent_napier")).toEqual(
      expect.objectContaining({
        driftState: "broken",
        ownership: "unmanaged",
      }),
    );
    await services.shutdown();

    services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      env: {},
      sandbox: new UnsupportedSandboxAdapter("capability-contract-test"),
    });
    const broken = await services.agentCapabilities.project("agent_napier");
    expect(broken).toEqual(expect.objectContaining({ driftState: "broken" }));
    const repaired = await services.agentCapabilities.restore("agent_napier", {
      schemaVersion: 1,
      expectedRevision: broken.agentRevision,
      diffSha256: broken.restorePreview.diffSha256,
    });
    expect(repaired.projection).toEqual(
      expect.objectContaining({
        agentRevision: broken.agentRevision + 1,
        driftState: "current",
        ownership: "recommended",
      }),
    );
    await services.shutdown();
  });

  it("prunes only deleted-Agent and actually pruned-revision bindings through LocalStore restart", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-capability-prune-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);
    let services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      env: {},
      sandbox: new UnsupportedSandboxAdapter("capability-contract-test"),
    });
    const first = services.store.listAgents()[0]!;
    await services.store.updateAgent(first.id, { name: "Revision two" });
    const current = await services.store.updateAgent(first.id, {
      name: "Revision three",
    });
    await services.shutdown();
    await removeLedger(dataRoot);
    const statePath = path.join(dataRoot, "workspace.json");
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      agentRevisions: Array<{ agentId: string; revision: number }>;
      agentCapabilityBindings: Array<Record<string, unknown>>;
    };
    state.agentRevisions = state.agentRevisions.filter(
      (revision) => revision.revision === current.revision,
    );
    state.agentCapabilityBindings.push({
      ...state.agentCapabilityBindings.at(-1)!,
      agentId: "agent_deleted",
    });
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      env: {},
      sandbox: new UnsupportedSandboxAdapter("capability-contract-test"),
    });
    expect(
      services.store.getAgentCapabilityBinding(first.id, current.revision),
    ).toEqual(expect.objectContaining({ status: "valid" }));
    await services.shutdown();
    const normalized = JSON.parse(await readFile(statePath, "utf8")) as {
      agentCapabilityBindings: Array<{
        agentId: string;
        agentRevision: number;
      }>;
    };
    expect(normalized.agentCapabilityBindings).toEqual([
      expect.objectContaining({
        agentId: first.id,
        agentRevision: current.revision,
      }),
    ]);
  });

  it("rolls back in-memory restore state on persistence failure and restarts cleanly", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-capability-fault-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);
    let services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      env: {},
      sandbox: new UnsupportedSandboxAdapter("capability-contract-test"),
    });
    const seeded = services.store.listAgents()[0]!;
    const drifted = await services.store.updateAgent(seeded.id, {
      enabledTools: ["read_file"],
    });
    const projection = await services.agentCapabilities.project(drifted.id);
    const commit = vi
      .spyOn(SqliteLedger.prototype, "commit")
      .mockImplementationOnce(() => {
        throw new Error("synthetic persistence fault");
      });
    await expect(
      services.agentCapabilities.restore(drifted.id, {
        schemaVersion: 1,
        expectedRevision: drifted.revision,
        diffSha256: projection.restorePreview.diffSha256,
      }),
    ).rejects.toBeInstanceOf(CapabilityRestorePersistenceError);
    commit.mockRestore();
    expect(services.store.getAgent(drifted.id)).toEqual(drifted);
    await services.shutdown();

    services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      env: {},
      sandbox: new UnsupportedSandboxAdapter("capability-contract-test"),
    });
    expect(services.store.getAgent(drifted.id)).toEqual(drifted);
    expect(await services.agentCapabilities.project(drifted.id)).toEqual(
      expect.objectContaining({
        agentRevision: drifted.revision,
        ownership: "explicit_overrides",
      }),
    );
    await services.shutdown();
  });

  it("fails an interrupted stale restore and projects the exact atomic commit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-capability-cas-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);
    const first = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      env: {},
      sandbox: new UnsupportedSandboxAdapter("capability-contract-test"),
    });
    const second = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      env: {},
      sandbox: new UnsupportedSandboxAdapter("capability-contract-test"),
    });
    const seeded = first.store.listAgents()[0]!;
    const preview = await first.agentCapabilities.project(seeded.id);
    const advanced = await second.store.updateAgent(seeded.id, {
      name: "Concurrent update",
    });
    await expect(
      first.agentCapabilities.restore(seeded.id, {
        schemaVersion: 1,
        expectedRevision: seeded.revision,
        diffSha256: preview.restorePreview.diffSha256,
      }),
    ).rejects.toThrow("refresh the preview");
    expect(first.store.getAgent(seeded.id)).toEqual(advanced);

    const authoritative = await first.agentCapabilities.project(seeded.id);
    const originalRestore =
      first.store.restoreRecommendedAgentCapabilities.bind(first.store);
    vi.spyOn(
      first.store,
      "restoreRecommendedAgentCapabilities",
    ).mockImplementationOnce(async (agentId, request) => {
      const committed = await originalRestore(agentId, request);
      await first.store.updateAgent(agentId, { name: "After commit" });
      return committed;
    });
    const restored = await first.agentCapabilities.restore(seeded.id, {
      schemaVersion: 1,
      expectedRevision: authoritative.agentRevision,
      diffSha256: authoritative.restorePreview.diffSha256,
    });
    expect(restored.projection.agentRevision).toBe(advanced.revision + 1);
    expect(first.store.getAgent(seeded.id).revision).toBe(
      advanced.revision + 2,
    );
    await second.shutdown();
    await first.shutdown();
  });
});

async function removeLedger(dataRoot: string): Promise<void> {
  await Promise.all(
    ["ledger.sqlite", "ledger.sqlite-shm", "ledger.sqlite-wal"].map((name) =>
      rm(path.join(dataRoot, name), { force: true }),
    ),
  );
}
