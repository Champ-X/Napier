import type { RunRecord } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";

/** A caller's outcome assessment, not a Runtime verdict or permission grant.
 * Hash binding prevents accidental cross-Run exports; it does not authenticate
 * the reviewer or establish the correctness of their assessment. */
export interface ExternalOutcomeReview {
  kind: "napier.external-outcome-review";
  schemaVersion: 1;
  runId: string;
  threadId: string;
  configurationSha256: string;
  promptSha256: string;
  outcome: "failed";
  method: "external-grader" | "human-review";
  evidenceSha256: string;
  contentSha256: string;
}

export function resolveExternalOutcomeReview(
  value: unknown,
  run: RunRecord,
  promptSha256: string,
): ExternalOutcomeReview | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const review = value as Record<string, unknown>;
  const { contentSha256, ...content } = review;
  if (
    Object.keys(review).sort().join() !==
      "configurationSha256,contentSha256,evidenceSha256,kind,method,outcome,promptSha256,runId,schemaVersion,threadId" ||
    review.kind !== "napier.external-outcome-review" ||
    review.schemaVersion !== 1 ||
    review.outcome !== "failed" ||
    !["external-grader", "human-review"].includes(String(review.method)) ||
    review.runId !== run.id ||
    review.threadId !== run.threadId ||
    review.configurationSha256 !== run.configuration?.contentSha256 ||
    review.promptSha256 !== promptSha256 ||
    !["configurationSha256", "promptSha256", "evidenceSha256"].every(
      (field) =>
        typeof review[field] === "string" &&
        /^[a-f0-9]{64}$/u.test(review[field]),
    ) ||
    contentSha256 !== sha256(canonicalJson(content))
  )
    invalid();
  return structuredClone(review) as unknown as ExternalOutcomeReview;
}

function invalid(): never {
  throw new Error(
    "External outcome review is invalid or does not match the source Run",
  );
}
