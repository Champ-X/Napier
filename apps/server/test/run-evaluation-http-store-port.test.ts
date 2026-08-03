import { expectTypeOf, it } from "vitest";

import type { RunEvaluationHttpStore } from "../src/run-evaluation-http.js";

it("keeps Run Evaluation HTTP on a two-method Store port", () => {
  expectTypeOf<keyof RunEvaluationHttpStore>().toEqualTypeOf<
    "getAgent" | "getThread"
  >();
});
