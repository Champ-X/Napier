import { describe, expect, it } from "vitest";

import {
  MAX_LSP_CODE_ACTION_DIAGNOSTICS,
  parseCodeActionDiagnostics,
} from "../src/lsp-code-action-diagnostics.js";
import { diagnostic } from "./lsp-code-actions-test-fixture.js";

describe("LSP Code Action diagnostic boundary", () => {
  it("retains protocol diagnostics while projecting hash-only receipts", () => {
    const message = "PRIVATE_DIAGNOSTIC_MESSAGE";
    const parsed = parseCodeActionDiagnostics([
      {
        ...diagnostic(message, 1, 2, 1, 8),
        source: "PRIVATE_SOURCE",
        code: "PRIVATE_CODE",
      },
    ]);

    expect(parsed[0]?.raw["message"]).toBe(message);
    expect(parsed[0]?.receipt).toEqual({
      rangeSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      severity: 1,
      codeSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      messageSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(JSON.stringify(parsed[0]?.receipt)).not.toContain("PRIVATE_");
  });

  it("rejects malformed or excessive diagnostics", () => {
    expect(() =>
      parseCodeActionDiagnostics([{ message: "missing range" }]),
    ).toThrow("diagnostic 1 is malformed");
    expect(() =>
      parseCodeActionDiagnostics(
        Array.from(
          { length: MAX_LSP_CODE_ACTION_DIAGNOSTICS + 1 },
          (_, index) => diagnostic(String(index), 0, 0, 0, 1),
        ),
      ),
    ).toThrow(`more than ${MAX_LSP_CODE_ACTION_DIAGNOSTICS} diagnostics`);
  });
});
