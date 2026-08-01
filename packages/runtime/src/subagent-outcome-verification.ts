import type {
  SubagentOutcome,
  SubagentOutcomeEvidence,
  SubagentOutcomeEvidenceVerification,
  SubagentOutcomeEvidenceVerificationItem,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { canonicalSubagentEvidence } from "./subagent-outcome-model.js";
import { validateSubagentOutcome } from "./subagent-outcomes.js";
import { readWorkspaceTextEvidence } from "./tools.js";

type GroundedVerificationEvidence = {
  path: string;
  fileSha256: string;
  rangeSha256: string;
} & (
  | {
      lineStart?: never;
      lineEnd?: never;
    }
  | {
      lineStart: number;
      lineEnd: number;
    }
);

export async function verifySubagentOutcomeEvidence(
  input: unknown,
  workspaceRoot: string,
): Promise<SubagentOutcomeEvidenceVerification> {
  const outcome = validateSubagentOutcome(input);
  if (outcome.schemaVersion === 1) {
    return buildEvidenceVerification(outcome, "unavailable", []);
  }
  const evidence = canonicalSubagentEvidence(
    outcome.items.flatMap((item) => item.evidence),
  ).map(requireGroundedVerificationEvidence);
  const items = await Promise.all(
    evidence.map(
      async (expected): Promise<SubagentOutcomeEvidenceVerificationItem> => {
        try {
          const observed = await readWorkspaceTextEvidence(workspaceRoot, {
            path: expected.path,
            ...(expected.lineStart === undefined
              ? {}
              : {
                  lineStart: expected.lineStart,
                  lineEnd: expected.lineEnd,
                }),
          });
          const aligned =
            observed.fileSha256 === expected.fileSha256 &&
            observed.rangeSha256 === expected.rangeSha256;
          return {
            path: expected.path,
            ...(expected.lineStart === undefined
              ? {}
              : {
                  lineStart: expected.lineStart,
                  lineEnd: expected.lineEnd,
                }),
            status: aligned ? "aligned" : "divergent",
            expectedFileSha256: expected.fileSha256,
            observedFileSha256: observed.fileSha256,
            expectedRangeSha256: expected.rangeSha256,
            observedRangeSha256: observed.rangeSha256,
          };
        } catch (error) {
          if (isMissingWorkspaceEvidence(error)) {
            return {
              path: expected.path,
              ...(expected.lineStart === undefined
                ? {}
                : {
                    lineStart: expected.lineStart,
                    lineEnd: expected.lineEnd,
                  }),
              status: "missing",
              expectedFileSha256: expected.fileSha256,
              expectedRangeSha256: expected.rangeSha256,
              diagnosticSha256: evidenceDiagnosticSha256("file_missing"),
            };
          }
          if (expected.lineStart !== undefined) {
            try {
              const observed = await readWorkspaceTextEvidence(workspaceRoot, {
                path: expected.path,
              });
              return {
                path: expected.path,
                lineStart: expected.lineStart,
                lineEnd: expected.lineEnd,
                status: "divergent",
                expectedFileSha256: expected.fileSha256,
                observedFileSha256: observed.fileSha256,
                expectedRangeSha256: expected.rangeSha256,
                diagnosticSha256: evidenceDiagnosticSha256("range_unavailable"),
              };
            } catch (fallbackError) {
              if (isMissingWorkspaceEvidence(fallbackError)) {
                return {
                  path: expected.path,
                  lineStart: expected.lineStart,
                  lineEnd: expected.lineEnd,
                  status: "missing",
                  expectedFileSha256: expected.fileSha256,
                  expectedRangeSha256: expected.rangeSha256,
                  diagnosticSha256: evidenceDiagnosticSha256("file_missing"),
                };
              }
            }
          }
          return {
            path: expected.path,
            ...(expected.lineStart === undefined
              ? {}
              : {
                  lineStart: expected.lineStart,
                  lineEnd: expected.lineEnd,
                }),
            status: "divergent",
            expectedFileSha256: expected.fileSha256,
            expectedRangeSha256: expected.rangeSha256,
            diagnosticSha256: evidenceDiagnosticSha256("evidence_unreadable"),
          };
        }
      },
    ),
  );
  return buildEvidenceVerification(
    outcome,
    items.every((item) => item.status === "aligned") ? "aligned" : "divergent",
    items,
  );
}

function buildEvidenceVerification(
  outcome: SubagentOutcome,
  status: SubagentOutcomeEvidenceVerification["status"],
  items: SubagentOutcomeEvidenceVerificationItem[],
): SubagentOutcomeEvidenceVerification {
  const content = {
    kind: "napier.subagent-outcome-evidence-verification" as const,
    schemaVersion: 1 as const,
    status,
    taskId: outcome.taskId,
    outcomeSha256: outcome.contentSha256,
    evidenceCount: items.length,
    alignedCount: items.filter((item) => item.status === "aligned").length,
    divergentCount: items.filter((item) => item.status === "divergent").length,
    missingCount: items.filter((item) => item.status === "missing").length,
    items,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function requireGroundedVerificationEvidence(
  evidence: SubagentOutcomeEvidence,
): GroundedVerificationEvidence {
  if (!evidence.fileSha256 || !evidence.rangeSha256) {
    throw new Error("Grounded Subagent evidence hashes are missing");
  }
  if (evidence.lineStart === undefined) {
    if (evidence.lineEnd !== undefined) {
      throw new Error("Grounded Subagent evidence line range is incomplete");
    }
    return {
      path: evidence.path,
      fileSha256: evidence.fileSha256,
      rangeSha256: evidence.rangeSha256,
    };
  }
  if (evidence.lineEnd === undefined) {
    throw new Error("Grounded Subagent evidence line range is incomplete");
  }
  return {
    path: evidence.path,
    lineStart: evidence.lineStart,
    lineEnd: evidence.lineEnd,
    fileSha256: evidence.fileSha256,
    rangeSha256: evidence.rangeSha256,
  };
}

function isMissingWorkspaceEvidence(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function evidenceDiagnosticSha256(
  reason: "evidence_unreadable" | "file_missing" | "range_unavailable",
): string {
  return sha256(canonicalJson({ reason }));
}
