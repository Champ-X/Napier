import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxProvider } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentProfile, RunEvent, RunLimits, SubagentRequest } from "@napier/contracts";

import { InProcessSubagentProvider } from "../src/in-process-subagent-provider.js";
import { ModelRouter } from "../src/model-route.js";
import { ModelUsageReceiptSpool } from "../src/model-usage-source.js";
import { createLocalModelCallAdmission } from "../src/model-call-local-admission.js";
import { ModelRegistry } from "../src/models.js";
import type { ModelCallAdmission } from "../src/model-call-admission.js";
import { LocalStore } from "../src/store.js";
import { SubagentSupervisor } from "../src/subagent-supervisor.js";
import { ToolConcurrencyGate } from "../src/tool-concurrency-gate.js";

const roots: string[] = [];
const accountingClosers: Array<() => Promise<void>> = [];
export const SYNTHETIC_ROUTE_KEY = "subagent-session-fixture-not-a-secret";

export async function cleanupModelSessionFixtures(): Promise<void> {
  await Promise.all(accountingClosers.splice(0).map((close) => close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

export async function createModelSessionFixture(options: {
  onEvent?: (event: RunEvent) => Promise<void> | void;
  routeCredential?: boolean;
  maxTurns?: number;
  timeoutMs?: number;
  admission?: ModelCallAdmission;
  nativeAccounting?: boolean;
  reasoning?: boolean;
  runLimits?: Partial<RunLimits>;
  createInheritedTools?: () => AgentTool[];
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-subagent-model-session-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({ workspaceRoot, dataRoot: path.join(root, "data") });
  await store.initialize();
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({ title: "Child ModelSession", agentId: agent.id });
  const faux = fauxProvider({
    provider: `faux-${thread.id}`,
    api: "openai-responses",
    tokensPerSecond: 1_000_000,
    ...(options.reasoning ? { models: [{ id: "faux-1", reasoning: true }] } : {}),
  });
  const source = options.nativeAccounting ? await ModelUsageReceiptSpool.open(path.join(root, "usage.sqlite")) : undefined;
  if (source) {
    store.modelAccountingRepository.configureSource({ source, isDeclaredZeroCost: (model) => model.provider === faux.provider.id });
    accountingClosers.push(async () => { await store.shutdown(); source.close(); });
  }
  const registry = new ModelRegistry(undefined, source ? createLocalModelCallAdmission(source, options.admission) : options.admission,
    source ? store.modelAccountingRepository : undefined);
  registry.registerProvider(faux.provider);
  const model = registry.resolve({ provider: faux.provider.id, id: "faux-1" })!;
  let profile: AgentProfile = agent;
  let modelRouter = new ModelRouter(store, registry);
  if (options.routeCredential) {
    const credential = await store.createCredentialReference({
      providerId: faux.provider.id,
      label: "Synthetic route-only credential",
      source: { type: "environment", variable: "NAPIER_SYNTHETIC_SESSION_KEY" },
    });
    // Only the route owns this synthetic credential. A default registry credential
    // would hide an invocation that accidentally discards the selected route key.
    modelRouter = new ModelRouter(store, {
      resolveConfigured: (reference) => registry.resolveConfigured(reference),
      credentialReferences: {
        readReference: async (id) => {
          if (id !== credential.id) throw new Error("Unexpected fixture credential");
          return { type: "api_key", key: SYNTHETIC_ROUTE_KEY };
        },
      },
    });
    profile = {
      ...agent,
      modelRoute: {
        schemaVersion: 2,
        roles: {},
        subagentRoles: { researcher: { model: { provider: model.provider, id: model.id } } },
      },
    };
  }
  profile = await store.updateAgent(agent.id, {
    ...profile,
    enabledSubagents: ["researcher", "reviewer", "general", "coder"],
    subagentLimits: { maxConcurrent: 2, maxTotal: 4, maxTurns: options.maxTurns ?? 4, timeoutMs: options.timeoutMs ?? 5_000 },
    ...(options.runLimits ? { runLimits: { ...agent.runLimits!, ...options.runLimits } } : {}),
  });
  const run = await store.createRun({ threadId: thread.id, agentId: agent.id });
  const parent = new AbortController();
  const provider = new InProcessSubagentProvider({
    store,
    models: registry.models,
    modelRouter,
    defaultModel: model,
    profile,
    run,
    limits: { maxConcurrent: 2, maxTotal: 4, maxTurns: options.maxTurns ?? 4, timeoutMs: options.timeoutMs ?? 5_000 },
    parentSignal: parent.signal,
    concurrencyGate: new ToolConcurrencyGate({
      durable: { backend: store.toolConcurrencyLeaseBackend(), ownerId: "model_session_fixture" },
    }),
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    ...(options.createInheritedTools ? { createInheritedTools: options.createInheritedTools } : {}),
  });
  const request = (overrides: Partial<SubagentRequest> = {}): SubagentRequest => ({
    kind: "napier.subagent-request",
    schemaVersion: 1,
    threadId: thread.id,
    runId: run.id,
    role: "researcher",
    description: "Exercise the child model boundary",
    prompt: "Return the requested JSON result.",
    ...overrides,
  });
  return { store, source, thread, run, faux, registry, model, provider, parent, request, supervisor: new SubagentSupervisor(provider) };
}

export function awaitedEventBarrier(matches: (event: RunEvent) => boolean) {
  let markReached!: (event: RunEvent) => void;
  let releaseBarrier!: () => void;
  const reached = new Promise<RunEvent>((resolve) => { markReached = resolve; });
  const release = new Promise<void>((resolve) => { releaseBarrier = resolve; });
  let used = false;
  return {
    reached,
    release: releaseBarrier,
    onEvent: async (event: RunEvent): Promise<void> => {
      if (used || !matches(event)) return;
      used = true;
      markReached(event);
      await release;
    },
  };
}
