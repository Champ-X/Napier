import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { createLspProtocolPathBinding } from "../src/lsp-protocol-path-binding.js";

describe("LSP protocol path binding", () => {
  it("maps the Workspace target to a fixed provider root and back", () => {
    const binding = createLspProtocolPathBinding({
      workspaceRoot: "/host/workspace",
      target: "/host/workspace/packages/example.ts",
      protocolWorkspaceRoot: "/workspace",
    });

    expect(binding.workspaceRootUri).toBe("file:///workspace");
    expect(binding.targetUri).toBe("file:///workspace/packages/example.ts");
    expect(binding.toHostUri(binding.targetUri)).toBe(
      "file:///host/workspace/packages/example.ts",
    );
  });

  it("rejects protocol escapes, authorities, query data, and other schemes", () => {
    const binding = createLspProtocolPathBinding({
      workspaceRoot: "/host/workspace",
      target: "/host/workspace/example.ts",
      protocolWorkspaceRoot: "/workspace",
    });

    for (const uri of [
      "file:///outside/example.ts",
      "file://server/workspace/example.ts",
      "file:///workspace/example.ts?secret=value",
      "https://example.invalid/workspace/example.ts",
    ]) {
      expect(binding.toHostUri(uri)).toBeUndefined();
    }
  });

  it("preserves host URIs when no provider root is configured", () => {
    const target = "/host/workspace/example.ts";
    const binding = createLspProtocolPathBinding({
      workspaceRoot: "/host/workspace",
      target,
    });

    expect(binding.workspaceRootUri).toBe("file:///host/workspace");
    expect(binding.targetUri).toBe(pathToFileURL(target).href);
    expect(binding.toHostUri(binding.targetUri)).toBe(binding.targetUri);
  });

  it("rejects a provider root that does not match the OCI mount contract", () => {
    expect(() =>
      createLspProtocolPathBinding({
        workspaceRoot: "/host/workspace",
        target: "/host/workspace/example.ts",
        protocolWorkspaceRoot: "/other",
      }),
    ).toThrow("protocol workspace root is invalid");
  });
});
