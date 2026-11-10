import { expect, it } from "vitest";
import {
  hasToolReconciliationAdapter,
  resolveToolReplayClass,
} from "../src/tool-replay-eligibility.js";

it("classifies protocol tools without promoting writes to safe_rerun", () => {
  expect(
    resolveToolReplayClass({
      toolName: "read_file",
      sideEffect: "none",
      resultReplay: "exact_result_only",
    }),
  ).toBe("exact_result");
  expect(
    resolveToolReplayClass({
      toolName: "bash",
      sideEffect: "irreversible",
      resultReplay: "never",
    }),
  ).toBe("never");
  expect(
    resolveToolReplayClass({
      toolName: "apply_patch",
      sideEffect: "reversible",
      resultReplay: "never",
    }),
  ).toBe("reconcile");
  expect(hasToolReconciliationAdapter("apply_patch")).toBe(true);
  expect(hasToolReconciliationAdapter("bash")).toBe(false);
});
