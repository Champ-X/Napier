import type { RuntimeCapabilityProbe } from "@napier/runtime/doctor-probes";

import type { DoctorCheck } from "./doctor-report.js";

export type LocalCapabilityId = "skills" | "lsp" | "dap" | "python" | "shell";

/**
 * Maps a runtime capability probe to a Doctor check. Local capabilities are
 * optional: an unavailable dependency degrades the report and surfaces a
 * remediation, but it never blocks, mirroring the sandbox convention.
 */
export async function localCapabilityCheck(
  id: LocalCapabilityId,
  probe: () => Promise<RuntimeCapabilityProbe>,
): Promise<DoctorCheck> {
  const startedAt = Date.now();
  try {
    const result = await probe();
    return {
      id,
      status: result.status === "unavailable" ? "warning" : "passed",
      required: false,
      code: result.code,
      message: result.message,
      durationMs: Date.now() - startedAt,
      ...(result.evidence ? { evidence: result.evidence } : {}),
    };
  } catch {
    return {
      id,
      status: "warning",
      required: false,
      code: `${id}_check_unavailable`,
      message: `${id} readiness could not be determined`,
      durationMs: Date.now() - startedAt,
    };
  }
}
