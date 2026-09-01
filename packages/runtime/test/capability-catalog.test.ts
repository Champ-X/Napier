import { Type } from "typebox";
import { describe, expect, it } from "vitest";

import {
  createCapabilityCatalogTool,
  createCapabilityDescriptors,
} from "../src/capability-catalog.js";

const readTool = {
  name: "read_file",
  label: "Read file",
  description: "Read a workspace file.",
  parameters: Type.Object({ path: Type.String() }),
  execute: async () => ({ content: [], details: {} }),
};
const writeTool = {
  name: "apply_patch",
  label: "Apply patch",
  description: "Apply a workspace patch.",
  parameters: Type.Object({ patch: Type.String() }),
  execute: async () => ({ content: [], details: {} }),
};
const processTool = {
  name: "workspace_process",
  label: "Workspace process",
  description: "Start and control a workspace process.",
  parameters: Type.Object({ action: Type.String() }),
  execute: async () => ({ content: [], details: {} }),
};

describe("Capability Catalog", () => {
  it("projects deterministic ToolDefinitionV2 descriptors", () => {
    const descriptors = createCapabilityDescriptors([writeTool, readTool]);

    expect(descriptors.map(({ toolId }) => toolId)).toEqual([
      "apply_patch",
      "read_file",
    ]);
    expect(descriptors[0]).toEqual(
      expect.objectContaining({
        uri: "cap://tools/apply_patch",
        definitionSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        definition: expect.objectContaining({
          schemaVersion: 2,
          id: "apply_patch",
          version: "1.0.0-compat.1",
          sideEffect: "reversible",
          sideEffectMode: "static",
          concurrency: "serialized",
          retry: { strategy: "not_started", maxAttempts: 2 },
          idempotency: { key: "none", resultReplay: "never" },
          approval: { mode: "policy", codeBridge: "allowed" },
          uiProjectionSchema: expect.objectContaining({
            type: "object",
          }),
          compatibility: expect.objectContaining({
            mode: "compatibility",
            runtime: "pi-agent-tool/v1",
            legacyDefinitionSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          }),
          canonicalOutputSchema: expect.objectContaining({
            "x-napier-surface": "canonical",
          }),
          modelVisibleOutputSchema: expect.objectContaining({
            "x-napier-surface": "model_visible",
          }),
        }),
      }),
    );
    expect(descriptors[1]?.definition).toEqual(
      expect.objectContaining({
        version: "2.0.0",
        sideEffect: "none",
        concurrency: "safe",
        idempotency: {
          key: "arguments",
          resultReplay: "exact_result_only",
        },
        compatibility: expect.objectContaining({ mode: "native" }),
      }),
    );
  });

  it("discovers an omitted first-party tool for activation on the next step", async () => {
    const catalog = createCapabilityCatalogTool([readTool, writeTool]);
    const result = await catalog.execute(
      "call_catalog",
      { uri: "cap://tools/apply_patch" },
      undefined,
    );

    expect(result.addedToolNames).toEqual(["apply_patch"]);
    expect(result.details).toEqual(
      expect.objectContaining({
        kind: "napier.capability-catalog-result",
        matchedCount: 1,
        catalogSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(result.content[0]).toEqual(
      expect.objectContaining({
        text: expect.stringContaining("cap://tools/apply_patch"),
      }),
    );
  });

  it("lists the catalog root without activating every returned tool", async () => {
    const catalog = createCapabilityCatalogTool([readTool, writeTool]);
    const result = await catalog.execute(
      "call_catalog",
      { uri: "cap://tools" },
      undefined,
    );

    expect(result.details).toEqual(
      expect.objectContaining({ matchedCount: 2 }),
    );
    expect(result.addedToolNames).toBeUndefined();
  });

  it("discovers the POSIX command surface from Bash and CLI vocabulary", async () => {
    const catalog = createCapabilityCatalogTool([
      readTool,
      writeTool,
      processTool,
    ]);

    for (const query of ["bash", "shell", "terminal", "command line"]) {
      const result = await catalog.execute(
        `call_catalog_${query.replaceAll(" ", "_")}`,
        { query },
        undefined,
      );
      expect(result.addedToolNames).toBeUndefined();
      expect(result.content[0]).toEqual(
        expect.objectContaining({
          text: expect.stringContaining("cap://tools/workspace_process"),
        }),
      );
    }
  });

  it("rejects ambiguous duplicate tool identities", () => {
    expect(() => createCapabilityDescriptors([readTool, readTool])).toThrow(
      "Capability Catalog tool name is duplicated: read_file",
    );
  });
});
