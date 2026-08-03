import { expectTypeOf, it } from "vitest";

import type { PlanBlueprintInstantiationHttpStore } from "../src/plan-blueprint-instantiation-http.js";

it("keeps Plan Blueprint instantiation HTTP on a five-method Store port", () => {
  expectTypeOf<keyof PlanBlueprintInstantiationHttpStore>().toEqualTypeOf<
    | "appendEvent"
    | "createPlan"
    | "createPlanFromBlueprintRecord"
    | "getThread"
    | "previewPlanFromBlueprintRecord"
  >();
});
