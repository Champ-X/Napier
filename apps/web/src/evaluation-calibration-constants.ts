import type { RunEvaluationVerdict } from "@napier/contracts";

export const CALIBRATION_VERDICTS: readonly RunEvaluationVerdict[] = [
  "left_better",
  "right_better",
  "tie",
  "inconclusive",
];
