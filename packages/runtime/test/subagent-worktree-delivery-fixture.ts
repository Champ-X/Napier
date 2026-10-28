import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LspRenameApplyDiagnosticsDetails } from "@napier/contracts";
import {
  SubagentWorktreeMutationManager,
  type SubagentWorktreeMutationManagerOptions,
} from "../src/subagent-worktree-mutation.js";

export function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function deliveryManager(
  harness: { workspaceRoot: string; dataRoot: string },
  overrides: Partial<SubagentWorktreeMutationManagerOptions> = {},
) {
  return new SubagentWorktreeMutationManager({
    ...harness,
    ownerId: `worker_delivery_${process.pid}`,
    lifecycleDiagnostics: {
      async observeBefore(changes) {
        for (const change of changes) {
          if (
            change.beforeSha256 !== null &&
            digest(
              await readFile(
                path.join(harness.workspaceRoot, change.path),
                "utf8",
              ),
            ) !== change.beforeSha256
          )
            throw new Error("diagnostic before binding changed");
        }
        return {
          entries: changes.map((change) => ({ change })),
          omittedFileCount: 0,
        };
      },
      async observeAfter(state) {
        for (const { change } of state.entries) {
          if (
            change.afterSha256 !== null &&
            digest(
              await readFile(
                path.join(harness.workspaceRoot, change.path),
                "utf8",
              ),
            ) !== change.afterSha256
          )
            throw new Error("diagnostic after binding changed");
        }
        return {
          details: diagnosticDetails(state.entries.length),
          summary:
            "Fixture diagnostics: file hashes checked; no language server",
        };
      },
      unavailable() {
        return {
          details: { ...diagnosticDetails(0), status: "unavailable" as const },
          summary: "Fixture diagnostics unavailable",
        };
      },
    },
    ...overrides,
  });
}

function diagnosticDetails(
  fileCount: number,
): LspRenameApplyDiagnosticsDetails {
  return {
    kind: "napier.lsp-rename-apply-diagnostics",
    schemaVersion: 1,
    status: "clean",
    fileCount,
    omittedFileCount: 0,
    beforeDiagnosticCount: 0,
    afterDiagnosticCount: 0,
    beforeErrorCount: 0,
    afterErrorCount: 0,
    beforeWarningCount: 0,
    afterWarningCount: 0,
    introducedCount: 0,
    resolvedCount: 0,
    unchangedCount: 0,
    truncated: false,
    beforeResultSetSha256: digest("before"),
    afterResultSetSha256: digest("after"),
    deltaSetSha256: digest("delta"),
    durationMs: 0,
    resultSha256: digest("fixture"),
  };
}

export async function patchCandidate(
  manager: SubagentWorktreeMutationManager,
  session: Awaited<
    ReturnType<SubagentWorktreeMutationManager["createWorktree"]>
  >,
  file: string,
  before: string,
  after: string,
) {
  const tool = manager
    .createCoderTools(session)
    .find((entry) => entry.name === "apply_patch")!;
  await tool.execute("patch-delivery", {
    operation: "replace",
    path: file,
    expectedSha256: digest(before),
    edits: [{ oldText: before, newText: after }],
  });
}
