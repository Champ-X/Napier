import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Type } from "typebox";
import { describe, expect, it } from "vitest";

import {
  bindBuiltInToolCompatibilityPolicy,
  builtInToolCompatibilityPolicy,
  builtInToolEffect,
  builtInToolHarnessAction,
} from "../src/agent-tool-effects.js";
import { createOwnedToolRecordV2 } from "../src/owned-tool-protocol.js";

describe("built-in Tool Protocol compatibility policy", () => {
  it("owns effect, reversibility, exclusivity, and harness semantics together", () => {
    expect(builtInToolCompatibilityPolicy("workspace_file_apply")).toEqual({
      sideEffect: "reversible",
      sideEffectMode: "static",
      retry: { strategy: "not_started", maxAttempts: 2 },
      concurrency: "exclusive",
    });
    expect(builtInToolEffect("workspace_file_apply")).toBe("write");
    expect(builtInToolHarnessAction("lsp_diagnostics")).toBe("verify");

    const definition = createOwnedToolRecordV2(
      bindBuiltInToolCompatibilityPolicy(tool("workspace_file_apply")),
    ).definition;
    expect(definition).toEqual(
      expect.objectContaining({
        sideEffect: "reversible",
        sideEffectMode: "static",
        concurrency: "exclusive",
      }),
    );
  });

  it("resolves input-dependent compatibility policy without ownership name checks", () => {
    expect(builtInToolCompatibilityPolicy("node_debugger")).toEqual({
      sideEffect: "unknown",
      sideEffectMode: "input_dependent",
      retry: { strategy: "not_started", maxAttempts: 2 },
    });
    const protocol = createOwnedToolRecordV2(
      bindBuiltInToolCompatibilityPolicy(tool("node_debugger")),
    );
    expect(protocol.invocation({ action: "stack_trace" }).sideEffect).toBe(
      "none",
    );
    expect(protocol.invocation({ action: "set_breakpoint" }).sideEffect).toBe(
      "unknown",
    );
  });

  it("keeps concrete legacy tool names out of the generic ownership boundary", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/owned-tool-protocol.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(
      /["'](?:apply_patch|workspace_file_apply|node_debugger|browser)["']/u,
    );
  });
});

function tool(name: string) {
  return {
    name,
    label: name,
    description: name,
    parameters: Type.Object({}),
    execute: async () => ({ content: [] }),
  };
}
