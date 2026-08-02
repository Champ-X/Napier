import type { JsonValue } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime";

import type { WorkflowBenchmarkResult } from "./workflow-benchmark-types.js";

export function createWorkflowBenchmarkResult(
  content: Omit<WorkflowBenchmarkResult, "contentSha256">,
): WorkflowBenchmarkResult {
  return {
    ...structuredClone(content),
    contentSha256: sha256(canonicalJson(content as unknown as JsonValue)),
  };
}
