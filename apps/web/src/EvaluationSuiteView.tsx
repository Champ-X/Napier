import { ClipboardCheck, ShieldCheck } from "lucide-react";

import { copy } from "./copy";
import { EvaluationCalibrationLedger } from "./EvaluationCalibrationLedger";
import EvaluationCasebookPanel from "./EvaluationCasebookPanel";
import { EvaluationSuiteCompose } from "./EvaluationSuiteCompose";
import { EvaluationSuiteRegister } from "./EvaluationSuiteRegister";
import ReceiptTrustPanel from "./ReceiptTrustPanel";
import type { useEvaluationSuite } from "./use-evaluation-suite";

type EvaluationSuiteState = ReturnType<typeof useEvaluationSuite>;

export interface EvaluationSuiteViewProps {
  state: EvaluationSuiteState;
}

export function EvaluationSuiteView({ state }: EvaluationSuiteViewProps) {
  const {
    threadId,
    runs,
    evaluations,
    adjudications,
    reviewerBallots,
    consensusResolutions,
    selectedModelKey,
    models,
    onRefresh,
    onUseTaskPrompt,
    trustAnchors,
    setTrustAnchors,
    selectedTrustAnchorId,
    setSelectedTrustAnchorId,
  } = state;
  return (
    <section
      className="evaluation-suite-panel"
      aria-labelledby="evaluation-suite-title"
    >
      <header>
        <div>
          <span>{copy.lab.suite.eyebrow}</span>
          <h3 id="evaluation-suite-title">{copy.lab.suite.title}</h3>
        </div>
        <ClipboardCheck size={16} aria-hidden="true" />
      </header>
      <p>{copy.lab.suite.body}</p>

      <ReceiptTrustPanel
        threadId={threadId}
        anchors={trustAnchors}
        selectedAnchorId={selectedTrustAnchorId}
        onSelect={setSelectedTrustAnchorId}
        onAnchors={setTrustAnchors}
      />

      <EvaluationCalibrationLedger
        threadId={threadId}
        evaluations={evaluations}
        adjudications={adjudications}
        reviewerBallots={reviewerBallots}
        consensusResolutions={consensusResolutions}
        onRefresh={onRefresh}
      />

      <EvaluationCasebookPanel
        threadId={threadId}
        runs={runs}
        evaluations={evaluations}
        adjudications={adjudications}
        models={models}
        selectedModelKey={selectedModelKey}
        trustAnchors={trustAnchors}
        selectedTrustAnchorId={selectedTrustAnchorId}
        onRefresh={onRefresh}
        onUseTaskPrompt={onUseTaskPrompt}
      />

      <EvaluationSuiteCompose state={state} />

      <EvaluationSuiteRegister state={state} />

      <p className="suite-safety">
        <ShieldCheck size={11} aria-hidden="true" />
        {copy.lab.suite.safety}
      </p>
    </section>
  );
}
