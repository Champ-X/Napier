import { expectTypeOf, it } from "vitest";

import type { PlanBlueprintReplayHttpStore } from "../src/plan-blueprint-replay-http.js";

it("keeps Plan Blueprint replay HTTP on a six-method Store port", () => {
  expectTypeOf<keyof PlanBlueprintReplayHttpStore>().toEqualTypeOf<
    | "getExecutionPlanBlueprintRecord"
    | "getExecutionPlanBlueprintRecordReplayHistory"
    | "getExecutionPlanBlueprintRecordReplayOutcomes"
    | "verifyExecutionPlanBlueprintRecordReplayEvent"
    | "verifyExecutionPlanBlueprintRecordReplayHistory"
    | "verifyExecutionPlanBlueprintRecordReplayOutcomes"
  >();
});
