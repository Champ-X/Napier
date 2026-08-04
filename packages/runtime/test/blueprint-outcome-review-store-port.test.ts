import { expectTypeOf, it } from "vitest";

import type { BlueprintOutcomeReviewStorePort } from "../src/blueprint-outcome-review-store-port.js";

it("keeps Blueprint outcome review on a four-method Store port", () => {
  expectTypeOf<keyof BlueprintOutcomeReviewStorePort>().toEqualTypeOf<
    | "getExecutionPlanBlueprintRecord"
    | "getExecutionPlanBlueprintRecordReplayOutcomes"
    | "qualifyExecutionPlanBlueprintRecord"
    | "qualifyExecutionPlanBlueprintRecordOutcomes"
  >();
});
