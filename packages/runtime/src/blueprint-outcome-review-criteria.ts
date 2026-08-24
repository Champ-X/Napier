import type { ExecutionPlanBlueprintOutcomeReviewCriteria } from "@napier/contracts";

export const DEFAULT_BLUEPRINT_OUTCOME_REVIEW_CRITERIA: ExecutionPlanBlueprintOutcomeReviewCriteria =
  {
    name: "Reusable workflow delivery",
    criteria: [
      {
        id: "completion",
        name: "Completion",
        description:
          "Replay outcomes should show completed plans without active, blocked, missing, or identity-mismatched delivery.",
      },
      {
        id: "stability",
        name: "Stability",
        description:
          "The template should have enough replay evidence to avoid promoting a one-off lucky result.",
      },
      {
        id: "auditability",
        name: "Auditability",
        description:
          "Outcome, replay-history, baseline, and Plan projection hashes should be present and current.",
      },
      {
        id: "reuse_risk",
        name: "Reuse risk",
        description:
          "The template should be safe to recommend for future Threads without hiding delivery drift or unresolved work.",
      },
    ],
  };
