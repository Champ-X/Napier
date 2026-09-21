import type { ContextPolicy } from "@napier/contracts/harness-experiments";

/** Explicit experimental guidance; no change to plan transitions or permissions. */
export function planGuidancePolicy(policy?: ContextPolicy["planning"]) {
  if (policy === "proportional-v1")
    return {
      nextAction: [
        "When the next authorized evidence-gathering action is clear, execute it and use its result before drafting the complete implementation or rehearsing future tool-call sequences. For a repair, gather the relevant existing baseline early; preserve required verification and edit ordering.",
      ],
      usage:
        "Use a durable plan when the user requests one or the task needs separate deliverables, dependency coordination, or recovery across long phases. A focused inspect-test-edit-verify repair can proceed without a durable plan; tool count alone does not require one. Continue any existing required plan.",
      create:
        "When a durable plan is needed, create one compact plan with outcome-level steps and concrete verification criteria. Group related reads, edits and checks into a step; do not create a step for every tool call. Include only user-requested artifacts; source maintenance may have none.",
      transition:
        "For a long step, start it to report active work. For a short ready step with completed evidence, complete records that same step's start and completion; a separate start-only call is unnecessary. This does not start dependent steps. Complete, block, skip or reopen using current Run evidence.",
    };
  return {
    nextAction: [],
    usage:
      "Use durable plans for multi-step work, artifact delivery, or tasks where the operator needs progress and recovery evidence.",
    create:
      "Create one focused plan with concrete verification criteria and only user-requested artifacts before doing substantial delivery work. Existing source-maintenance tasks may have no standalone artifacts; do not invent reports or verification scripts to fill the artifact list.",
    transition:
      "Start a step before acting on it, then complete, block, skip, or reopen it with concise evidence from the current run.",
  };
}
