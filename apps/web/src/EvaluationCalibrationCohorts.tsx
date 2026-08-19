import type { EvaluationCalibrationReport } from "@napier/contracts";

import { copy } from "./copy";
import { CALIBRATION_VERDICTS } from "./evaluation-calibration-constants";

export interface EvaluationCalibrationCohortsProps {
  report: EvaluationCalibrationReport | undefined;
}

export function EvaluationCalibrationCohorts({
  report,
}: EvaluationCalibrationCohortsProps) {
  if (!report?.sampleCount) {
    return (
      <p className="calibration-empty">{copy.lab.calibration.noSamples}</p>
    );
  }
  return (
    <div className="calibration-cohorts">
      {report.groups.map((group) => (
        <details
          key={`${group.evaluatorModel.provider}/${group.evaluatorModel.id}/${group.rubricSha256}`}
        >
          <summary>
            <span>
              <strong>
                {group.evaluatorModel.provider}/{group.evaluatorModel.id}
              </strong>
              <small>{group.rubricName}</small>
            </span>
            <span>
              <strong>{Math.round(group.agreementRate * 100)}%</strong>
              <small>
                {group.sampleCount} {copy.lab.calibration.samples}
              </small>
            </span>
          </summary>
          <table>
            <caption>{copy.lab.calibration.matrix}</caption>
            <thead>
              <tr>
                <th scope="col">{copy.lab.calibration.modelAxis}</th>
                {CALIBRATION_VERDICTS.map((verdict) => (
                  <th
                    key={verdict}
                    scope="col"
                    title={`${copy.lab.calibration.truthAxis}: ${copy.lab.verdicts[verdict]}`}
                  >
                    {copy.lab.calibration.verdictMarks[verdict]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CALIBRATION_VERDICTS.map((modelVerdict) => (
                <tr key={modelVerdict}>
                  <th scope="row" title={copy.lab.verdicts[modelVerdict]}>
                    {copy.lab.calibration.verdictMarks[modelVerdict]}
                  </th>
                  {CALIBRATION_VERDICTS.map((truthVerdict) => (
                    <td key={truthVerdict}>
                      {group.confusionMatrix[modelVerdict][truthVerdict]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
    </div>
  );
}
