import { describe, expect, it } from "vitest";

import { parseCliArgs } from "../src/cli-options.js";

describe("Napier RPC CLI options", () => {
  it("parses the dedicated long-lived RPC command", () => {
    expect(
      parseCliArgs(["rpc", "--workspace", ".", "--data-root", ".napier-rpc"]),
    ).toEqual({
      kind: "rpc",
      options: {
        workspace: ".",
        dataRoot: ".napier-rpc",
      },
    });
    expect(() => parseCliArgs(["rpc", "--workspace", ".", "--jsonl"])).toThrow(
      "--jsonl cannot",
    );
    expect(() => parseCliArgs(["rpc"])).toThrow("--workspace is required");
  });
});
