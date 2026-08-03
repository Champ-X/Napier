import { expectTypeOf, it } from "vitest";

import { createExecutionPlanBlueprint } from "../src/workflow-blueprints.js";

it("keeps Blueprint construction on the Plan Archive Store port", () => {
  type Store = Parameters<typeof createExecutionPlanBlueprint>[0];

  expectTypeOf<keyof Store>().toEqualTypeOf<
    "getPlan" | "getThread" | "listEvents"
  >();
});
