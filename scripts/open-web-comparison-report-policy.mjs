export const OPEN_WEB_COMPARISON_NOTES = [
  "Default track preserves each product's isolated built-in capabilities.",
  "Controlled track disables OMP Skills, Rules, and Extensions and limits both products to Search, URL/PDF read, and Browser tools.",
  "Every trial uses a fresh workspace, Napier data root, HOME, and OMP profile.",
  "OMP receives only a dummy child credential; a bounded loopback proxy injects the parent-only DeepSeek key.",
  "Raw prompts, answers, quotes, URLs, reasoning, tool arguments, transcripts, and credentials are not retained.",
];

const DIAGNOSTICS = new Set([
  "answer_mismatch",
  "credential_leak_detected",
  "fact_count_mismatch",
  "fact_id_mismatch",
  "final_output_missing",
  "final_output_not_json",
  "final_output_oversized",
  "final_output_shape_invalid",
  "machine_output_invalid",
  "process_output_limit",
  "process_timeout",
  "quote_mismatch",
  "source_url_mismatch",
  "tool_browser_missing",
  "tool_fetch_missing",
  "tool_search_missing",
]);

const FAILURE_CLASSES = new Set([
  "executor_failure",
  "external_infrastructure",
  "machine_protocol",
  "none",
  "outcome_oracle",
  "output_limit",
  "security_leak",
  "timeout",
]);

export function validOpenWebComparisonDiagnostics(value) {
  return (
    Array.isArray(value) &&
    value.length <= 20 &&
    value.every((entry) => DIAGNOSTICS.has(entry))
  );
}

export function validOpenWebComparisonFailureClass(value) {
  return FAILURE_CLASSES.has(value);
}
