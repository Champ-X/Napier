import { describe, expect, it } from "vitest";

import { createTypescriptAstTools } from "../src/typescript-ast-tool.js";

const MAX_AST_TOOL_DEFINITION_BYTES = 3 * 1024;

describe("Provider AST tool definition budget", () => {
  it("keeps the AST query and edit definitions within three KiB", () => {
    const bytes = createTypescriptAstTools("/workspace").reduce(
      (total, tool) =>
        total +
        Buffer.byteLength(
          JSON.stringify({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            constrainedSampling: tool.constrainedSampling ?? null,
          }),
          "utf8",
        ),
      0,
    );

    expect(bytes).toBeLessThanOrEqual(MAX_AST_TOOL_DEFINITION_BYTES);
  });

  it("keeps CAS, unique target, trivia, reparse, and apply guidance", () => {
    const tools = Object.fromEntries(
      createTypescriptAstTools("/workspace").map((tool) => [
        tool.name,
        tool.description,
      ]),
    );

    expect(tools["ast_query"]).toContain("kind/name/ancestor");
    expect(tools["ast_query"]).toContain("live-only");
    expect(tools["ast_edit_preview"]).toContain("file SHA-256");
    expect(tools["ast_edit_preview"]).toContain("node SHA-256");
    expect(tools["ast_edit_preview"]).toContain("Reparses");
    expect(tools["ast_edit_preview"]).toContain("comment-trivia");
    expect(tools["ast_edit_preview"]).toContain("apply_patch");
  });
});
