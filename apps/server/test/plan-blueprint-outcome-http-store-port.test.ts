import { expectTypeOf, it } from "vitest";

import type { PlanBlueprintOutcomeHttpStore } from "../src/plan-blueprint-outcome-http.js";

it("keeps Plan Blueprint outcome HTTP on a six-method Store port", () => {
  expectTypeOf<keyof PlanBlueprintOutcomeHttpStore>().toEqualTypeOf<
    | "getExecutionPlanBlueprintRecord"
    | "getExecutionPlanBlueprintRecordReplayOutcomes"
    | "listExecutionPlanBlueprintRecordOutcomeBaselines"
    | "promoteExecutionPlanBlueprintRecordOutcomeBaseline"
    | "qualifyExecutionPlanBlueprintRecord"
    | "qualifyExecutionPlanBlueprintRecordOutcomes"
  >();
});
