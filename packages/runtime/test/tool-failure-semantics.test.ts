import { describe, expect, it } from "vitest";
import { Type } from "typebox";

import {
  defineToolFailureSemantics,
  normalizeToolFailureReceipt,
  normalizeTransportAbortFailure,
  toolFailureDefinitionSha256,
  toolFailureLedgerProjection,
  toolFailureSemantics,
} from "../src/tool-failure-semantics.js";
import { createOwnedToolRecordV2 } from "../src/owned-tool-protocol.js";
import { wrapToolsWithFailureCapture } from "../src/agent-tool-failure-capture.js";
import { ToolProtocolRegistry } from "../src/tool-protocol-registry.js";

describe("Tool failure semantics", () => {
  it("treats a transport AbortError as timeout unless the caller cancelled", () => {
    const transportAbort = new Error("The operation was aborted");
    transportAbort.name = "AbortError";

    const recoverable = normalizeTransportAbortFailure(transportAbort, {
      aborted: false,
    });
    expect(recoverable).toMatchObject({ name: "TimeoutError" });
    expect(projection(recoverable)).toEqual(
      expect.objectContaining({
        class: "timeout",
        scope: "origin",
        disposition: "alternate_route",
      }),
    );

    const cancelled = normalizeTransportAbortFailure(transportAbort, {
      aborted: true,
    });
    expect(cancelled).toBe(transportAbort);
    expect(projection(cancelled)).toEqual(
      expect.objectContaining({
        class: "cancelled",
        scope: "invocation",
        disposition: "terminal",
      }),
    );
  });

  it("lets an arbitrary tool classify localized errors from typed codes", async () => {
    class RegionalError extends Error {
      readonly code = "REGION_DOWN";
    }
    const tool = defineToolFailureSemantics(
      {
        name: "arbitrary_localized_tool",
        label: "Arbitrary",
        description: "fixture",
        parameters: Type.Object({ region: Type.String() }),
        async execute() {
          throw new RegionalError("区域服务当前不可用");
        },
      },
      {
        schemaVersion: 1,
        classificationVersion: "1.0.0",
        modes: [
          {
            modeId: "regional_outage",
            class: "network",
            scope: "route",
            disposition: "alternate_route",
            fatalToSession: false,
          },
        ],
        resolve(input, failure) {
          if (
            !(failure instanceof RegionalError) ||
            failure.code !== "REGION_DOWN"
          ) {
            throw new Error("missing typed error code");
          }
          return {
            semantics: toolFailureSemantics({
              class: "network",
              scope: "route",
              disposition: "alternate_route",
              fatalToSession: false,
            }),
            bindingKey: {
              kind: "regional-route",
              region: (input as { region: string }).region,
            },
          };
        },
      },
    );
    const owned = createOwnedToolRecordV2(tool);
    const receipt = owned.failure(
      { region: "cn-north" },
      new RegionalError("区域服务当前不可用"),
    );

    expect(receipt).toMatchObject({
      coverage: "trusted_declared",
      modeId: "regional_outage",
      class: "network",
      scope: "route",
    });
    expect(receipt.failureDefinitionSha256).toBe(
      owned.invocation({ region: "cn-north" }).failureDefinitionSha256,
    );
    expect(receipt.failureDefinitionSha256).toBe(
      toolFailureDefinitionSha256(owned.definition.failure),
    );

    const tools = [tool];
    const protocols = new ToolProtocolRegistry(tools);
    let rawReceipt: typeof receipt | undefined;
    wrapToolsWithFailureCapture({
      tools,
      protocols,
      captured: (_callId, captured) => {
        rawReceipt = captured;
      },
    });
    await expect(
      tools[0]!.execute(
        "call_localized",
        { region: "cn-north" },
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toThrow("区域服务当前不可用");
    expect(rawReceipt).toMatchObject({
      coverage: "trusted_declared",
      modeId: "regional_outage",
    });
  });

  it("fails malformed declared receipts closed without consulting their text", () => {
    const malformed = normalizeToolFailureReceipt(
      {
        kind: "napier.tool-failure-semantics",
        schemaVersion: 1,
        coverage: "trusted_declared",
        class: "timeout",
        scope: "origin",
        disposition: "alternate_route",
        fatalToSession: false,
        failureDefinitionSha256: "not-a-hash",
        diagnosticSha256: "also-not-a-hash",
      },
      "Timeout while connecting",
    );
    expect(malformed).toMatchObject({
      coverage: "invalid_declared",
      class: "unknown",
      scope: "invocation",
      disposition: "terminal",
    });
  });

  it("marks diagnostic text inference as legacy-only", () => {
    expect(projection(new Error("ETIMEDOUT"))).toMatchObject({
      coverage: "legacy_fallback",
      class: "timeout",
    });
  });
});

function projection(error: unknown): Record<string, unknown> {
  const diagnostic =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return toolFailureLedgerProjection(diagnostic, undefined)
    .toolFailure as Record<string, unknown>;
}
