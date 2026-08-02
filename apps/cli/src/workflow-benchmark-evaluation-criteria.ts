import type { WorkflowBenchmarkEvaluation } from "./workflow-benchmark-types.js";

const BASE_CRITERIA = [
  "workflow_completed",
  "exact_output",
  "ordered_map_output",
  "typed_node_completion",
  "isolated_map_runs",
  "map_and_reduce_events",
  "model_free_reduce",
  "portable_replay",
  "credential_absent",
] as const;

export function workflowBenchmarkCriteria(
  schemaVersion: WorkflowBenchmarkEvaluation["schemaVersion"],
): readonly string[] {
  const sqliteCriteria =
    schemaVersion === 1
      ? []
      : [
          "sqlite_action_distribution",
          "database_immutable",
          "receipt_bound_sqlite_actions",
        ];
  return schemaVersion === 3
    ? [
        ...BASE_CRITERIA,
        ...sqliteCriteria,
        "prompt_injection_rows_observed",
        "prompt_injection_absent_from_output",
      ]
    : [...BASE_CRITERIA, ...sqliteCriteria];
}
