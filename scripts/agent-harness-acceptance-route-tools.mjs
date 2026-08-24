import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { agentCapabilityPresetUpdate } from "@napier/contracts/agent-capabilities";
import { writeFile } from "node:fs/promises";

import { AgentRuntime } from "../packages/runtime/dist/agent-runtime.js";
import { ModelRouter } from "../packages/runtime/dist/model-route.js";
import { ModelRegistry } from "../packages/runtime/dist/models.js";
import {
  addLedgerRun,
  collectStream,
  createEvidenceStore,
  ledgerRun,
  readinessSandbox,
  reopenEvidenceStore,
  terminalStream,
  visibleFailureStream,
} from "./agent-harness-acceptance-evidence-support.mjs";

const ROUTE_EVENTS = new Set(["route_attempt_ended", "model.response"]);
const TOOL_EVENTS = new Set([
  "model.harness.resolved",
  "tool.started",
  "tool.completed",
]);

export async function collectRouteAndToolEvidence(root, ledgerRuns) {
  const route = await routeEvidence(root, ledgerRuns);
  const tools = await toolEvidence(root, ledgerRuns);
  return { ...route, ...tools };
}

async function routeEvidence(root, ledgerRuns) {
  let fixture = await createEvidenceStore(root, "route");
  const registry = new ModelRegistry();
  const runtime = new AgentRuntime(
    fixture.store,
    registry,
    undefined,
    readinessSandbox("agent-harness-route"),
  );
  const routeCases = [];
  const failureInputs = [
    ["rate_limited", "HTTP 429 too many requests"],
    ["provider_server", "HTTP 503 service unavailable"],
    ["network", "ECONNRESET network error"],
  ];
  for (let index = 0; index < 100; index += 1) {
    const [failureClass, diagnostic] =
      failureInputs[index % failureInputs.length];
    const primaryId = `route-primary-${String(index)}`;
    const fallbackId = `route-fallback-${String(index)}`;
    const primaryProvider = fauxProvider({
      provider: primaryId,
      models: [{ id: "model", reasoning: false }],
    });
    const fallbackProvider = fauxProvider({
      provider: fallbackId,
      models: [{ id: "model", reasoning: false }],
    });
    primaryProvider.setResponses([
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: diagnostic,
      }),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fallbackProvider.setResponses([fauxAssistantMessage("fallback succeeded")]);
    registry.registerProvider(primaryProvider.provider);
    registry.registerProvider(fallbackProvider.provider);
    const thread = await fixture.store.createThread({
      title: `Recoverable route ${String(index + 1)}`,
      agentId: fixture.store.listAgents()[0].id,
    });
    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Exercise a recoverable model route.",
      model: { provider: primaryId, id: "model" },
      modelRoute: {
        role: "reasoning",
        fallbackModels: [{ provider: fallbackId, id: "model" }],
      },
    });
    if (run.status !== "completed")
      throw new Error(`Route Run failed: ${run.id}`);
    routeCases.push({
      id: `route_recoverable_${String(index + 1)}`,
      failureClass,
      scenario: "recoverable",
      threadId: thread.id,
      runId: run.id,
    });
  }
  const barrierProvider = fauxProvider({
    provider: "acceptance-route-barrier",
    models: [
      { id: "primary", reasoning: false },
      { id: "fallback", reasoning: false },
    ],
  });
  registry.registerProvider(barrierProvider.provider);
  const primary = await registry.resolveConfigured({
    provider: "acceptance-route-barrier",
    id: "primary",
  });
  if (!primary)
    throw new Error("Acceptance route barrier model is unavailable");
  const visible = await createRouteRun(fixture.store, registry, primary, {
    title: "Visible output barrier",
    invoke: (model) => visibleFailureStream(model, "HTTP 429 rate limit"),
  });
  routeCases.push({
    id: "route_visible_output_barrier",
    failureClass: "rate_limited",
    scenario: "visible_output",
    threadId: visible.threadId,
    runId: visible.runId,
  });
  const unknown = await createRouteRun(fixture.store, registry, primary, {
    title: "Unknown side effect barrier",
    before: async (store, thread, run) => {
      await store.appendEvent({
        threadId: thread.id,
        runId: run.id,
        type: "tool.started",
        category: "tool",
        visibility: "user",
        payload: {
          callId: "call_pending",
          toolName: "apply_patch",
          effect: "write",
        },
      });
    },
    invoke: (model) =>
      terminalStream(model, "error", "ECONNRESET network error"),
  });
  routeCases.push({
    id: "route_unknown_side_effect_barrier",
    failureClass: "network",
    scenario: "unknown_side_effect",
    threadId: unknown.threadId,
    runId: unknown.runId,
  });
  fixture = await reopenEvidenceStore(fixture);
  try {
    return {
      routeCases: await Promise.all(
        routeCases.map(async ({ threadId, runId, ...item }) => ({
          ...item,
          runEvidenceSha256: addLedgerRun(
            ledgerRuns,
            await ledgerRun(fixture.store, threadId, runId, ROUTE_EVENTS),
          ),
        })),
      ),
    };
  } finally {
    await fixture.store.shutdown();
  }
}

