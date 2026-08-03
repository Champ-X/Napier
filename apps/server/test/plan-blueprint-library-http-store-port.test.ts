import { expectTypeOf, it } from "vitest";

import type { PlanBlueprintLibraryHttpStore } from "../src/plan-blueprint-library-http.js";

it("keeps Plan Blueprint Library HTTP on a seven-method Store port", () => {
  expectTypeOf<keyof PlanBlueprintLibraryHttpStore>().toEqualTypeOf<
    | "appendEvent"
    | "getThread"
    | "listExecutionPlanBlueprints"
    | "qualifyExecutionPlanBlueprintRecord"
    | "saveExecutionPlanBlueprint"
    | "selectExecutionPlanBlueprintRecord"
    | "setExecutionPlanBlueprintRecordStatus"
  >();
});
