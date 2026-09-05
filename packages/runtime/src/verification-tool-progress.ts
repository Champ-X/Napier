import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "typebox";

import {
  defineToolProgress,
  progressSemantics,
  recordValue,
  resultDetails,
  stableFields,
} from "./tool-progress-semantics.js";
import type { VerificationDetails } from "./verification-types.js";

export function defineVerificationToolProgress<TParameters extends TSchema>(
  tool: AgentTool<TParameters, VerificationDetails>,
): AgentTool<TParameters, VerificationDetails> {
  return defineToolProgress(tool, {
    schemaVersion: 1,
    classificationVersion: "1.0.0",
    modes: [
      {
        modeId: "verify_workspace",
        operation: "verify",
        scope: "workspace",
        contribution: "verification",
      },
    ],
    resolve: (input) => ({
      semantics: progressSemantics("verify", "workspace", "verification"),
      resourceKey: {
        kind: "workspace-verification",
        request: recordValue(input),
      },
    }),
    state: (_input, result) => {
      const details = resultDetails(result);
      return details["status"] === "passed"
        ? stableFields(details, [
            "kind",
            "status",
            "scopeSha256",
            "workspaceSnapshotSha256",
            "verifierSha256",
            "toolchainSha256",
            "resultSha256",
          ])
        : undefined;
    },
  });
}
