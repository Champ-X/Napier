import type { EvaluationCasebook, RunRecord } from "@napier/contracts";
import type { EvaluationCasebookTemplate } from "@napier/contracts/evaluation-casebook-template";

import { ControlledHarnessEvidenceControl } from "./ControlledHarnessEvidenceControl";
import { ReleaseProductTrialControl } from "./ReleaseProductTrialControl";

export function EvaluationReleaseGateControls({
  threadId,
  casebook,
  template,
  selectedCaseId,
  runs,
}: {
  threadId: string;
  casebook: EvaluationCasebook;
  template: EvaluationCasebookTemplate | undefined;
  selectedCaseId: string;
  runs: RunRecord[];
}) {
  return (
    <>
      <ReleaseProductTrialControl
        threadId={threadId}
        casebook={casebook}
        template={template}
        selectedCaseId={selectedCaseId}
        runs={runs}
      />
      <ControlledHarnessEvidenceControl
        threadId={threadId}
        casebook={casebook}
        template={template}
      />
    </>
  );
}
