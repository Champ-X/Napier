import { expectTypeOf, it } from "vitest";

import type { EvaluationReviewStore } from "../src/evaluation-review-http.js";

it("keeps Evaluation Review HTTP on a nine-method Store port", () => {
  expectTypeOf<keyof EvaluationReviewStore>().toEqualTypeOf<
    | "appendEvent"
    | "getEvaluationConsensusReport"
    | "listEvaluationAdjudications"
    | "listEvaluationConsensusResolutions"
    | "listEvaluationReviewerBallots"
    | "listRunEvaluations"
    | "resolveEvaluationConsensus"
    | "reviewRunEvaluation"
    | "submitEvaluationReviewerBallot"
  >();
});
