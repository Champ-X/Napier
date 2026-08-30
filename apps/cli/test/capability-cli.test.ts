import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import {
  AGENT_CAPABILITY_PRESETS,
  agentCapabilityPresetUpdate,
  agentCapabilityStatus,
} from "@napier/contracts/agent-capabilities";
import {
  createLocalAgentRuntime,
  UnsupportedSandboxAdapter,
  type LocalAgentRuntimeOptions,
} from "@napier/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseCliArgs, runCli } from "../src/cli.js";
import type { CliIo, RunCliDependencies } from "../src/cli-runtime.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent capability presets", () => {
  it("defines legacy task presets plus three honest permission levels", () => {
    expect(AGENT_CAPABILITY_PRESETS.map((preset) => preset.id)).toEqual([
      "coding",
      "research",
      "data",
      "browser",
      "safe_automation",
      "read_only",
      "full_access",
    ]);
    for (const preset of AGENT_CAPABILITY_PRESETS) {
      const status = agentCapabilityStatus({
        ...agentCapabilityPresetUpdate(preset.id),
      });
      expect(status.presetId).toBe(preset.id);
      expect(status.browserInteract).toBe(false);
      expect(status.browserInteractWithConfirmation).toBe(
        preset.id === "safe_automation" || preset.id === "full_access",
      );
      expect(new Set(preset.enabledTools).size).toBe(
        preset.enabledTools.length,
      );
    }
    expect(
      agentCapabilityStatus(agentCapabilityPresetUpdate("browser")),
    ).toEqual(
      expect.objectContaining({
        label: "Browser",
        toolPolicy: "observe",
        networkRead: true,
        browserRead: true,
        browserInteract: false,
        browserInteractWithConfirmation: false,
        workspaceWrite: false,
        processExecution: false,
      }),
    );
    expect(agentCapabilityPresetUpdate("browser").enabledSkills).toEqual([
      "research-brief",
      "browser-automation",
    ]);
    expect(
      agentCapabilityPresetUpdate("safe_automation").enabledSkills,
    ).toContain("browser-automation");
    expect(
      agentCapabilityStatus(agentCapabilityPresetUpdate("safe_automation")),
    ).toEqual(
      expect.objectContaining({
        label: "Safe Automation",
        toolPolicy: "workspace",
        browserRead: true,
        browserInteract: false,
        browserInteractWithConfirmation: true,
        workspaceWrite: true,
        processExecution: true,
      }),
    );
    expect(
      agentCapabilityStatus(agentCapabilityPresetUpdate("full_access")),
    ).toEqual(
      expect.objectContaining({
        label: "Full access",
        toolPolicy: "unrestricted",
        workspaceWrite: true,
        processExecution: true,
      }),
    );
  });

  it("parses strict status, preview, and apply commands", () => {
    expect(
      parseCliArgs([
        "capabilities",
        "--workspace",
        ".",
        "--preset",
        "browser",
        "--jsonl",
      ]),
    ).toEqual({
      kind: "capabilities",
      options: {
        workspace: ".",
        presetId: "browser",
        upgradeRecommended: false,
        restoreRecommended: false,
        apply: false,
        jsonl: true,
      },
    });
    expect(() =>
      parseCliArgs(["capabilities", "--workspace", ".", "--apply"]),
    ).toThrow("--apply requires --preset, --upgrade-recommended");
    expect(() =>
      parseCliArgs([
        "capabilities",
        "--workspace",
        ".",
        "--restore-recommended",
        "--apply",
      ]),
    ).toThrow("Capability apply requires");
    expect(() =>
      parseCliArgs([
        "capabilities",
        "--workspace",
        ".",
        "--expected-revision",
        "1",
      ]),
    ).toThrow("require --upgrade-recommended or --restore-recommended");
    expect(
      parseCliArgs([
        "capabilities",
        "--workspace",
        ".",
        "--upgrade-recommended",
      ]),
    ).toEqual(
      expect.objectContaining({
        kind: "capabilities",
        options: expect.objectContaining({
          upgradeRecommended: true,
          restoreRecommended: false,
          apply: false,
        }),
      }),
    );
    expect(() =>
      parseCliArgs([
        "capabilities",
        "--workspace",
        ".",
        "--preset",
        "unrestricted",
      ]),
    ).toThrow("--preset must be one of");
  });

  it("additively includes the authoritative projection in default JSONL status", async () => {
    const fixture = await createFixture();
    const stdout = new CaptureWritable();
    expect(
      await runCli(
        [
          "capabilities",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--jsonl",
        ],
        cliIo(fixture.root, stdout, new CaptureWritable()),
        dependencies(),
      ),
    ).toBe(0);
    const result = JSON.parse(stdout.text());
    expect(Object.keys(result).sort()).toEqual(
      [
        "action",
        "agentId",
        "agentRevision",
        "kind",
        "projection",
        "schemaVersion",
        "status",
      ].sort(),
    );
    expect(result).toEqual(
      expect.objectContaining({
        kind: "napier.agent-capability-status",
        schemaVersion: 1,
        action: "status",
        agentId: "agent_napier",
        agentRevision: 1,
        projection: expect.objectContaining({
          kind: "napier.effective-agent-capabilities",
          schemaVersion: 1,
          agentId: "agent_napier",
          agentRevision: 1,
          driftState: "current",
          ownership: "recommended",
          projectionSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(result.status).toEqual(
      agentCapabilityStatus({
        toolPolicy: result.projection.toolPolicy,
        enabledTools: result.projection.configuredTools,
        enabledSkills: result.projection.configuredSkills,
        enabledSubagents: result.projection.configuredSubagents,
      }),
    );
  });

  it("previews and applies only the exact safe contract upgrade", async () => {
    const fixture = await createFixture();
    const previewOut = new CaptureWritable();
    expect(
      await runCli(
        [
          "capabilities",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--upgrade-recommended",
          "--jsonl",
        ],
        cliIo(fixture.root, previewOut, new CaptureWritable()),
        upgradeDependencies(),
      ),
    ).toBe(0);
    const preview = JSON.parse(previewOut.text());
    expect(preview).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        action: "upgrade_preview",
        projection: expect.objectContaining({
          driftState: "stale",
          ownership: "explicit_overrides",
          upgradePreview: expect.objectContaining({
            sourceContractVersion: 2,
            targetContractVersion: 3,
            explicitOverrideFields: ["enabledSkills"],
          }),
        }),
      }),
    );

    const applyOut = new CaptureWritable();
    expect(
      await runCli(
        [
          "capabilities",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--upgrade-recommended",
          "--expected-revision",
          "1",
          "--diff-sha256",
          preview.projection.upgradePreview.diffSha256,
          "--apply",
          "--jsonl",
        ],
        cliIo(fixture.root, applyOut, new CaptureWritable()),
        upgradeDependencies(),
      ),
    ).toBe(0);
    expect(JSON.parse(applyOut.text())).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        action: "upgraded",
        agentRevision: 2,
        projection: expect.objectContaining({
          driftState: "current",
          ownership: "explicit_overrides",
          explicitOverrideFields: ["enabledSkills"],
        }),
      }),
    );
  });

  it("previews without mutation and applies one revision through the Store", async () => {
    const fixture = await createFixture();
    const previewOut = new CaptureWritable();
    const previewCode = await runCli(
      [
        "capabilities",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--preset",
        "browser",
        "--jsonl",
      ],
      cliIo(fixture.root, previewOut, new CaptureWritable()),
      dependencies(),
    );
    expect(previewCode).toBe(0);
    const preview = JSON.parse(previewOut.text());
    expect(preview).toEqual(
      expect.objectContaining({
        kind: "napier.agent-capability-status",
        schemaVersion: 1,
        action: "preview",
        agentRevision: 1,
        status: expect.objectContaining({
          presetId: "browser",
          browserRead: true,
          browserInteract: false,
        }),
      }),
    );
    expect(preview).not.toHaveProperty("projection");
    let services = await createLocalAgentRuntime({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("capability-inspect"),
    });
    expect(services.store.getAgent("agent_napier").revision).toBe(1);
    await services.shutdown();

    const applyOut = new CaptureWritable();
    const applyCode = await runCli(
      [
        "capabilities",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--preset",
        "browser",
        "--apply",
        "--jsonl",
      ],
      cliIo(fixture.root, applyOut, new CaptureWritable()),
      dependencies(),
    );
    expect(applyCode).toBe(0);
    const applied = JSON.parse(applyOut.text());
    expect(applied).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        action: "applied",
        agentRevision: 2,
        status: expect.objectContaining({
          presetId: "browser",
          policyLabel: "Read only",
          browserInteract: false,
        }),
      }),
    );
    expect(applied).not.toHaveProperty("projection");
    expect(Object.keys(applied).sort()).toEqual(
      [
        "action",
        "agentId",
        "agentRevision",
        "kind",
        "preset",
        "schemaVersion",
        "status",
      ].sort(),
    );
    services = await createLocalAgentRuntime({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("capability-inspect"),
    });
    const agent = services.store.getAgent("agent_napier");
    expect(agent.revision).toBe(2);
    expect(agent.toolPolicy).toBe("observe");
    expect([...agent.enabledTools].sort()).toEqual(
      [...agentCapabilityPresetUpdate("browser").enabledTools].sort(),
    );
    expect(services.store.listAgentRevisions(agent.id)).toHaveLength(2);
    await services.shutdown();
  });

  it("previews and applies a recommendation restore with exact CAS inputs", async () => {
    const fixture = await createFixture();
    await runCli(
      [
        "capabilities",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--preset",
        "browser",
        "--apply",
        "--jsonl",
      ],
      cliIo(fixture.root, new CaptureWritable(), new CaptureWritable()),
      dependencies(),
    );

    const previewOut = new CaptureWritable();
    expect(
      await runCli(
        [
          "capabilities",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--restore-recommended",
          "--jsonl",
        ],
        cliIo(fixture.root, previewOut, new CaptureWritable()),
        dependencies(),
      ),
    ).toBe(0);
    const preview = JSON.parse(previewOut.text());
    expect(preview).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        action: "restore_preview",
        agentRevision: 2,
        projection: expect.objectContaining({
          driftState: "current",
          ownership: "explicit_overrides",
          restorePreview: expect.objectContaining({
            diffSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        }),
      }),
    );

    const staleOut = new CaptureWritable();
    expect(
      await runCli(
        [
          "capabilities",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--restore-recommended",
          "--apply",
          "--expected-revision",
          "2",
          "--diff-sha256",
          "0".repeat(64),
          "--jsonl",
        ],
        cliIo(fixture.root, new CaptureWritable(), staleOut),
        dependencies(),
      ),
    ).toBe(1);
    expect(staleOut.text()).toContain("refresh the preview");

    const restoreOut = new CaptureWritable();
    expect(
      await runCli(
        [
          "capabilities",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--restore-recommended",
          "--apply",
          "--expected-revision",
          "2",
          "--diff-sha256",
          preview.projection.restorePreview.diffSha256,
          "--jsonl",
        ],
        cliIo(fixture.root, restoreOut, new CaptureWritable()),
        postCommitCapabilityMutationDependencies(),
      ),
    ).toBe(0);
    const restored = JSON.parse(restoreOut.text());
    expect(restored).toEqual(
      expect.objectContaining({
        action: "restored",
        agentRevision: 3,
        projection: expect.objectContaining({
          driftState: "current",
          ownership: "recommended",
        }),
      }),
    );
    expect(restored.agentRevision).toBe(restored.projection.agentRevision);
    expect(restored.status).toEqual(
      agentCapabilityStatus({
        toolPolicy: restored.projection.toolPolicy,
        enabledTools: restored.projection.configuredTools,
        enabledSkills: restored.projection.configuredSkills,
        enabledSubagents: restored.projection.configuredSubagents,
      }),
    );
    const after = await createLocalAgentRuntime({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("capability-inspect"),
    });
    expect(after.store.getAgent("agent_napier").revision).toBe(4);
    expect(after.store.getAgent("agent_napier").enabledSkills).toEqual([
      "browser-automation",
      "research-brief",
    ]);
    await after.shutdown();
  });

  it("renders an auditable restore command without non-managed Profile text", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier capability 'cli-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace 'quoted");
    const dataRoot = path.join(root, "state 'quoted");
    await mkdir(workspaceRoot);
    let services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      sandbox: new UnsupportedSandboxAdapter("capability-inspect"),
    });
    const seeded = services.store.listAgents()[0]!;
    const legacy = await services.store.updateAgent(seeded.id, {
      name: "PRIVATE_PROFILE_NAME",
      systemPrompt: "PRIVATE_PROFILE_PROMPT",
      enabledTools: ["list_files"],
      enabledSkills: ["research-brief"],
      enabledSubagents: ["reviewer"],
    });
    await services.shutdown();

    const jsonOut = new CaptureWritable();
    expect(
      await runCli(
        [
          "capabilities",
          "--workspace",
          workspaceRoot,
          "--data-root",
          dataRoot,
          "--restore-recommended",
          "--jsonl",
        ],
        cliIo(root, jsonOut, new CaptureWritable()),
        dependencies(),
      ),
    ).toBe(0);
    const preview = JSON.parse(jsonOut.text());
    const humanOut = new CaptureWritable();
    expect(
      await runCli(
        [
          "capabilities",
          "--workspace",
          workspaceRoot,
          "--data-root",
          dataRoot,
          "--restore-recommended",
        ],
        cliIo(root, humanOut, new CaptureWritable()),
        dependencies(),
      ),
    ).toBe(0);

    expect(humanOut.text()).toContain(
      `Restore operations (${String(preview.projection.restorePreview.operations.length)}):`,
    );
    expect(humanOut.text()).toContain(
      'HIGH workspace_write · enabledTools add "apply_patch"',
    );
    expect(humanOut.text()).toContain(
      [
        "Apply: napier capabilities",
        "--workspace",
        shellArgument(workspaceRoot),
        "--data-root",
        shellArgument(dataRoot),
        "--agent",
        shellArgument(legacy.id),
        "--restore-recommended",
        "--expected-revision",
        String(legacy.revision),
        "--diff-sha256",
        preview.projection.restorePreview.diffSha256,
        "--apply",
      ].join(" "),
    );
    expect(humanOut.text()).not.toContain("PRIVATE_PROFILE_NAME");
    expect(humanOut.text()).not.toContain("PRIVATE_PROFILE_PROMPT");

    services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      sandbox: new UnsupportedSandboxAdapter("capability-inspect"),
    });
    expect(services.store.getAgent(legacy.id).revision).toBe(legacy.revision);
    await services.shutdown();
  });
});

