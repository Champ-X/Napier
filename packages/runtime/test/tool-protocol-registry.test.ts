import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";

import {
  createOwnedToolRecordV2,
  ToolProtocolRegistry,
} from "../src/tool-protocol-registry.js";

describe("Tool Protocol v2 registry", () => {
  it("owns native read, preview/apply, and input-dependent definitions", () => {
    const registry = new ToolProtocolRegistry([
      tool("read_file"),
      tool("workspace_file_preview"),
      tool("workspace_file_apply"),
      tool("browser", "sequential"),
    ]);

    expect(registry.require("read_file").definition).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        version: "2.0.0",
        sideEffect: "none",
        sideEffectMode: "static",
        retry: { strategy: "not_started", maxAttempts: 2 },
        idempotency: {
          key: "arguments",
          resultReplay: "exact_result_only",
        },
        compatibility: expect.objectContaining({ mode: "native" }),
      }),
    );
    expect(registry.require("workspace_file_preview").definition).toEqual(
      expect.objectContaining({
        sideEffect: "none",
        concurrency: "safe",
      }),
    );
    expect(registry.require("workspace_file_apply").definition).toEqual(
      expect.objectContaining({
        sideEffect: "reversible",
        concurrency: "exclusive",
        idempotency: { key: "preview_token", resultReplay: "never" },
      }),
    );
    const browser = registry.require("browser");
    expect(browser.invocation({ action: "snapshot" })).toEqual(
      expect.objectContaining({
        sideEffect: "none",
        approval: { mode: "policy", codeBridge: "allowed" },
      }),
    );
    expect(browser.invocation({ action: "click" })).toEqual(
      expect.objectContaining({
        sideEffect: "unknown",
        approval: { mode: "explicit", codeBridge: "external_checkpoint" },
      }),
    );
  });

  it("keeps protocol identity stable while implementation identity changes", () => {
    const before = createOwnedToolRecordV2({
      ...tool("read_file"),
      execute: async () => ({ content: [], details: { revision: 1 } }),
    });
    const after = createOwnedToolRecordV2({
      ...tool("read_file"),
      execute: async function changedImplementation() {
        return { content: [], details: { revision: 2 } };
      },
    });

    expect(before.definitionSha256).toBe(after.definitionSha256);
    expect(before.implementationSha256).not.toBe(after.implementationSha256);
    expect(before.definition.compatibility.legacyDefinitionSha256).toBe(
      before.implementationSha256,
    );
  });

  it("validates native canonical results and emits the UI projection", () => {
    const record = createOwnedToolRecordV2(tool("read_file"));
    const result = {
      content: [{ type: "text" as const, text: "fixture" }],
      details: {
        startLine: 1,
        endLine: 1,
        totalLines: 1,
        pathSha256: "1".repeat(64),
        sha256: "2".repeat(64),
        sizeBytes: 7,
        truncated: false,
      },
    };

    expect(() => record.validateCanonicalResult(result)).not.toThrow();
    expect(() =>
      record.validateCanonicalResult({
        ...result,
        details: { ...result.details, sizeBytes: -1 },
      }),
    ).toThrow("does not match Tool Protocol v2");
    expect(record.uiProjection("completed", { path: "fixture" })).toEqual(
      expect.objectContaining({
        kind: "napier.tool-ui-projection",
        schemaVersion: 2,
        toolId: "read_file",
        semanticVersion: "2.0.0",
        definitionSha256: record.definitionSha256,
        implementationSha256: record.implementationSha256,
        sideEffect: "none",
        concurrency: "safe",
        compatibilityMode: "native",
      }),
    );
  });

  it("accepts Browser v2 receipts while enforcing v3 diagnosis evidence", () => {
    const browser = createOwnedToolRecordV2(tool("browser", "sequential"));
    const result = {
      content: [],
      details: browserDetails(2),
    };

    expect(() => browser.validateCanonicalResult(result)).not.toThrow();
    expect(() =>
      browser.validateCanonicalResult({
        ...result,
        details: { ...result.details, schemaVersion: 3 },
      }),
    ).toThrow("does not match Tool Protocol v2");
    expect(() =>
      browser.validateCanonicalResult({
        ...result,
        details: {
          ...result.details,
          schemaVersion: 3,
          pageDiagnosis: {
            status: "none",
            signalCount: 0,
            signalsSha256: "f".repeat(64),
            takeoverRecommended: false,
          },
        },
      }),
    ).not.toThrow();
  });

  it("makes compatibility adaptation explicit for unmigrated tools", () => {
    const record = createOwnedToolRecordV2(tool("extension_tool"));
    expect(record.definition).toEqual(
      expect.objectContaining({
        version: "1.0.0-compat.1",
        compatibility: expect.objectContaining({ mode: "compatibility" }),
        policyTags: expect.arrayContaining(["compatibility:pi-agent-tool-v1"]),
      }),
    );
  });
});

function tool(name: string, executionMode?: "sequential", output = "fixture") {
  return {
    name,
    label: name,
    description: `${name} fixture`,
    parameters: Type.Object({}, { additionalProperties: true }),
    ...(executionMode ? { executionMode } : {}),
    execute: vi.fn(async () => ({
      content: [{ type: "text" as const, text: output }],
      details: {},
    })),
  };
}

function browserDetails(schemaVersion: 2 | 3) {
  return {
    kind: "napier.browser-session-operation",
    schemaVersion,
    action: "snapshot",
    sessionMode: "run_persistent",
    sessionReused: false,
    sessionOperation: 1,
    sessionIdSha256: "1".repeat(64),
    activeTabId: "tab_1",
    tabCount: 1,
    tabSetSha256: "2".repeat(64),
    browserExecutableSha256: "3".repeat(64),
    browserVersionSha256: "4".repeat(64),
    limitsSha256: "5".repeat(64),
    currentUrlSha256: "6".repeat(64),
    currentOriginSha256: "7".repeat(64),
    titleSha256: "8".repeat(64),
    blockedRequestCount: 0,
    network: {
      requestCount: 1,
      connectCount: 0,
      rejectedCount: 0,
      transferredBytes: 0,
      destinationCount: 1,
      destinationsSha256: "9".repeat(64),
    },
    crossOriginAuthorized: false,
  };
}
