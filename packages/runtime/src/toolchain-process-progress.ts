import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  defineToolProgress,
  progressSemantics,
  recordValue,
  resultDetails,
} from "./tool-progress-semantics.js";

/** Only fresh observed output contributes supporting evidence. The existing
 * activity lease bounds it; it never counts as product/acceptance progress.
 * This declaration belongs to the opt-in provider, not the default tool. */
export function withToolchainProcessProgress(tool: AgentTool): AgentTool {
  return defineToolProgress(tool, {
    schemaVersion: 1,
    classificationVersion: "2.0.0",
    modes: [
      {
        modeId: "observe_process",
        operation: "observe",
        scope: "session",
        contribution: "neutral",
      },
      {
        modeId: "observe_process_output",
        operation: "observe",
        scope: "session",
        contribution: "supporting",
      },
      {
        modeId: "start_workspace_write",
        operation: "mutate",
        scope: "workspace",
        contribution: "neutral",
      },
    ],
    resolve: (input, result) => {
      const args = recordValue(input);
      const details = result ? resultDetails(result) : {};
      return {
        semantics:
          args["action"] === "start_write"
            ? progressSemantics("mutate", "workspace", "neutral")
            : progressSemantics(
                "observe",
                "session",
                observedOutput(args, details) ? "supporting" : "neutral",
              ),
        resourceKey: {
          kind: "workspace-process-observation",
          processId: details["processId"] ?? args["processId"],
        },
      };
    },
    state: (input, result) => {
      const details = resultDetails(result);
      return observedOutput(recordValue(input), details)
        ? { outputContentSha256: details["outputContentSha256"] }
        : undefined;
    },
  });
}

function observedOutput(
  args: Record<string, unknown>,
  details: Record<string, unknown>,
): boolean {
  return (
    args["action"] === "poll" &&
    details["action"] === "poll" &&
    typeof args["processId"] === "string" &&
    args["processId"] === details["processId"] &&
    Number.isSafeInteger(details["chunkCount"]) &&
    Number(details["chunkCount"]) > 0 &&
    typeof details["outputContentSha256"] === "string" &&
    /^[a-f0-9]{64}$/u.test(details["outputContentSha256"])
  );
}