function dependencies(): RunCliDependencies {
  return {
    createRuntime(options: LocalAgentRuntimeOptions) {
      return createLocalAgentRuntime({
        ...options,
        sandbox: new UnsupportedSandboxAdapter("capability-cli"),
      });
    },
  };
}

function postCommitCapabilityMutationDependencies(): RunCliDependencies {
  return {
    async createRuntime(options: LocalAgentRuntimeOptions) {
      const services = await createLocalAgentRuntime({
        ...options,
        sandbox: new UnsupportedSandboxAdapter("capability-cli"),
      });
      const restore = services.agentCapabilities.restore.bind(
        services.agentCapabilities,
      );
      vi.spyOn(services.agentCapabilities, "restore").mockImplementationOnce(
        async (agentId, request) => {
          const committed = await restore(agentId, request);
          await services.store.updateAgent(
            agentId,
            agentCapabilityPresetUpdate("browser"),
          );
          return committed;
        },
      );
      return services;
    },
  };
}

function upgradeDependencies(): RunCliDependencies {
  return {
    async createRuntime(options: LocalAgentRuntimeOptions) {
      const services = await createLocalAgentRuntime({
        ...options,
        sandbox: new UnsupportedSandboxAdapter("capability-cli"),
      });
      const current = await services.agentCapabilities.project("agent_napier");
      const upgradePreview = {
        schemaVersion: 1 as const,
        contractId: "napier.default-agent.capabilities" as const,
        sourceContractVersion: 2,
        targetContractVersion: 3,
        sourceRecommendationSha256: "a".repeat(64),
        targetRecommendationSha256: current.recommendationSha256,
        agentId: "agent_napier",
        agentRevision: 1,
        explicitOverrideFields: ["enabledSkills" as const],
        currentManagedStateSha256: "b".repeat(64),
        targetManagedStateSha256: "c".repeat(64),
        operations: [
          {
            field: "enabledTools" as const,
            operation: "add" as const,
            value: "skill_load",
            effect: "read" as const,
            risk: "low" as const,
          },
        ],
        diffSha256: "d".repeat(64),
      };
      const stale = {
        ...current,
        driftState: "stale" as const,
        ownership: "explicit_overrides" as const,
        explicitOverrideFields: ["enabledSkills" as const],
        upgradePreview,
      };
      vi.spyOn(services.agentCapabilities, "project").mockResolvedValue(stale);
      vi.spyOn(services.agentCapabilities, "upgrade").mockImplementation(
        async (_agentId, request) => {
          expect(request).toEqual({
            schemaVersion: 1,
            expectedRevision: 1,
            diffSha256: "d".repeat(64),
          });
          return {
            schemaVersion: 1,
            previousRevision: 1,
            projection: {
              ...stale,
              agentRevision: 2,
              driftState: "current",
              upgradePreview: undefined,
            },
          };
        },
      );
      return services;
    },
  };
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-capability-cli-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "state");
  await mkdir(workspaceRoot);
  return { root, workspaceRoot, dataRoot };
}

function cliIo(cwd: string, stdout: Writable, stderr: Writable): CliIo {
  return { cwd, env: {}, stdout, stderr };
}

class CaptureWritable extends Writable {
  private readonly chunks: string[] = [];

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString("utf8"));
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}

function shellArgument(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
