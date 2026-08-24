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
          id: "apply_patch",
          sideEffect: "reversible",
          concurrency: "serialized",
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
      expect.objectContaining({ sideEffect: "none", concurrency: "safe" }),
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
      expect.objectContaining({ text: expect.stringContaining("cap://tools/apply_patch") }),
    );
  });

  it("rejects ambiguous duplicate tool identities", () => {
    expect(() => createCapabilityDescriptors([readTool, readTool])).toThrow(
      "Capability Catalog tool name is duplicated: read_file",
    );
  });
});
