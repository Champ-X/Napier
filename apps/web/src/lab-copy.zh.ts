import { labCalibrationCopyZh } from "./lab-calibration-copy.zh";
import { labCasebookCopyZh } from "./lab-casebook-copy.zh";
import { labCoreCopyZh } from "./lab-core-copy.zh";
import { labSuiteCopyZh } from "./lab-suite-copy.zh";
import { labTrustBaselineCopyZh } from "./lab-trust-baseline-copy.zh";
import { labTrustCoreCopyZh } from "./lab-trust-core-copy.zh";

export const labCopyZh = {
  ...labCoreCopyZh,
  trust: {
    ...labTrustCoreCopyZh,
    ...labTrustBaselineCopyZh,
  },
  calibration: labCalibrationCopyZh,
  casebook: labCasebookCopyZh,
  suite: labSuiteCopyZh,
} as const;
