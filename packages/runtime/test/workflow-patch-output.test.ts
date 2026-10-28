import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { workflowToolOutputValue } from "../src/workflow-tool-execution-evidence.js";

describe("Workflow patch output compatibility", () => {
  const content = {
    kind: "napier.workspace-patch",
    schemaVersion: 1,
    recoveryCapsuleSha256: "a".repeat(64),
    pathSha256: "b".repeat(64),
    afterSha256: "c".repeat(64),
    diagnostics: { retained: true },
  };
  const result = { ...content, resultSha256: sha256(canonicalJson(content)) };
  it("retains a verifiable public receipt while keeping the full recovery result intact", () => {
    const { recoveryCapsuleSha256: _private, ...publicContent } = content;
    expect(workflowToolOutputValue("apply_patch", result)).toEqual({
      ...publicContent,
      resultSha256: sha256(canonicalJson(publicContent)),
    });
    expect(result.recoveryCapsuleSha256).toBe(content.recoveryCapsuleSha256);
    expect(workflowToolOutputValue("other_tool", result)).toEqual(result);
    const legacy = {
      ...publicContent,
      resultSha256: sha256(canonicalJson(publicContent)),
    };
    expect(workflowToolOutputValue("apply_patch", legacy)).toEqual(legacy);
  });
  it("does not launder a tampered recovery result into a valid output", () => {
    expect(() =>
      workflowToolOutputValue("apply_patch", {
        ...result,
        afterSha256: "d".repeat(64),
      }),
    ).toThrow("digest is invalid");
  });
});
