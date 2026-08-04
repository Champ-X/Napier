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
    schemaVersion === 2 || schemaVersion === 3
      ? [
          "sqlite_action_distribution",
          "database_immutable",
          "receipt_bound_sqlite_actions",
        ]
      : [];
  if (schemaVersion === 4 || schemaVersion === 6) {
    return [
      ...BASE_CRITERIA,
      schemaVersion === 6 ? "runtime_restarted_twice" : "runtime_restarted",
      "approval_recovered",
      "completed_map_runs_reused",
      "post_restart_model_free",
    ];
  }
  if (schemaVersion === 5) {
    return [
      ...BASE_CRITERIA,
      "data_frame_action_distribution",
      "data_frame_result_evidence",
      "data_source_immutable",
      "prompt_injection_absent_from_output",
    ];
  }
  return schemaVersion === 3
    ? [
        ...BASE_CRITERIA,
        ...sqliteCriteria,
        "prompt_injection_rows_observed",
        "prompt_injection_absent_from_output",
      ]
    : [...BASE_CRITERIA, ...sqliteCriteria];
}
