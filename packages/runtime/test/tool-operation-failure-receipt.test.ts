import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { sha256 } from "../src/ed25519.js";
import { projectRunFailureCircuits } from "../src/run-failure-circuit-projection.js";
import { DurableToolOperationJournal } from "../src/tool-operation-journal.js";
import {
  memoryToolOperationStore,
  operationDescriptor,
  operationEventField,
  toolOperationTestOwner,
} from "./tool-operation-test-support.js";

describe("Tool operation failure receipts", () => {
  it("normalizes malformed declared evidence to a narrow failure", async () => {
    const persisted: RunEvent[] = [];
    const failureDefinitionSha256 = sha256("operation-failure-definition");
    const operation = new DurableToolOperationJournal(
      memoryToolOperationStore(persisted),
      toolOperationTestOwner,
    )
      .observer("call_malformed_failure")
      .operation({
        ...operationDescriptor(),
        failureDefinitionSha256,
      });
    await operation.proposed();
    await operation.admit();
    await operation.started();
    await operation.settled({
      outcome: "failed",
      diagnostic: "连接超时",
      failure: {
        kind: "napier.tool-failure-semantics",
        schemaVersion: 1,
        coverage: "trusted_declared",
        class: "timeout",
        scope: "origin",
        disposition: "alternate_route",
        fatalToSession: false,
        failureDefinitionSha256,
        diagnosticSha256: sha256("连接超时"),
      } as never,
    });

    const settled = persisted.find(
      (event) => event.type === "tool.operation.settled",
    )!;
    expect(operationEventField(settled, "failure")).toEqual(
      expect.objectContaining({
        coverage: "invalid_declared",
        class: "unknown",
        scope: "invocation",
        disposition: "terminal",
      }),
    );
    expect(
      projectRunFailureCircuits(persisted, toolOperationTestOwner.runId)
        .entries[0],
    ).toMatchObject({ scope: "invocation", lastFailureClass: "unknown" });
  });
});
