import { expectTypeOf, it } from "vitest";

import type { PlanArtifactInspectionHttpStore } from "../src/plan-artifact-inspection-http.js";

it("keeps Plan Artifact inspection HTTP on a three-capability Store port", () => {
  expectTypeOf<keyof PlanArtifactInspectionHttpStore>().toEqualTypeOf<
    "appendEvent" | "getPlan" | "workspaceRoot"
  >();
});
