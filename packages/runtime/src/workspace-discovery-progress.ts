import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "typebox";
import {
  defineToolProgress,
  progressSemantics,
  recordValue,
  resultDetails,
  stableFields,
} from "./tool-progress-semantics.js";

/** Directory and search observations remain available during convergence. */
export function defineWorkspaceDiscoveryProgress<T extends TSchema, D>(
  tool: AgentTool<T, D>,
  kind: "directory" | "search",
): AgentTool<T, D> {
  return defineToolProgress(tool, {
    schemaVersion: 1,
    classificationVersion: "1.0.0",
    modes: [
      {
        modeId: "observe_workspace_index",
        operation: "observe",
        scope: "workspace",
        contribution: "supporting",
      },
    ],
    resolve: (input) => ({
      semantics: progressSemantics("observe", "workspace", "supporting"),
      resourceKey: {
        kind,
        path: recordValue(input)["path"] ?? ".",
      },
    }),
    state: (_input, result) =>
      stableFields(resultDetails(result), [
        "entrySetSha256",
        "matchSetSha256",
        "truncated",
      ]),
  });
}
