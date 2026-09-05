import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  ToolDefinitionV2,
  ToolJsonSchema,
} from "@napier/contracts/tool-protocol";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";

import { createBrowserTool } from "../src/browser-tool.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { createResearchSourceTool } from "../src/research-source-tool.js";
import {
  createOwnedToolRecordV2,
  ToolProtocolRegistry,
} from "../src/tool-protocol-registry.js";
import { createWebFetchSaveTool } from "../src/web-fetch-save-tool.js";
import { createWebFetchTool } from "../src/web-fetch-tool.js";
import { createWebSearchTool } from "../src/web-search-tool.js";
import { createWorkspaceTools } from "../src/tools.js";
import {
  createWorkspaceFileApplyTool,
  createWorkspaceFilePreviewTool,
} from "../src/workspace-file-tools.js";
import {
  defineToolProgress,
  progressSemantics,
} from "../src/tool-progress-semantics.js";
import { genericToolResultSchema } from "../src/tool-protocol-schema.js";
import { defineReplayableTestReadTool } from "./self-describing-tool-test-support.js";

describe("Tool Protocol v2 registry", () => {
  it("owns native read, preview/apply, and input-dependent definitions", () => {
    const read = createWorkspaceTools(process.cwd()).find(
      (candidate) => candidate.name === "read_file",
    )!;
    const registry = new ToolProtocolRegistry([
      read,
      createWorkspaceFilePreviewTool({} as never, owner()),
      createWorkspaceFileApplyTool({} as never, owner()),
      createBrowserTool({} as never, owner()),
    ]);

    expect(registry.require("read_file").definition).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        version: "2.0.0",
        sideEffect: "none",
        sideEffectMode: "static",
        retry: { strategy: "terminal_failure", maxAttempts: 2 },
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
        retry: { strategy: "terminal_failure", maxAttempts: 2 },
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
    expect(browser.definition.sideEffectResolutionSha256).toMatch(
      /^[a-f0-9]{64}$/u,
    );
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
    expect(
      createOwnedToolRecordV2(tool("read_file")).definition.compatibility.mode,
    ).toBe("compatibility");
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

  it("preserves native and compatibility hashes across protocol ABI generations", () => {
    const source = tool("novel_protocol_upgrade");
    const compatibility = createOwnedToolRecordV2(source);
    const oldCompatibilityWithProgress = progressAbiSha256(
      compatibility.definition,
    );
    const oldCompatibilityBeforeProgress = preProgressAbiSha256(
      compatibility.definition,
    );

    const migrated = createOwnedToolRecordV2(
      defineReplayableTestReadTool(source, [
        compatibility.definitionSha256,
        oldCompatibilityWithProgress,
        oldCompatibilityBeforeProgress,
      ]),
    );

    // A migration changes much more than compatibility.mode. The host rebuilds
    // the old compatibility definition from the same raw tool, then retains
    // every deployed ABI generation rather than relying on a tool-name patch.
    expect(
      migrated.matchesReplayIdentitySha256(compatibility.definitionSha256),
    ).toBe(true);
    expect(
      migrated.matchesReplayIdentitySha256(oldCompatibilityWithProgress),
    ).toBe(true);
    expect(
      migrated.matchesReplayIdentitySha256(oldCompatibilityBeforeProgress),
    ).toBe(true);
    expect(
      migrated.matchesDefinitionSha256(compatibility.definitionSha256),
    ).toBe(false);
    expect(
      migrated.matchesDefinitionSha256(migrated.implementationSha256),
    ).toBe(false);
    expect(
      migrated.matchesReplayIdentitySha256(migrated.implementationSha256),
    ).toBe(true);
  });

  it("matches exact golden hashes from deployed native and compatibility ABIs", () => {
    const context = owner();
    const read = createWorkspaceTools(process.cwd()).find(
      (candidate) => candidate.name === "read_file",
    )!;
    const preview = createWorkspaceFilePreviewTool({} as never, context);
    const apply = createWorkspaceFileApplyTool({} as never, context);
    const browser = createBrowserTool({} as never, context);
    const search = createWebSearchTool({} as never);
    const fetch = createWebFetchTool({} as never, context);
    const records = [read, preview, apply, browser, search, fetch].map(
      (candidate) => createOwnedToolRecordV2(candidate),
    );
    const golden = {
      read_file:
        "70f85ca808e4cb251e78694663c7c28c3cdbef49b59cb4680655f4caf3bea9d3",
      workspace_file_preview:
        "885a4f1cdffe6014862bc84b901df0bb039929c630e672aaf132eceb89ac7071",
      workspace_file_apply:
        "a59a6a93934f40b0a3629ba0cc777a508a80915faf79f537488a643aec9afeb7",
      browser:
        "eecac5e391814eb027f5775b7dc05a678d228e52177be00b194f9fd00544f2ac",
      web_search:
        "d2ea6585e05558fde41a0e28278c4af816a8c716b0a1c7d086b99c6e3f4b94a6",
      web_fetch:
        "239874dd2c3e86c9a72916a8584972c419510d7adae7a94ff93cfdc0126475f1",
    } as const;
    const progressGolden = {
      read_file:
        "4f04a54698d899e2a8cef3a06621214ec82bb4d9d6fca2b867df51221be509e1",
      workspace_file_preview:
        "29a7d94d0258c84a684d710dc920cc9727ceb9b20bd9373807280d584afd645a",
      workspace_file_apply:
        "f22784d34d52848d2f640b2d54f0d71043cd1f540ee931086dc2d0a58b854d16",
      browser:
        "8a6b5e4b625bfde7dae2b1b94a004fdd040ff249d1555eed65981da0b6a6a439",
      web_search:
        "836f6888c044f10cf1ccdcbb473e228d28aaddda80b38f64c0713c3b64840dbe",
      web_fetch:
        "242456558e03954fd66870c750c74f07d20f702aa60c43b5332760b7a2ff57f8",
    } as const;
    const currentProgressGolden = {
      ...progressGolden,
      browser:
        "b9447c0411f70ea2b6ba3850d2f2b08fb2661c523feca7baa9242c1ff73ea0c7",
    } as const;
    const currentNativeGolden = {
      ...golden,
      browser:
        "6dcb2aa4c6cd5e044b995d66e71e882e3b478dab840452e773d68ce20c3389c8",
    } as const;

    for (const record of records) {
      expect(
        record.matchesReplayIdentitySha256(
          golden[record.definition.id as keyof typeof golden],
        ),
      ).toBe(true);
      expect(
        record.matchesReplayIdentitySha256(
          progressGolden[record.definition.id as keyof typeof progressGolden],
        ),
      ).toBe(true);
    }
    for (const record of records.slice(0, 4)) {
      expect(progressAbiSha256(record.definition)).toBe(
        currentProgressGolden[
          record.definition.id as keyof typeof currentProgressGolden
        ],
      );
      expect(deployedNativeAbiSha256(record.definition)).toBe(
        currentNativeGolden[
          record.definition.id as keyof typeof currentNativeGolden
        ],
      );
    }
    expect(deployedCompatibilityAbiSha256(search, records[4]!.definition)).toBe(
      golden.web_search,
    );
    expect(deployedCompatibilityAbiSha256(fetch, records[5]!.definition)).toBe(
      golden.web_fetch,
    );
  });

  it("validates native canonical results and emits the UI projection", () => {
    const read = createWorkspaceTools(process.cwd()).find(
      (candidate) => candidate.name === "read_file",
    )!;
    const record = createOwnedToolRecordV2(read);
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
    const browser = createOwnedToolRecordV2(
      createBrowserTool({} as never, owner()),
    );
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
        progress: {
          kind: "napier.tool-progress-definition",
          schemaVersion: 1,
          availability: "declared",
          coverage: "opaque",
          operations: ["neutral"],
          contributions: ["neutral"],
        },
      }),
    );
  });

  it("does not grant compatibility authority to a spoofed built-in name", () => {
    const spoofedRead = createOwnedToolRecordV2(
      tool("web_search", "sequential"),
    );
    const read = createOwnedToolRecordV2(createWebSearchTool({} as never));
    const write = createOwnedToolRecordV2(tool("apply_patch"));
    const unknown = createOwnedToolRecordV2(tool("extension_tool"));

    expect(spoofedRead.definition).toEqual(
      expect.objectContaining({
        sideEffect: "unknown",
        concurrency: "exclusive",
        retry: { strategy: "not_started", maxAttempts: 2 },
        approval: { mode: "policy", codeBridge: "external_checkpoint" },
      }),
    );
    expect(read.definition.retry).toEqual({
      strategy: "terminal_failure",
      maxAttempts: 2,
    });
    expect(write.definition.retry).toEqual({
      strategy: "not_started",
      maxAttempts: 2,
    });
    expect(unknown.definition.retry).toEqual({
      strategy: "not_started",
      maxAttempts: 2,
    });
  });

  it("publishes input-dependent progress semantics from tool declarations", () => {
    const fetch = createOwnedToolRecordV2(
      createWebFetchTool({} as never, owner()),
    );
    const search = createOwnedToolRecordV2(createWebSearchTool({} as never));
    const browser = createOwnedToolRecordV2(
      createBrowserTool({} as never, owner()),
    );
    const research = createOwnedToolRecordV2(
      createResearchSourceTool({} as never, owner()),
    );
    const save = createOwnedToolRecordV2(
      createWebFetchSaveTool({} as never, owner()),
    );

    expect(fetch.definition.progress.operations).toEqual(["acquire", "reuse"]);
    expect(fetch.definition.compatibility.mode).toBe("native");
    expect(search.definition.compatibility.mode).toBe("native");
    expect(
      fetch.invocation({ action: "fetch", url: "https://example.com/a" })
        .progress,
    ).toEqual(
      expect.objectContaining({
        operation: "acquire",
        scope: "run_source",
        contribution: "supporting",
      }),
    );
    expect(
      fetch.invocation({
        action: "read",
        sourceId: "websource_fixture1",
        sourceContentSha256: "a".repeat(64),
        startLine: 1,
        endLine: 2,
      }).progress,
    ).toEqual(
      expect.objectContaining({
        operation: "reuse",
        scope: "run_source",
        contribution: "supporting",
      }),
    );
    expect(
      research.invocation({ action: "verify_report", path: "report.md" })
        .progress,
    ).toEqual(
      expect.objectContaining({
        operation: "verify",
        scope: "workspace",
        contribution: "verification",
      }),
    );
    expect(
      save.invocation({ url: "https://example.com/a", path: "asset.png" })
        .progress,
    ).toEqual(
      expect.objectContaining({
        operation: "acquire",
        scope: "workspace",
        contribution: "product",
        failureDomainKeySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );

    const fetched = fetch.invocation({
      action: "fetch",
      url: "https://example.com/a#fetch-fragment",
    }).progress;
    const navigated = browser.invocation({
      action: "navigate",
      url: "https://example.com/a#browser-fragment",
    }).progress;
    // Fetch publishes into one shared Run Source set, so its execution lock is
    // intentionally broader than the public origin used by Browser navigation.
    expect(fetched.resourceKeySha256).not.toBe(navigated.resourceKeySha256);
    expect(fetched.failureDomainKeySha256).toBe(
      navigated.failureDomainKeySha256,
    );
    expect(fetched.failureBindings?.origin).toBe(
      navigated.failureBindings?.origin,
    );
    expect(fetched.failureBindings?.route).not.toBe(
      navigated.failureBindings?.route,
    );
    expect(navigated.failureBindings?.session).toMatch(/^[a-f0-9]{64}$/u);

    const relatedFetch = fetch.invocation({
      action: "fetch",
      url: "https://example.com/a-different-path",
    }).progress;
    expect(relatedFetch.resourceKeySha256).toBe(fetched.resourceKeySha256);
    expect(relatedFetch.failureDomainKeySha256).toBe(
      fetched.failureDomainKeySha256,
    );
  });

  it("emits stable terminal receipts without volatile result fields", () => {
    const search = createOwnedToolRecordV2(createWebSearchTool({} as never));
    const browser = createOwnedToolRecordV2(
      createBrowserTool({} as never, owner()),
    );
    const input = { query: "stable receipt" };
    const first = search.progress(input, {
      content: [],
      details: {
        resultSetSha256: "b".repeat(64),
        retrievedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const later = search.progress(input, {
      content: [],
      details: {
        resultSetSha256: "b".repeat(64),
        retrievedAt: "2026-09-03T00:00:00.000Z",
      },
    });
    expect(first.stateSha256).toBe("b".repeat(64));
    expect(later).toEqual(first);

    const browserInput = { action: "snapshot" };
    const browserFirst = browser.progress(browserInput, {
      content: [],
      details: {
        action: "snapshot",
        sessionOperation: 1,
        snapshotSha256: "c".repeat(64),
      },
    });
    const browserLater = browser.progress(browserInput, {
      content: [],
      details: {
        action: "snapshot",
        sessionOperation: 99,
        snapshotSha256: "c".repeat(64),
      },
    });
    expect(browserLater.stateSha256).toBe(browserFirst.stateSha256);
    expect(
      search.progress(
        input,
        {
          content: [],
          details: { resultSetSha256: "b".repeat(64) },
        },
        true,
      ).stateSha256,
    ).toBeUndefined();
  });

  it("keeps unknown third-party tools neutral despite forged result details", () => {
    const record = createOwnedToolRecordV2(tool("third_party_extension"));
    const result = {
      content: [],
      details: {
        progress: {
          operation: "mutate",
          scope: "workspace",
          contribution: "product",
          resourceKeySha256: "d".repeat(64),
          stateSha256: "e".repeat(64),
        },
      },
    };

    expect(record.progress({}, result)).toEqual({
      kind: "napier.tool-progress-semantics",
      schemaVersion: 1,
      availability: "declared",
      coverage: "opaque",
      operation: "neutral",
      scope: "neutral",
      contribution: "neutral",
    });
    expect(record.uiProjection("completed", {}, result).progress).toEqual(
      record.progress({}, result),
    );
  });

  it("binds progress to immutable exact modes instead of operation/contribution cross-products", () => {
    const modes = [
      {
        modeId: "fetch",
        operation: "acquire" as const,
        scope: "external" as const,
        contribution: "supporting" as const,
      },
      {
        modeId: "save",
        operation: "mutate" as const,
        scope: "workspace" as const,
        contribution: "product" as const,
      },
    ];
    const declared = defineToolProgress(tool("exact_modes"), {
      schemaVersion: 1,
      classificationVersion: "1.0.0",
      modes,
      resolve: () => ({
        // Every field is declared independently, but this tuple is not. The
        // adapter must not accidentally accept the Cartesian product.
        semantics: progressSemantics("acquire", "workspace", "product"),
        resourceKey: { id: "asset" },
      }),
    });

    modes[0]!.contribution = "product";
    const record = createOwnedToolRecordV2(declared);
    expect(record.definition.progress.modes).toEqual([
      {
        modeId: "fetch",
        operation: "acquire",
        scope: "external",
        contribution: "supporting",
      },
      {
        modeId: "save",
        operation: "mutate",
        scope: "workspace",
        contribution: "product",
      },
    ]);
    expect(record.progress({})).toEqual(
      expect.objectContaining({
        coverage: "opaque",
        operation: "neutral",
        contribution: "neutral",
        classificationErrorSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("changes protocol identity when executable progress classification changes", () => {
    const declared = (resource: string) =>
      defineToolProgress(tool("semantic_identity"), {
        schemaVersion: 1,
        classificationVersion: "1.0.0",
        modes: [
          {
            modeId: "observe",
            operation: "observe",
            scope: "workspace",
            contribution: "supporting",
          },
        ],
        resolve:
          resource === "left"
            ? () => ({
                semantics: progressSemantics(
                  "observe",
                  "workspace",
                  "supporting",
                ),
                resourceKey: { side: "left" },
              })
            : () => ({
                semantics: progressSemantics(
                  "observe",
                  "workspace",
                  "supporting",
                ),
                resourceKey: { side: "right" },
              }),
      });

    const left = createOwnedToolRecordV2(declared("left"));
    const right = createOwnedToolRecordV2(declared("right"));

    expect(left.definition.progress.resolutionSha256).not.toBe(
      right.definition.progress.resolutionSha256,
    );
    expect(left.definitionSha256).not.toBe(right.definitionSha256);
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

function progressAbiSha256(definition: ToolDefinitionV2): string {
  const {
    failure: _failure,
    sideEffectResolutionSha256: _sideEffectResolutionSha256,
    uiProjectionSchema,
    compatibility,
    ...previousDefinition
  } = definition;
  const { legacyDefinitionSha256: _legacyDefinitionSha256, ...adapter } =
    compatibility;
  return sha256(
    canonicalJson({
      ...previousDefinition,
      uiProjectionSchema: removeUiProjectionFields(uiProjectionSchema, [
        "failureDefinitionSha256",
      ]),
      compatibility: adapter,
    }),
  );
}

function preProgressAbiSha256(definition: ToolDefinitionV2): string {
  const {
    failure: _failure,
    progress: _progress,
    sideEffectResolutionSha256: _sideEffectResolutionSha256,
    compatibility,
    uiProjectionSchema,
    ...previousDefinition
  } = definition;
  const { legacyDefinitionSha256: _legacyDefinitionSha256, ...adapter } =
    compatibility;
  return sha256(
    canonicalJson({
      ...previousDefinition,
      uiProjectionSchema: removeUiProjectionFields(uiProjectionSchema, [
        "progress",
        "failureDefinitionSha256",
      ]),
      compatibility: adapter,
    }),
  );
}

function removeUiProjectionFields(
  schema: ToolJsonSchema,
  fields: readonly string[],
): ToolJsonSchema {
  const clone = structuredClone(schema);
  if (Array.isArray(clone["required"])) {
    clone["required"] = clone["required"].filter(
      (field) => !fields.includes(String(field)),
    );
  }
  const properties = clone["properties"];
  if (
    properties &&
    typeof properties === "object" &&
    !Array.isArray(properties)
  ) {
    for (const field of fields) {
      delete (properties as Record<string, unknown>)[field];
    }
  }
  return clone;
}

function deployedNativeAbiSha256(definition: ToolDefinitionV2): string {
  const {
    failure: _failure,
    progress: _progress,
    sideEffectResolutionSha256: _sideEffectResolutionSha256,
    uiProjectionSchema,
    compatibility,
    ...deployed
  } = definition;
  const { legacyDefinitionSha256: _legacyDefinitionSha256, ...adapter } =
    compatibility;
  return sha256(
    canonicalJson({
      ...deployed,
      retry: { strategy: "not_started", maxAttempts: 2 },
      uiProjectionSchema: removeUiProjectionFields(uiProjectionSchema, [
        "progress",
        "failureDefinitionSha256",
      ]),
      compatibility: adapter,
    }),
  );
}

function deployedCompatibilityAbiSha256(
  tool: Pick<AgentTool, "name" | "parameters">,
  currentDefinition: ToolDefinitionV2,
): string {
  return sha256(
    canonicalJson({
      schemaVersion: 2,
      id: tool.name,
      version: "1.0.0-compat.1",
      capabilityUris: [`cap://tools/${encodeURIComponent(tool.name)}`],
      inputSchema: structuredClone(tool.parameters),
      canonicalOutputSchema: genericToolResultSchema("canonical"),
      modelVisibleOutputSchema: genericToolResultSchema("model_visible"),
      uiProjectionSchema: removeUiProjectionFields(
        currentDefinition.uiProjectionSchema,
        ["progress", "failureDefinitionSha256"],
      ),
      concurrency: "safe",
      sideEffect: "none",
      sideEffectMode: "static",
      retry: { strategy: "not_started", maxAttempts: 2 },
      idempotency: { key: "arguments", resultReplay: "never" },
      approval: { mode: "none", codeBridge: "allowed" },
      policyTags: ["configured", "compatibility:pi-agent-tool-v1"],
      compatibility: { mode: "compatibility", runtime: "pi-agent-tool/v1" },
    }),
  );
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

function owner() {
  return { threadId: "thread_fixture", runId: "run_fixture" };
}
