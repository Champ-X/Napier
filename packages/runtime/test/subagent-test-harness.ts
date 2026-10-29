import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxProvider } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentProfile, SubagentLimits } from "@napier/contracts";
import { Type } from "typebox";
import { vi } from "vitest";

import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import { SubagentCoordinator } from "../src/subagents.js";

const temporaryRoots: string[] = [];

export async function cleanupSubagentHarnesses() {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
}

export async function createHarness(
  limits: Partial<SubagentLimits> = {},
  profileOverrides: Partial<AgentProfile> = {},
  createInheritedTools?: () => AgentTool[],
) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-subagent-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const store = new LocalStore({
    dataRoot: path.join(root, "data"),
    workspaceRoot,
  });
  await store.initialize();
  const seededAgent = store.listAgents()[0]!;
  const profile = await store.updateAgent(seededAgent.id, {
    ...seededAgent,
    enabledSubagents: ["researcher"],
    subagentLimits: {
      maxConcurrent: 1,
      maxTotal: 2,
      maxTurns: 4,
      timeoutMs: 5_000,
      ...limits,
    },
    ...profileOverrides,
  });
  const thread = await store.createThread({
    title: "Subagent harness",
    agentId: profile.id,
  });
  const run = await store.createRun({
    threadId: thread.id,
    agentId: profile.id,
  });
  const faux = fauxProvider({ provider: `faux-${run.id}` });
  const registry = new ModelRegistry();
  registry.registerProvider(faux.provider);
  const model = registry.resolve({
    provider: faux.provider.id,
    id: "faux-1",
  });
  if (!model) throw new Error("Faux model was not registered");
  const parentAbort = new AbortController();
  const coordinator = new SubagentCoordinator({
    store,
    models: registry.models,
    model,
    run,
    profile,
    sandbox: { id: "unused", launch: vi.fn() },
    ...(createInheritedTools ? { createInheritedTools } : {}),
    worktreeOwnerId: "worker_test_subagents",
    parentSignal: parentAbort.signal,
  });
  return {
    store,
    thread,
    run,
    profile,
    faux,
    registry,
    model,
    coordinator,
    parentAbort,
  };
}

export const delegatedTask = {
  role: "researcher" as const,
  description: "Inspect isolation",
  task: "Inspect the workspace boundary and return concise evidence.",
};

export function typedResult(summary: string): string {
  return JSON.stringify({
    summary,
    items: [],
    unknowns: [],
  });
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function inheritedTool(name: string): AgentTool {
  return {
    name,
    label: name,
    description: `${name} fixture`,
    parameters: Type.Object({}),
    execute: async () => ({
      content: [{ type: "text", text: `${name} result` }],
      details: {},
    }),
  };
}
