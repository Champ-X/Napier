import { expectTypeOf, it } from "vitest";

import type { EvaluationSuiteAdminStore } from "../src/evaluation-suite-admin-http.js";

it("keeps Evaluation Suite administration on a four-method Store port", () => {
  expectTypeOf<keyof EvaluationSuiteAdminStore>().toEqualTypeOf<
    | "appendEvent"
    | "createEvaluationSuite"
    | "getEvaluationSuite"
    | "updateEvaluationSuite"
  >();
});
