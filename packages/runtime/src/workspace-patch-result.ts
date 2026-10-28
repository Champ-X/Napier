import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type {
  WorkspacePatchDiagnosticsDetails,
  WriteLinkedTestVerificationDetails,
} from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { WorkspacePatchResult } from "./workspace-patch-model.js";
import type {
  WorkspacePatchObservation,
  WorkspacePatchToolDetails,
} from "./workspace-patch-model.js";

export function formatWorkspacePatchResult(
  result: WorkspacePatchResult,
  observation?: WorkspacePatchObservation,
  recoveryCapsuleSha256?: string,
): AgentToolResult<WorkspacePatchToolDetails> {
  const details = workspacePatchToolDetails(
    result,
    observation?.details,
    observation?.tests,
    recoveryCapsuleSha256,
  );
  return {
    content: [
      {
        type: "text",
        text: [
          `${result.operation === "create" ? "Created" : "Updated"} ${result.path} atomically.`,
          `Before SHA-256: ${result.beforeSha256 ?? "absent"}`,
          `After SHA-256: ${result.afterSha256}`,
          `Bytes: ${result.beforeBytes} -> ${result.afterBytes}`,
          `Edits: ${result.editCount}`,
          ...(result.createdParentDirectoryCount !== undefined &&
          result.createdParentDirectorySetSha256
            ? [
                `Created parent directories: ${result.createdParentDirectoryCount}`,
                `Created parent directory set SHA-256: ${result.createdParentDirectorySetSha256}`,
              ]
            : []),
          ...(observation ? ["", observation.summary] : []),
        ].join("\n"),
      },
    ],
    details,
  };
}

function workspacePatchToolDetails(
  result: WorkspacePatchResult,
  diagnostics?: WorkspacePatchDiagnosticsDetails,
  tests?: WriteLinkedTestVerificationDetails,
  recoveryCapsuleSha256?: string,
): WorkspacePatchToolDetails {
  const base = {
    kind: "napier.workspace-patch" as const,
    schemaVersion: 1 as const,
    pathSha256: result.pathSha256,
    operation: result.operation,
    beforeSha256: result.beforeSha256,
    afterSha256: result.afterSha256,
    beforeBytes: result.beforeBytes,
    afterBytes: result.afterBytes,
    editCount: result.editCount,
    ...(result.createdParentDirectoryCount !== undefined
      ? {
          createdParentDirectoryCount: result.createdParentDirectoryCount,
        }
      : {}),
    ...(result.createdParentDirectorySetSha256
      ? {
          createdParentDirectorySetSha256:
            result.createdParentDirectorySetSha256,
        }
      : {}),
    ...(diagnostics ? { diagnostics } : {}),
    ...(tests ? { tests } : {}),
    ...(recoveryCapsuleSha256 ? { recoveryCapsuleSha256 } : {}),
  };
  return {
    ...base,
    resultSha256: sha256(canonicalJson(base)),
  };
}
