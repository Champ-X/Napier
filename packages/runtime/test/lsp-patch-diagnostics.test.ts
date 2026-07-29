import type { LspDiagnosticsDetails } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  createLspPatchObservation,
  type LspDiagnostic,
  type LspDiagnosticsResult,
} from "../src/index.js";

describe("write-linked LSP diagnostic delta", () => {
  it("classifies clean, introduced, improved, regressed, and truncated results", () => {
    const clean = result("a".repeat(64), []);
    const error = diagnostic(1, "2322", "Type mismatch");
    const warning = diagnostic(2, "6133", "Unused value");
    const oneError = result("b".repeat(64), [error]);
    const oneWarning = result("c".repeat(64), [warning]);

    expect(
      createLspPatchObservation(clean.details.fileSha256, undefined, clean)
        .details.status,
    ).toBe("clean");
    expect(
      createLspPatchObservation(
        oneError.details.fileSha256,
        undefined,
        oneError,
      ).details,
    ).toEqual(
      expect.objectContaining({
        status: "introduced",
        introducedCount: 1,
        resolvedCount: 0,
      }),
    );
    expect(
      createLspPatchObservation(
        oneWarning.details.fileSha256,
        oneError,
        oneWarning,
      ).details,
    ).toEqual(
      expect.objectContaining({
        status: "improved",
        introducedCount: 1,
        resolvedCount: 1,
      }),
    );
    const replacementError = result("e".repeat(64), [
      diagnostic(1, "9999", "Different error"),
    ]);
    expect(
      createLspPatchObservation(
        replacementError.details.fileSha256,
        oneError,
        replacementError,
      ).details,
    ).toEqual(
      expect.objectContaining({
        status: "regressed",
        introducedCount: 1,
        resolvedCount: 1,
      }),
    );
    expect(
      createLspPatchObservation(clean.details.fileSha256, oneError, clean)
        .details,
    ).toEqual(
      expect.objectContaining({
        status: "improved",
        introducedCount: 0,
        resolvedCount: 1,
      }),
    );
    expect(
      createLspPatchObservation(oneError.details.fileSha256, clean, oneError)
        .details,
    ).toEqual(
      expect.objectContaining({
        status: "regressed",
        introducedCount: 1,
        resolvedCount: 0,
      }),
    );
    const truncated = result("d".repeat(64), [warning], true);
    expect(
      createLspPatchObservation(
        truncated.details.fileSha256,
        oneWarning,
        truncated,
      ).details.status,
    ).toBe("truncated");
  });

  it("ignores source movement when matching diagnostic identities", () => {
    const before = result("a".repeat(64), [
      diagnostic(1, "2322", "Type mismatch", 1),
    ]);
    const after = result("b".repeat(64), [
      diagnostic(1, "2322", "Type mismatch", 40),
    ]);

    expect(
      createLspPatchObservation(after.details.fileSha256, before, after)
        .details,
    ).toEqual(
      expect.objectContaining({
        status: "unchanged",
        introducedCount: 0,
        resolvedCount: 0,
        unchangedCount: 1,
      }),
    );
  });

  it("marks post-write byte drift without accepting a diagnostic delta", () => {
    const before = result("a".repeat(64), []);
    const after = result("b".repeat(64), []);
    const observation = createLspPatchObservation(
      "c".repeat(64),
      before,
      after,
    );

    expect(observation.details).toEqual(
      expect.objectContaining({
        status: "drifted",
        expectedFileSha256: "c".repeat(64),
        observedFileSha256: "b".repeat(64),
      }),
    );
    expect(observation.details).not.toHaveProperty("deltaSetSha256");
  });
});

function result(
  fileSha256: string,
  diagnostics: LspDiagnostic[],
  truncated = false,
): LspDiagnosticsResult {
  const errorCount = diagnostics.filter((item) => item.severity === 1).length;
  const warningCount = diagnostics.filter((item) => item.severity === 2).length;
  const informationCount = diagnostics.filter(
    (item) => item.severity === 3,
  ).length;
  const hintCount = diagnostics.filter((item) => item.severity === 4).length;
  const details: LspDiagnosticsDetails = {
    kind: "napier.lsp-diagnostics",
    schemaVersion: 1,
    status: diagnostics.length === 0 ? "clean" : "diagnostics",
    language: "typescript",
    sandbox: "test",
    workspaceAccess: "read_only",
    networkAccess: "denied",
    workspaceRootSha256: "1".repeat(64),
    pathSha256: "2".repeat(64),
    fileSha256,
    fileBytes: 10,
    diagnosticCount: diagnostics.length,
    errorCount,
    warningCount,
    informationCount,
    hintCount,
    truncated,
    diagnosticSetSha256: "3".repeat(64),
    codeSetSha256: "4".repeat(64),
    nodeExecutableSha256: "5".repeat(64),
    languageServerVersion: "5.3.0",
    languageServerSha256: "6".repeat(64),
    typescriptVersion: "5.9.3",
    typescriptServerSha256: "7".repeat(64),
    environmentSha256: "8".repeat(64),
    resourceLimitsSha256: "9".repeat(64),
    timeoutMs: 10_000,
    durationMs: 5,
    protocolBytes: 100,
    stderrChars: 0,
    stderrSha256: "0".repeat(64),
    stderrTruncated: false,
    resultSha256: fileSha256,
  };
  return { details, diagnostics, relativePath: "target.ts" };
}

function diagnostic(
  severity: LspDiagnostic["severity"],
  code: string,
  message: string,
  startLine = 1,
): LspDiagnostic {
  return {
    startLine,
    startCharacter: 1,
    endLine: startLine,
    endCharacter: 2,
    severity,
    code,
    source: "typescript",
    message,
  };
}
