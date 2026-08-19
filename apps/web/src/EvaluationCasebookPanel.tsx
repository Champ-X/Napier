import { EvaluationCasebookView } from "./EvaluationCasebookView";
import { useEvaluationCasebook } from "./use-evaluation-casebook";
import type { UseEvaluationCasebookOptions } from "./use-evaluation-casebook";

export type EvaluationCasebookPanelProps = UseEvaluationCasebookOptions;

export default function EvaluationCasebookPanel(
  props: EvaluationCasebookPanelProps,
) {
  return <EvaluationCasebookView state={useEvaluationCasebook(props)} />;
}
