import type { LspRenameApplyDetails } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { builtInToolEffect } from "../src/agent-tool-effects.js";
import { sha256 } from "../src/ed25519.js";
import {
  createLspRenameApplyTool,
  lspRenameApplyToolCallArgumentsLedgerProjection,
  lspRenameApplyToolOutputLedgerProjection,
} from "../src/lsp-rename-apply-tool.js";
import type { LspRenameMutationManager } from "../src/lsp-rename-mutation-manager.js";

describe("LSP rename apply Agent tool", () => {
  it("accepts only a preview capability and redacts it from durable evidence", async () => {
    const previewId = "renamepreview_private1234";
    let observedPreviewId = "";
    const details = applyDetails();
    const manager = {
      async apply(candidate: string) {
        observedPreviewId = candidate;
        return {
          details,
          summary: "LSP rename apply: applied\nPostcondition: verified",
        };
      },
    } as LspRenameMutationManager;
    const tool = createLspRenameApplyTool(manager);

    const result = await tool.execute("rename-apply-call", { previewId });

    expect(observedPreviewId).toBe(previewId);
    expect(result.details).toEqual(details);
    expect(builtInToolEffect("lsp_rename_apply")).toBe("write");
    expect(
      lspRenameApplyToolCallArgumentsLedgerProjection({ previewId }),
    ).toEqual(
      expect.objectContaining({
        redacted: true,
        previewIdSha256: sha256(previewId),
      }),
    );
    const output =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    const durable = lspRenameApplyToolOutputLedgerProjection(output, result);
    expect(durable).toEqual(
      expect.objectContaining({
        outputRedacted: true,
        resultSha256: details.resultSha256,
      }),
    );
    expect(JSON.stringify(durable)).not.toContain(previewId);
  });
});

function applyDetails(): LspRenameApplyDetails {
  return {
    kind: "napier.lsp-rename-apply",
    schemaVersion: 1,
    status: "applied",
    postcondition: "verified",
    sourcePreviewResultSha256: "1".repeat(64),
    planSha256: "2".repeat(64),
    fileCount: 2,
    editCount: 4,
    committedFileCount: 2,
    restoredFileCount: 0,
    recoveryArtifactCount: 0,
    rollbackAttempted: false,
    rollbackVerified: false,
    durable: true,
    cancellationObserved: false,
    beforeFileSetSha256: "3".repeat(64),
    expectedFileSetSha256: "4".repeat(64),
    observedFileSetSha256: "4".repeat(64),
    resourceLimitsSha256: "5".repeat(64),
    resultSha256: "6".repeat(64),
  };
}
