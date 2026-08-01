import type {
  ExecutionPlan,
  ExecutionPlanWorkflowExperimentMode,
  ExecutionPlanWorkflowExperimentResultFrame,
  ExecutionPlanWorkflowManifest,
  JsonValue,
} from "@napier/contracts";

import type { WorkflowExperimentWebRequest } from "./workflow-experiment-api";
import {
  parseWorkflowManifestText,
  parseWorkflowModelKey,
} from "./workflow-experiment-view-model";
import { workflowExperimentResultFilename } from "./workflow-experiment-view-model";

const MAX_MANIFEST_BYTES = 1024 * 1024;

export function defaultWorkflowExperimentSourcePlanId(
  plans: ExecutionPlan[],
): string {
  return (
    plans.findLast((plan) => plan.status === "completed")?.id ??
    plans.findLast((plan) => plan.status === "blocked")?.id ??
    plans.at(-1)?.id ??
    ""
  );
}

export function shortWorkflowExperimentId(value: string): string {
  return value.length > 18
    ? `${value.slice(0, 10)}...${value.slice(-6)}`
    : value;
}

export function downloadWorkflowExperimentResult(
  result: ExecutionPlanWorkflowExperimentResultFrame,
): void {
  const blob = new Blob([JSON.stringify(result, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = workflowExperimentResultFilename(result);
  anchor.click();
  URL.revokeObjectURL(url);
}

export function parseWorkflowSimulatedOutput(value: string): JsonValue {
  if (new TextEncoder().encode(value).length > 32 * 1024) {
    throw new Error("Workflow simulated output exceeds 32 KiB");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Workflow simulated output must be valid JSON");
  }
  if (parsed === undefined) {
    throw new Error("Workflow simulated output is invalid");
  }
  return parsed as JsonValue;
}

export async function loadWorkflowExperimentManifest(
  file: File,
): Promise<ExecutionPlanWorkflowManifest> {
  if (file.size > MAX_MANIFEST_BYTES) {
    throw new Error("Workflow manifest exceeds the 1 MiB limit.");
  }
  return parseWorkflowManifestText(await file.text());
}

export function buildWorkflowExperimentRequest(input: {
  manifest: ExecutionPlanWorkflowManifest;
  fromNodeId: string;
  mode: ExecutionPlanWorkflowExperimentMode;
  simulatedOutput: string;
  replaceModel: boolean;
  canReplaceModel: boolean;
  selectedModelKey: string;
}): WorkflowExperimentWebRequest {
  return {
    manifest: input.manifest,
    fromNodeId: input.fromNodeId,
    ...(input.mode !== "subgraph" ? { mode: input.mode } : {}),
    ...(input.mode === "simulate_node"
      ? {
          simulatedOutput: parseWorkflowSimulatedOutput(input.simulatedOutput),
        }
      : {}),
    ...(input.replaceModel && input.canReplaceModel
      ? {
          modelOverrides: {
            [input.fromNodeId]: parseWorkflowModelKey(input.selectedModelKey),
          },
        }
      : {}),
  };
}
