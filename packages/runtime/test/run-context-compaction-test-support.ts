import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Context,
  type Message,
} from "@earendil-works/pi-ai";
import { compileAuxiliaryPrompt } from "../src/agent-prompt-layers.js";
import { modelAdapterReceipt } from "../src/model-adapters.js";
import { ModelInvocationCapsuleStore } from "../src/model-invocation-capsule-store.js";
import { ModelRegistry } from "../src/models.js";
import { RunBudgetTracker } from "../src/run-budget.js";
import { RunContextCompactor } from "../src/run-context-compaction.js";
import { TokenMeterRegistry } from "../src/token-meter-provider.js";
import {
  createFixture,
  createRun,
} from "./run-progress-vector-test-support.js";

export const summary = {
  summary:
    "Inspected the existing artifact; implementation and verification remain unfinished.",
  decisions: ["Keep the user's constraints."],
  openLoops: ["Finish editing and verify outputs/article.html."],
  artifacts: ["outputs/article.html"],
};

export async function compactionFixture(window = 16_000) {
  const fixture = await createFixture("run-compaction");
  const run = await createRun(fixture);
  const provider = fauxProvider({
    provider: "run-compactor-test",
    tokenSize: { min: 10_000, max: 10_000 },
    models: [
      {
        id: "bounded",
        contextWindow: window,
        maxTokens: 1_200,
        reasoning: false,
      },
    ],
  });
  provider.setResponses(
    Array.from({ length: 20 }, () =>
      fauxAssistantMessage(JSON.stringify(summary)),
    ),
  );
  const modelRegistry = new ModelRegistry();
  modelRegistry.registerProvider(provider.provider);
  const model = provider.getModel();
  const host = {
    store: fixture.store,
    modelRegistry,
    modelInvocationCapsules: new ModelInvocationCapsuleStore(
      fixture.store.dataRoot,
    ),
  };
  const budget = new RunBudgetTracker({
    maxTurns: 64,
    maxTotalTokens: 1_000_000,
    maxCostUsd: 100,
    timeoutMs: 60_000,
  });
  const tokenMeters = new TokenMeterRegistry();
  let turn = 0;
  const nextTurn = () => turn++;
  const createCompactor = () =>
    new RunContextCompactor(host, run, budget, nextTurn);
  const compactor = createCompactor();
  const compiledPrompt = compileAuxiliaryPrompt({
    purpose: "context_compaction",
    sourceId: "task.fixture",
    systemPrompt: "Pinned runtime instructions",
    adapter: modelAdapterReceipt(model, { maxTokens: 1_200 }),
  });
  function input(
    context: Context,
    recoveryAttempt: 0 | 1 = 0,
    signal?: AbortSignal,
  ) {
    return {
      sourceContext: context,
      prunedContext: context,
      context,
      model,
      options: { maxTokens: 1_200, ...(signal ? { signal } : {}) },
      compiledPrompt,
      tokenMeters,
      modelAttempt: 1,
      recoveryAttempt,
    };
  }
  return {
    ...fixture,
    run,
    provider,
    model,
    host,
    budget,
    compactor,
    createCompactor,
    input,
  };
}

export function exchange(index: number, size = 4_000): Message[] {
  const id = `call-${index}`;
  return [
    fauxAssistantMessage(
      fauxToolCall("read_file", { path: `section-${index}.txt` }, { id }),
      { stopReason: "toolUse", timestamp: index },
    ),
    {
      role: "toolResult",
      toolCallId: id,
      toolName: "read_file",
      content: [
        {
          type: "text",
          text: `Section ${index}: ${"evidence ".repeat(Math.ceil(size / 9))}`,
        },
      ],
      isError: false,
      timestamp: index,
    },
  ];
}

export function transcript(count = 12, size = 4_000): Context {
  return {
    messages: [
      {
        role: "user",
        content:
          "Keep all filenames unchanged. 输出必须为中文，所有修改都需要验证。",
        timestamp: 0,
      },
      ...Array.from({ length: count }, (_, index) =>
        exchange(index, size),
      ).flat(),
    ],
  };
}
