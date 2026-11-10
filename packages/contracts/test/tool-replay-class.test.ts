import { describe, expect, it } from "vitest";
import { mapToolReplayClass } from "../src/tool-replay-class.js";

describe("mapToolReplayClass", () => {
  it("maps side-effect-free exact_result_only tools to exact_result", () => {
    expect(
      mapToolReplayClass({
        sideEffect: "none",
        resultReplay: "exact_result_only",
      }),
    ).toMatchObject({
      kind: "napier.tool-replay-class",
      schemaVersion: 1,
      class: "exact_result",
      source: "idempotency_policy",
    });
  });

  it("does not promote writes to safe_rerun without host declaration", () => {
    expect(
      mapToolReplayClass({
        sideEffect: "irreversible",
        resultReplay: "never",
      }).class,
    ).toBe("never");
    expect(
      mapToolReplayClass({
        sideEffect: "reversible",
        resultReplay: "exact_result_only",
      }).class,
    ).toBe("never");
  });

  it("uses reconcile when a postcondition adapter owns the tool", () => {
    expect(
      mapToolReplayClass({
        sideEffect: "reversible",
        resultReplay: "never",
        hasReconciliationAdapter: true,
      }),
    ).toMatchObject({
      class: "reconcile",
      source: "reconciliation_adapter",
    });
  });

  it("requires explicit host declaration for safe_rerun", () => {
    expect(
      mapToolReplayClass({
        sideEffect: "none",
        resultReplay: "never",
        hostSafeRerun: true,
      }),
    ).toMatchObject({
      class: "safe_rerun",
      source: "host_declaration",
    });
  });
});
