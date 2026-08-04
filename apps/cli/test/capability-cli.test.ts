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
import { afterEach, describe, expect, it } from "vitest";

import { parseCliArgs, runCli } from "../src/cli.js";
import type { CliIo, RunCliDependencies } from "../src/cli-runtime.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent capability presets", () => {
  it("defines five honest presets without granting Browser interaction", () => {
    expect(AGENT_CAPABILITY_PRESETS.map((preset) => preset.id)).toEqual([
      "coding",
      "research",
      "data",
      "browser",
      "safe_automation",
    ]);
    for (const preset of AGENT_CAPABILITY_PRESETS) {
      const status = agentCapabilityStatus({
        ...agentCapabilityPresetUpdate(preset.id),
      });
      expect(status.presetId).toBe(preset.id);
      expect(status.browserInteract).toBe(false);
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
        workspaceWrite: false,
        processExecution: false,
      }),
    );
    expect(
      agentCapabilityStatus(agentCapabilityPresetUpdate("safe_automation")),
    ).toEqual(
      expect.objectContaining({
        label: "Safe Automation",
        toolPolicy: "workspace",
        browserRead: true,
        browserInteract: false,
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
        apply: false,
        jsonl: true,
      },
    });
    expect(() =>
      parseCliArgs(["capabilities", "--workspace", ".", "--apply"]),
    ).toThrow("--apply requires --preset");
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
        action: "preview",
        agentRevision: 1,
        status: expect.objectContaining({
          presetId: "browser",
          browserRead: true,
          browserInteract: false,
        }),
      }),
    );
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
    expect(JSON.parse(applyOut.text())).toEqual(
      expect.objectContaining({
        action: "applied",
        agentRevision: 2,
        status: expect.objectContaining({
          presetId: "browser",
          policyLabel: "Read only",
          browserInteract: false,
        }),
      }),
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
