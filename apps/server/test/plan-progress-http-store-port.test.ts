import { expectTypeOf, it } from "vitest";

import type { PlanProgressHttpStore } from "../src/plan-progress-http.js";

it("keeps Plan progress HTTP on a five-capability Store port", () => {
  expectTypeOf<keyof PlanProgressHttpStore>().toEqualTypeOf<
    | "appendEvent"
    | "getPlan"
    | "transitionPlanStep"
    | "updatePlanArtifact"
    | "workspaceRoot"
  >();
});