async function createRouteRun(store, registry, primary, input) {
  const agent = store.listAgents()[0];
  const thread = await store.createThread({
    title: input.title,
    agentId: agent.id,
  });
  const run = await store.createRun({
    threadId: thread.id,
    agentId: agent.id,
    model: { provider: primary.provider, id: primary.id },
  });
  await input.before?.(store, thread, run);
  const session = await new ModelRouter(store, registry, () =>
    Date.UTC(2026, 7, 22),
  ).createSession({
    run,
    primary,
    request: {
      role: "reasoning",
      fallbackModels: [
        { provider: "acceptance-route-barrier", id: "fallback" },
      ],
    },
  });
  await collectStream(
    session.stream({
      signal: new AbortController().signal,
      invoke: async (model) => input.invoke(model),
    }),
  );
  await store.finishRun(run.id, "completed", { outcome: "completed" });
  return { threadId: thread.id, runId: run.id };
}

async function toolEvidence(root, ledgerRuns) {
  let fixture = await createEvidenceStore(root, "tools");
  await writeFile(
    `${fixture.workspaceRoot}/evidence.txt`,
    "TOOL_LOOP_EVIDENCE\n",
  );
  const agent = await fixture.store.updateAgent(
    fixture.store.listAgents()[0].id,
    {
      ...agentCapabilityPresetUpdate("safe_automation"),
      runLimits: {
        maxTurns: 128,
        maxTotalTokens: 1_000_000,
        maxCostUsd: 25,
        timeoutMs: 1_800_000,
      },
      toolLoopGuard: { enabled: true, threshold: 3, exemptTools: [] },
    },
  );
  const registry = new ModelRegistry();
  const runtime = new AgentRuntime(
    fixture.store,
    registry,
    undefined,
    readinessSandbox("agent-harness-tools"),
  );
  const capabilityRecords = [];
  for (let index = 0; index < 100; index += 1) {
    const provider = fauxProvider({ provider: `catalog-${String(index)}` });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("capability", { uri: "cap://tools/git_commit_apply" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Capability activated."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    registry.registerProvider(provider.provider);
    const thread = await fixture.store.createThread({
      title: `Capability ${String(index + 1)}`,
      agentId: agent.id,
    });
    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Discover the commit capability without invoking it.",
      model: { provider: provider.provider.id, id: "faux-1" },
    });
    if (run.status !== "completed")
      throw new Error(`Capability Run failed: ${run.id}`);
    capabilityRecords.push({
      id: `capability_${String(index + 1)}`,
      targetToolId: "git_commit_apply",
      threadId: thread.id,
      runId: run.id,
    });
  }
  const loopRecords = [];
  for (let index = 0; index < 30; index += 1) {
    loopRecords.push(
      await runLoopPair(fixture.store, runtime, registry, agent.id, index),
    );
  }
  fixture = await reopenEvidenceStore(fixture);
  try {
    const capabilityReachabilityCases = await Promise.all(
      capabilityRecords.map(async ({ threadId, runId, ...item }) => ({
        ...item,
        runEvidenceSha256: addLedgerRun(
          ledgerRuns,
          await ledgerRun(fixture.store, threadId, runId, TOOL_EVENTS),
        ),
      })),
    );
    const loopPairs = await Promise.all(
      loopRecords.map(async (item) => ({
        id: item.id,
        baselineRunEvidenceSha256: addLedgerRun(
          ledgerRuns,
          await ledgerRun(
            fixture.store,
            item.baseline.threadId,
            item.baseline.runId,
            TOOL_EVENTS,
          ),
        ),
        candidateRunEvidenceSha256: addLedgerRun(
          ledgerRuns,
          await ledgerRun(
            fixture.store,
            item.candidate.threadId,
            item.candidate.runId,
            TOOL_EVENTS,
          ),
        ),
      })),
    );
    return { capabilityReachabilityCases, loopPairs };
  } finally {
    await fixture.store.shutdown();
  }
}

async function runLoopPair(store, runtime, registry, agentId, index) {
  await store.updateAgent(agentId, {
    toolLoopGuard: { enabled: false, threshold: 3, exemptTools: [] },
  });
  const baseline = await runToolLoop(
    store,
    runtime,
    registry,
    agentId,
    `loop-baseline-${String(index)}`,
    5,
  );
  await store.updateAgent(agentId, {
    toolLoopGuard: { enabled: true, threshold: 3, exemptTools: [] },
  });
  const candidate = await runToolLoop(
    store,
    runtime,
    registry,
    agentId,
    `loop-candidate-${String(index)}`,
    5,
  );
  return { id: `loop_pair_${String(index + 1)}`, baseline, candidate };
}

async function runToolLoop(
  store,
  runtime,
  registry,
  agentId,
  providerId,
  calls,
) {
  const provider = fauxProvider({ provider: providerId });
  provider.setResponses([
    ...Array.from({ length: calls }, (_, index) =>
      fauxAssistantMessage(
        fauxToolCall(
          "read_file",
          { path: "evidence.txt" },
          {
            id: `read_${String(index)}`,
          },
        ),
        { stopReason: "toolUse" },
      ),
    ),
    fauxAssistantMessage("Loop complete."),
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  registry.registerProvider(provider.provider);
  const thread = await store.createThread({ title: providerId, agentId });
  const run = await runtime.runPrompt({
    threadId: thread.id,
    text: "Read the same evidence as requested.",
    model: { provider: provider.provider.id, id: "faux-1" },
  });
  if (run.status !== "completed") throw new Error(`Loop Run failed: ${run.id}`);
  return { threadId: thread.id, runId: run.id };
}
