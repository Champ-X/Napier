import type { LspCodeActionApplyDetails } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { builtInToolEffect } from "../src/agent-tool-effects.js";
import { sha256 } from "../src/ed25519.js";
import {
  createLspCodeActionApplyTool,
  lspCodeActionApplyToolCallArgumentsLedgerProjection,
  lspCodeActionApplyToolOutputLedgerProjection,
} from "../src/lsp-code-action-apply-tool.js";
import type { LspCodeActionMutationManager } from "../src/lsp-code-action-mutation-manager.js";

describe("LSP Code Action apply Agent tool", () => {
  it("accepts only a preview capability and redacts it from durable evidence", async () => {
    const previewId = "actionpreview_private1234";
    let observedPreviewId = "";
    const details = applyDetails();
    const manager = {
      async apply(candidate: string) {
        observedPreviewId = candidate;
        return {
          details,
          summary: "LSP Code Action apply: applied\nPostcondition: verified",
        };
      },
    } as LspCodeActionMutationManager;
    const tool = createLspCodeActionApplyTool(manager);

    const result = await tool.execute("code-action-apply-call", { previewId });

    expect(observedPreviewId).toBe(previewId);
    expect(result.details).toEqual(details);
    expect(builtInToolEffect("lsp_code_action_apply")).toBe("write");
    expect(
      lspCodeActionApplyToolCallArgumentsLedgerProjection({ previewId }),
    ).toEqual(
      expect.objectContaining({
        redacted: true,
        previewIdSha256: sha256(previewId),
      }),
    );
    const output =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    const durable = lspCodeActionApplyToolOutputLedgerProjection(
      output,
      result,
    );
    expect(durable).toEqual(
      expect.objectContaining({
        outputRedacted: true,
        resultSha256: details.resultSha256,
      }),
    );
    expect(JSON.stringify(durable)).not.toContain(previewId);
  });
});

function applyDetails(): LspCodeActionApplyDetails {
  return {
    kind: "napier.lsp-code-action-apply",
    schemaVersion: 1,
    status: "applied",
    postcondition: "verified",
    sourcePreviewResultSha256: "1".repeat(64),
    sourceActionSha256: "2".repeat(64),
    sourceResolved: true,
    sourceCommandIgnored: true,
    commandPolicy: "deny_all",
    planSha256: "3".repeat(64),
    fileCount: 2,
    editCount: 4,
    committedFileCount: 2,
    restoredFileCount: 0,
    recoveryArtifactCount: 0,
    rollbackAttempted: false,
    rollbackVerified: false,
    durable: true,
    cancellationObserved: false,
    beforeFileSetSha256: "4".repeat(64),
    expectedFileSetSha256: "5".repeat(64),
    observedFileSetSha256: "5".repeat(64),
    resourceLimitsSha256: "6".repeat(64),
    resultSha256: "7".repeat(64),
  };
}
