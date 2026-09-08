import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  defineToolProgress,
  progressSemantics,
  recordValue,
} from "./tool-progress-semantics.js";

/** Control actions cannot be starved by the opaque-tool acquisition lease.
 * Plan/artifact ledger transitions supply their own progress and acceptance;
 * tool success alone must not award either.
 */
export function definePlanToolProgress(tool: AgentTool): AgentTool {
  return defineToolProgress(tool, {
    schemaVersion: 1,
    classificationVersion: "1.0.0",
    modes: [
      {
        modeId: "coordinate_plan",
        operation: "coordinate",
        scope: "control",
        contribution: "control",
      },
    ],
    resolve: (input) => ({
      semantics: progressSemantics("coordinate", "control", "control"),
      resourceKey: {
        kind: "plan",
        planId: recordValue(input)["planId"] ?? null,
      },
    }),
  });
}
