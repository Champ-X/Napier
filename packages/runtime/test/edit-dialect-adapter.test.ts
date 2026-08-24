import { fauxProvider } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import {
  compileEditIntent,
  formatEditDialectGuidance,
} from "../src/edit-dialect-adapter.js";

const hash = "a".repeat(64);

describe("edit dialect adapter", () => {
  it("selects hashline for OpenAI and normalizes to apply_patch", () => {
    const plan = compileEditIntent({
      model: fauxProvider({ provider: "openai" }).getModel(),
      availableToolNames: ["apply_patch"],
      intent: {
        kind: "content", target: "src/app.ts", expectedSha256: hash,
        hashlineReplacements: [{ line: 2, anchorSha256: hash, newText: "next" }],
      },
    });

    expect(plan).toEqual(expect.objectContaining({
      kind: "napier.edit-dispatch-plan",
      dialect: "hashline",
      toolId: "apply_patch",
      input: expect.objectContaining({ operation: "hashline_replace" }),
      intentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
  });

  it("selects structured patch for non-OpenAI content edits", () => {
    const plan = compileEditIntent({
      model: fauxProvider({ provider: "generic" }).getModel(),
      availableToolNames: ["apply_patch"],
      intent: {
        kind: "content", target: "README.md", expectedSha256: hash,
        replacements: [{ oldText: "before", newText: "after" }],
      },
    });

    expect(plan.dialect).toBe("structured_patch");
    expect(plan.input).toEqual({
      operation: "replace", path: "README.md", expectedSha256: hash,
      edits: [{ oldText: "before", newText: "after" }],
    });
  });

  it("selects preview/apply for filesystem intents", () => {
    const model = fauxProvider({ provider: "generic" }).getModel();
    const availableToolNames = ["workspace_file_preview", "workspace_file_apply"];
    const plan = compileEditIntent({
      model, availableToolNames,
      intent: { kind: "filesystem", operation: "trash", path: "old.txt" },
    });

    expect(plan).toEqual(expect.objectContaining({
      dialect: "preview_apply",
      toolId: "workspace_file_preview",
      continuationToolId: "workspace_file_apply",
      input: { kind: "filesystem", action: "preview", operation: "trash", path: "old.txt" },
    }));
    expect(formatEditDialectGuidance({ model, availableToolNames })).toContain(
      "Filesystem mutation dialect: preview_apply",
    );
  });

  it("fails closed when the governed target tool is unavailable", () => {
    expect(() => compileEditIntent({
      model: fauxProvider({ provider: "generic" }).getModel(),
      availableToolNames: [],
      intent: {
        kind: "content", target: "a.ts", expectedSha256: hash,
        replacements: [{ oldText: "a", newText: "b" }],
      },
    })).toThrow("requires the governed apply_patch capability");
  });
});
