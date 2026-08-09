import { describe, expect, it } from "vitest";

import { createLspDefinitionTool } from "../src/lsp-definition-tool.js";
import { createLspDiagnosticsTool } from "../src/lsp-diagnostics-tool.js";
import { createLspReferencesTool } from "../src/lsp-references-tool.js";
import { createLspSymbolsTool } from "../src/lsp-symbols-tool.js";

const MAX_LSP_NAVIGATION_TOOL_DEFINITION_BYTES = 2.5 * 1024;

describe("Provider LSP navigation tool definition budget", () => {
  it("keeps diagnostics, symbols, definition, and references within two and a half KiB", () => {
    const options = {
      workspaceRoot: "/workspace",
      sandbox: undefined as never,
    };
    const tools = [
      createLspDiagnosticsTool(options),
      createLspSymbolsTool(options),
      createLspDefinitionTool(options),
      createLspReferencesTool(options),
    ];
    const bytes = tools.reduce(
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

    expect(bytes).toBeLessThanOrEqual(MAX_LSP_NAVIGATION_TOOL_DEFINITION_BYTES);
  });

  it("keeps path, position, timeout, semantic, completeness, and trust guidance", () => {
    const options = {
      workspaceRoot: "/workspace",
      sandbox: undefined as never,
    };
    const descriptions = [
      createLspDiagnosticsTool(options),
      createLspSymbolsTool(options),
      createLspDefinitionTool(options),
      createLspReferencesTool(options),
    ].map((tool) => tool.description);

    for (const description of descriptions) {
      expect(description).toContain("workspace-relative");
      expect(description).toContain("TypeScript/JavaScript");
      expect(description).toContain("read-only offline OS sandbox");
      expect(description).toContain("timeoutMs");
      expect(description).toContain("untrusted");
    }
    expect(descriptions[1]).toContain("semantic");
    expect(descriptions[2]).toContain("1-based UTF-16");
    expect(descriptions[3]).toContain("1-based UTF-16");
    expect(descriptions[3]).toContain("incomplete");
  });
});
