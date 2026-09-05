import type { BeforeToolCallResult } from "@earendil-works/pi-agent-core";
import type { RunRecord } from "@napier/contracts";

import type { AgentToolResultLifecycle } from "./agent-tool-result-lifecycle.js";
import type { EventSink } from "./event-sink.js";
import type { RunBudgetTracker } from "./run-budget.js";
import {
  RunProgressTracker,
  type RunProgressStore,
} from "./run-progress-vector.js";
import type { ToolProtocolRegistry } from "./tool-protocol-registry.js";

export function createRunProgressTracker(
  host: { store: RunProgressStore },
  budget: RunBudgetTracker,
  run: Pick<RunRecord, "id" | "threadId" | "startedAt">,
  tools: Array<{ name: string }>,
  prompt: string,
  registry: ToolProtocolRegistry,
  onEvent?: EventSink,
): Promise<RunProgressTracker> {
  return RunProgressTracker.create(
    host.store,
    run,
    onEvent,
    { prompt, toolNames: tools.map((tool) => tool.name) },
    budget.limits,
    registry,
  );
}

export async function preflightProgressTool(
  tracker: RunProgressTracker,
  lifecycle: AgentToolResultLifecycle,
  toolCall: { id: string; name: string },
  args: unknown,
): Promise<BeforeToolCallResult | undefined> {
  return (
    (await tracker.preflightTool(toolCall.id, toolCall.name, args)) ??
    lifecycle.preflight(toolCall.id, toolCall.name, args)
  );
}
