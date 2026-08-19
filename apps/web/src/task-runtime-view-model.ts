import type { RunEvent } from "@napier/contracts";

import { browserLiveViewExpected } from "./browser-live-view-state";

export interface TaskRuntimeAvailability {
  browser: boolean;
  process: boolean;
  sandbox: boolean;
}

export function taskRuntimeAvailability(
  events: readonly RunEvent[],
  activeRunId: string | undefined,
): TaskRuntimeAvailability {
  const activeProcesses = new Set<string>();
  for (const event of events) {
    if (!event.type.startsWith("workspace.process.")) continue;
    const processId = eventProcessId(event);
    if (!processId) continue;
    if (event.type === "workspace.process.started") {
      activeProcesses.add(processId);
      continue;
    }
    if (
      event.type === "workspace.process.settled" ||
      event.type === "workspace.process.interrupted"
    ) {
      activeProcesses.delete(processId);
    }
  }
  return {
    browser: Boolean(
      activeRunId && browserLiveViewExpected(events, activeRunId),
    ),
    process: activeProcesses.size > 0,
    sandbox: Boolean(
      activeRunId &&
        events.some(
          (event) =>
            event.runId === activeRunId && event.type.startsWith("sandbox."),
        ),
    ),
  };
}

export function hasTaskRuntime(
  availability: TaskRuntimeAvailability,
): boolean {
  return availability.browser || availability.process || availability.sandbox;
}

function eventProcessId(event: RunEvent): string | undefined {
  if (!record(event.payload)) return undefined;
  const value = event.payload["id"] ?? event.payload["processId"];
  return typeof value === "string" ? value : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
