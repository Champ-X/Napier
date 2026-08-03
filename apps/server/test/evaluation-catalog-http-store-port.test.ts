import { expectTypeOf, it } from "vitest";

import type { EvaluationCatalogStore } from "../src/evaluation-catalog-http.js";

it("keeps Evaluation Catalog HTTP on an eleven-method read port", () => {
  expectTypeOf<keyof EvaluationCatalogStore>().toEqualTypeOf<
    | "exportEvaluationCasebook"
    | "getEvaluationCasebook"
    | "getEvaluationCasebookCalibration"
    | "getEvaluationSuite"
    | "getThread"
    | "listEvaluationCasebookQualificationExecutions"
    | "listEvaluationCasebooks"
    | "listEvaluationQualificationBaselines"
    | "listEvaluationSuiteExecutions"
    | "listEvaluationSuites"
    | "listRunEvaluations"
  >();
});
