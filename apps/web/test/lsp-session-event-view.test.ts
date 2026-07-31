import { describe, expect, it } from "vitest";

import {
  lspSessionEventEvidence,
  lspSessionSummaryParts,
} from "../src/lsp-session-event-view";

describe("LSP Session event projection", () => {
  it("keeps legacy one-shot evidence compatible", () => {
    expect(lspSessionEventEvidence({ kind: "legacy" })).toEqual({});
    expect(lspSessionSummaryParts({})).toEqual([]);
  });

  it("projects bounded hash-only persistent Session evidence", () => {
    const view = lspSessionEventEvidence({
      sessionMode: "run_persistent",
      sessionReused: true,
      sessionOperation: 7,
      sessionIdSha256: "1".repeat(64),
      sessionWorkspaceSha256: "2".repeat(64),
      sessionLimitsSha256: "3".repeat(64),
      path: "PRIVATE_SESSION_PATH",
    });
    expect(view).toEqual({
      lspSessionMode: "run_persistent",
      lspSessionReused: true,
      lspSessionOperation: 7,
      lspSessionIdSha256: "1".repeat(64),
      lspSessionWorkspaceSha256: "2".repeat(64),
      lspSessionLimitsSha256: "3".repeat(64),
    });
    expect(lspSessionSummaryParts(view!)).toEqual([
      "lsp-session run_persistent",
      "lsp-session-reused",
      "lsp-session-operation 7",
      `lsp-session-id ${"1".repeat(12)}`,
      `lsp-session-workspace ${"2".repeat(12)}`,
      `lsp-session-limits ${"3".repeat(12)}`,
    ]);
    expect(JSON.stringify(view)).not.toContain("PRIVATE_SESSION_PATH");
  });

  it("rejects partial or out-of-range Session evidence", () => {
    expect(
      lspSessionEventEvidence({
        sessionMode: "run_persistent",
        sessionReused: false,
        sessionOperation: 33,
        sessionIdSha256: "1".repeat(64),
        sessionWorkspaceSha256: "2".repeat(64),
        sessionLimitsSha256: "3".repeat(64),
      }),
    ).toBeUndefined();
    expect(
      lspSessionEventEvidence({
        sessionMode: "run_persistent",
        sessionReused: false,
        sessionOperation: 1,
      }),
    ).toBeUndefined();
    expect(
      lspSessionEventEvidence({
        sessionMode: "run_persistent",
        sessionReused: true,
        sessionOperation: 1,
        sessionIdSha256: "1".repeat(64),
        sessionWorkspaceSha256: "2".repeat(64),
        sessionLimitsSha256: "3".repeat(64),
      }),
    ).toBeUndefined();
  });
});
