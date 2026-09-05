import {
  isToolProgressReceiptV1,
  isToolUiProjectionV2,
  type ToolUiProjectionV2,
} from "../src/tool-protocol.js";
import { describe, expect, it } from "vitest";

const HASH = "a".repeat(64);

describe("Tool Protocol durable projections", () => {
  it("validates the canonical current projection and caller expectations", () => {
    const projection = validProjection();

    expect(
      isToolUiProjectionV2(projection, {
        toolId: "novel.tool",
        status: "completed",
      }),
    ).toBe(true);
    expect(isToolUiProjectionV2(projection, { toolId: "another.tool" })).toBe(
      false,
    );
    expect(isToolProgressReceiptV1(projection.progress)).toBe(true);
  });

  it("fails closed for missing, injected, or malformed protocol metadata", () => {
    const projection = validProjection();
    const { failureDefinitionSha256: _missing, ...missing } = projection;

    expect(isToolUiProjectionV2(missing)).toBe(false);
    expect(isToolUiProjectionV2({ ...projection, privateUrl: "secret" })).toBe(
      false,
    );
    expect(
      isToolUiProjectionV2({
        ...projection,
        progress: { ...projection.progress, operation: "download" },
      }),
    ).toBe(false);
  });
});

function validProjection(): ToolUiProjectionV2 {
  return {
    kind: "napier.tool-ui-projection",
    schemaVersion: 2,
    toolId: "novel.tool",
    semanticVersion: "1.2.3-alpha.1",
    definitionSha256: HASH,
    failureDefinitionSha256: "b".repeat(64),
    implementationSha256: "c".repeat(64),
    status: "completed",
    sideEffect: "none",
    concurrency: "safe",
    progress: {
      kind: "napier.tool-progress-semantics",
      schemaVersion: 1,
      availability: "declared",
      coverage: "trusted_declared",
      operation: "observe",
      scope: "workspace",
      contribution: "supporting",
      modeId: "read",
      resourceKeySha256: "d".repeat(64),
      failureBindings: { target: "e".repeat(64) },
      stateSha256: "f".repeat(64),
    },
    compatibilityMode: "native",
  };
}
