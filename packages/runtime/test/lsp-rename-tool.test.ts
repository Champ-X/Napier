import { describe, expect, it } from "vitest";

import {
  assertLspRenameToolOutputBytes,
  lspRenameToolCallArgumentsLedgerProjection,
  MAX_LSP_RENAME_TOOL_OUTPUT_BYTES,
} from "../src/index.js";

describe("LSP rename Agent tool boundary", () => {
  it("fails closed when formatted live output exceeds its byte budget", () => {
    expect(() =>
      assertLspRenameToolOutputBytes(
        "x".repeat(MAX_LSP_RENAME_TOOL_OUTPUT_BYTES),
      ),
    ).not.toThrow();
    expect(() =>
      assertLspRenameToolOutputBytes(
        "x".repeat(MAX_LSP_RENAME_TOOL_OUTPUT_BYTES + 1),
      ),
    ).toThrow(`exceeds ${MAX_LSP_RENAME_TOOL_OUTPUT_BYTES}`);
  });

  it("projects source paths and proposed names as hashes only", () => {
    const path = "src/private-account-name.ts";
    const newName = "PRIVATE_RENAMED_ACCOUNT";
    const projection = lspRenameToolCallArgumentsLedgerProjection({
      path,
      line: 4,
      character: 7,
      newName,
    });
    const durable = JSON.stringify(projection);

    expect(projection).toEqual(
      expect.objectContaining({
        kind: "napier.redacted-tool-arguments",
        redacted: true,
        pathSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        newNameSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(durable).not.toContain(path);
    expect(durable).not.toContain(newName);
  });
});
