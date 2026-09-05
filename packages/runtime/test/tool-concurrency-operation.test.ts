import type { ToolInvocationProtocolV2 } from "@napier/contracts/tool-protocol";
import { describe, expect, it } from "vitest";

import { toolConcurrencyOperation } from "../src/tool-concurrency-operation.js";

describe("tool concurrency operation", () => {
  it("groups different workspace tools under one mutation boundary", () => {
    expect(operation("read", "workspace", "a")).toEqual({
      operationId: "read",
      requirements: [{ key: ["run", "workspace"], mode: "serialized" }],
    });
    expect(operation("write", "workspace", "b")).toEqual({
      operationId: "write",
      requirements: [{ key: ["run", "workspace"], mode: "serialized" }],
    });
  });

  it("upgrades every declared mutation to an exclusive claim", () => {
    expect(operation("dynamic-write", "workspace", "path-a", "mutate")).toEqual(
      {
        operationId: "dynamic-write",
        requirements: [{ key: ["run", "workspace"], mode: "exclusive" }],
      },
    );
  });

  it("claims both the semantic resource and a bound session", () => {
    expect(
      operation("browser-save", "workspace", "path-a", "mutate", "session-a"),
    ).toEqual({
      operationId: "browser-save",
      requirements: [
        { key: ["run", "workspace"], mode: "exclusive" },
        { key: ["run", "session", "session-a"], mode: "exclusive" },
      ],
    });
  });

  it("isolates bound sessions and fails unknown effects into the Run root", () => {
    expect(operation("kernel", "session", "kernel-a")).toEqual({
      operationId: "kernel",
      requirements: [
        { key: ["run", "session", "kernel-a"], mode: "serialized" },
      ],
    });
    expect(operation("opaque", "neutral")).toEqual({
      operationId: "opaque",
      requirements: [{ key: ["run"], mode: "serialized" }],
    });
  });
});

function operation(
  operationId: string,
  scope: ToolInvocationProtocolV2["progress"]["scope"],
  binding?: string,
  progressOperation: ToolInvocationProtocolV2["progress"]["operation"] = "coordinate",
  sessionBinding?: string,
) {
  return toolConcurrencyOperation(operationId, {
    kind: "napier.tool-invocation-protocol",
    schemaVersion: 2,
    toolId: operationId,
    semanticVersion: "1.0.0",
    definitionSha256: "a".repeat(64),
    failureDefinitionSha256: "c".repeat(64),
    implementationSha256: "b".repeat(64),
    sideEffect: "unknown",
    concurrency: "serialized",
    retry: { strategy: "not_started", maxAttempts: 1 },
    idempotency: { key: "none", resultReplay: "never" },
    approval: { mode: "policy", codeBridge: "allowed" },
    progress: {
      kind: "napier.tool-progress-semantics",
      schemaVersion: 1,
      availability: "declared",
      coverage: "trusted_declared",
      operation: progressOperation,
      scope,
      contribution: "neutral",
      ...(binding ? { failureDomainKeySha256: binding } : {}),
      ...(sessionBinding
        ? { failureBindings: { session: sessionBinding } }
        : {}),
    },
    policyTags: [],
    compatibilityMode: "compatibility",
  });
}
