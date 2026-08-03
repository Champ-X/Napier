import { expectTypeOf, it } from "vitest";

import type { PlanArtifactHttpStore } from "../src/plan-artifact-http-store.js";

it("keeps Plan Artifact HTTP on a three-capability Store port", () => {
  expectTypeOf<keyof PlanArtifactHttpStore>().toEqualTypeOf<
    "appendEvent" | "getPlan" | "workspaceRoot"
  >();
});
