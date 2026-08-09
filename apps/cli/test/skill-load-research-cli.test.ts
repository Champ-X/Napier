import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { StreamFrame } from "@napier/contracts";
import { isSkillCatalogBindingV1 } from "@napier/contracts/skill-load";
import { isSkillLifecycleProjectionV1 } from "@napier/contracts/skill-lifecycle";
import {
  createLocalAgentRuntime,
  UnsupportedSandboxAdapter,
  type LocalAgentRuntimeOptions,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { runCli, type RunCliDependencies } from "../src/cli.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Research Skill load CLI", () => {
  it("runs skill_load through JSONL without revising the persistent default profile", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-skill-cli-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    for (const name of ["research-brief", "data-analysis"]) {
      const directory = path.join(workspaceRoot, "skills", name);
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${name} CLI fixture.\n---\n\n# PRIVATE_${name}\n`,
      );
    }
    const provider = fauxProvider({ provider: "faux-skill-cli" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("skill_load", { name: "research-brief" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("CLI_SKILL_LOAD_COMPLETE"),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();

    const code = await runCli(
      [
        "run",
        "--workspace",
        workspaceRoot,
        "--data-root",
        dataRoot,
        "--prompt",
        "Use the Research Brief Skill.",
        "--model",
        "faux-skill-cli/faux-1",
        "--jsonl",
      ],
      { cwd: root, env: {}, stdout, stderr },
      dependencies(provider),
    );

    expect(code, stderr.text()).toBe(0);
    const frames = stdout
      .text()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as StreamFrame);
    expect(frames.at(-1)).toEqual(
      expect.objectContaining({ type: "done", status: "completed" }),
    );
    const events = frames.flatMap((frame) =>
      frame.type === "event" ? [frame.event] : [],
    );
    expect(
      events.find((event) => event.type === "context.skills")?.payload,
    ).toSatisfy(isSkillCatalogBindingV1);
    expect(
      events.find(
        (event) =>
          event.type === "tool.completed" &&
          record(event.payload)?.toolName === "skill_load",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        operation: "skill.load",
        outputRedacted: true,
        details: expect.objectContaining({
          state: "loaded",
          name: "research-brief",
        }),
      }),
    );
    const lifecycle = events.find(
      (event) =>
        event.type === "skill.lifecycle" &&
        event.payload?.skillName === "research-brief",
    );
    expect(isSkillLifecycleProjectionV1(lifecycle?.payload)).toBe(true);
    expect(lifecycle?.payload).toEqual(
      expect.objectContaining({
        skillName: "research-brief",
        state: "loaded",
        source: "project",
        rootKind: "project_legacy",
      }),
    );
    expect(stdout.text()).not.toContain("PRIVATE_research-brief");
    expect(stdout.text()).not.toContain(workspaceRoot);

    const reopened = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      sandbox: new UnsupportedSandboxAdapter("skill-cli-reopen"),
    });
    try {
      const agent = reopened.store.listAgents()[0]!;
      const persistedThread = reopened.store.listThreads()[0]!;
      const persistedLifecycle = (
        await reopened.store.listEvents(persistedThread.id)
      ).find(
        (event) =>
          event.type === "skill.lifecycle" &&
          event.payload?.skillName === "research-brief",
      );
      expect(isSkillLifecycleProjectionV1(persistedLifecycle?.payload)).toBe(
        true,
      );
      expect(persistedLifecycle?.payload).toEqual(lifecycle?.payload);
      expect(agent.enabledTools).toContain("skill_load");
      expect(agent.enabledSkills).toEqual([
        "artifact-studio",
        "browser-automation",
        "data-analysis",
        "research-brief",
        "software-delivery",
      ]);
      expect(reopened.store.listAgentRevisions(agent.id)).toHaveLength(1);
    } finally {
      await reopened.shutdown();
    }
  });
});

function dependencies(
  provider: ReturnType<typeof fauxProvider>,
): RunCliDependencies {
  return {
    async createRuntime(options: LocalAgentRuntimeOptions) {
      const services = await createLocalAgentRuntime({
        ...options,
        sandbox: new UnsupportedSandboxAdapter("skill-cli-test"),
      });
      services.models.registerProvider(provider.provider);
      return services;
    },
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
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
