import { expectTypeOf, it } from "vitest";

import type { EvaluationCasebookAdminStore } from "../src/evaluation-casebook-admin-http.js";

it("keeps Evaluation Casebook administration on a six-method Store port", () => {
  expectTypeOf<keyof EvaluationCasebookAdminStore>().toEqualTypeOf<
    | "appendEvent"
    | "createEvaluationCasebook"
    | "curateEvaluationCasebookCase"
    | "getEvaluationCasebook"
    | "removeEvaluationCasebookCase"
    | "updateEvaluationCasebook"
  >();
});
