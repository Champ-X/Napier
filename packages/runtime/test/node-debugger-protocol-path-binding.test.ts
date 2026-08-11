import { describe, expect, it } from "vitest";

import { createNodeDebuggerProtocolSourceBinding } from "../src/node-debugger-protocol-path-binding.js";
import type { NodeDebuggerSourceBinding } from "../src/node-debugger-source-binding.js";

describe("Node debugger protocol path binding", () => {
  it("maps source, program, and source-map targets under the fixed root", () => {
    const binding = createNodeDebuggerProtocolSourceBinding(
      sourceBinding(),
      "/workspace",
    );

    expect(binding).toEqual({
      workspaceRoot: "/workspace",
      sourceTarget: "/workspace/src/source.ts",
      programTarget: "/workspace/dist/program.js",
      sourceMapTarget: "/workspace/dist/program.js.map",
    });
  });

  it("preserves host targets without a portable protocol root", () => {
    expect(createNodeDebuggerProtocolSourceBinding(sourceBinding())).toEqual({
      workspaceRoot: "/host/workspace",
      sourceTarget: "/host/workspace/src/source.ts",
      programTarget: "/host/workspace/dist/program.js",
      sourceMapTarget: "/host/workspace/dist/program.js.map",
    });
  });

  it("rejects an unsupported protocol root", () => {
    expect(() =>
      createNodeDebuggerProtocolSourceBinding(sourceBinding(), "/other"),
    ).toThrow("protocol workspace root is invalid");
  });

  it("rejects a protocol target outside its bound workspace", () => {
    const binding = sourceBinding();
    binding.source.target = "/host/outside/source.ts";

    expect(() =>
      createNodeDebuggerProtocolSourceBinding(binding, "/workspace"),
    ).toThrow("protocol source escapes the workspace");
  });
});

function sourceBinding(): NodeDebuggerSourceBinding {
  return {
    source: source("src/source.ts"),
    program: source("dist/program.js"),
    sourceMap: source("dist/program.js.map"),
  };
}

function source(relative: string) {
  return {
    workspaceRoot: "/host/workspace",
    target: `/host/workspace/${relative}`,
    path: relative,
    pathSha256: "a".repeat(64),
    source: "",
    fileSha256: "b".repeat(64),
    fileBytes: 0,
  };
}
