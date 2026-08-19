import { EvaluationSuiteView } from "./EvaluationSuiteView";
import { useEvaluationSuite } from "./use-evaluation-suite";
import type { UseEvaluationSuiteOptions } from "./use-evaluation-suite";

export type EvaluationSuitePanelProps = UseEvaluationSuiteOptions;

export default function EvaluationSuitePanel(props: EvaluationSuitePanelProps) {
  return <EvaluationSuiteView state={useEvaluationSuite(props)} />;
}
