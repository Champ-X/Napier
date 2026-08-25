import { validateCreateExecutionPlanWorkflowExperimentRequest } from "@napier/runtime/workflow";

import type { CliWorkflowOptions } from "./cli-options.js";

export function createCliWorkflowExperimentRequest(
  manifest: unknown,
  options: CliWorkflowOptions,
) {
  return validateCreateExecutionPlanWorkflowExperimentRequest({
    manifest,
    planId: options.planId,
    ...(options.fromNodeId ? { fromNodeId: options.fromNodeId } : {}),
    ...(options.replaceWorkflowInputJson !== undefined
      ? {
          mode: "replace_workflow_input" as const,
          replacementWorkflowInput: parseJson(
            options.replaceWorkflowInputJson,
            "Workflow replacement Workflow input",
          ),
        }
      : options.singleNode
        ? { mode: "single_node" as const }
        : options.stepNodes
          ? { mode: "step_nodes" as const }
          : options.simulateOutputJson !== undefined
            ? {
                mode: "simulate_node" as const,
                simulatedOutput: parseJson(
                  options.simulateOutputJson,
                  "Workflow simulated output",
                ),
              }
            : options.replaceInputJson !== undefined
              ? {
                  mode: "replace_input" as const,
                  replacementInput: parseJson(
                    options.replaceInputJson,
                    "Workflow replacement input",
                  ),
                }
              : {}),
    ...(options.title ? { title: options.title } : {}),
    ...(options.modelOverridesJson
      ? {
          modelOverrides: parseJson(
            options.modelOverridesJson,
            "Workflow model overrides",
          ),
        }
      : {}),
    ...(options.confirmSideEffects ? { confirmSideEffects: true } : {}),
    ...(options.expectedPreviewSha256
      ? { expectedPreviewSha256: options.expectedPreviewSha256 }
      : {}),
  });
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}
