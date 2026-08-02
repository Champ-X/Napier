import {
  gitInspectEventEvidence,
  gitInspectSummaryParts,
  type GitInspectToolEventTraceView,
} from "./git-inspect-event-view";
import {
  gitCommitEventEvidence,
  gitCommitSummaryParts,
  type GitCommitToolEventTraceView,
} from "./git-commit-event-view";
import {
  gitStageEventEvidence,
  gitStageSummaryParts,
  type GitStageToolEventTraceView,
} from "./git-stage-event-view";

export interface GitToolEventTraceView
  extends
    GitInspectToolEventTraceView,
    GitStageToolEventTraceView,
    GitCommitToolEventTraceView {}

export function gitToolEventEvidence(
  toolName: string,
  details: unknown,
): GitToolEventTraceView | undefined {
  if (toolName === "git_inspect") return gitInspectEventEvidence(details);
  if (toolName === "git_stage_preview" || toolName === "git_stage_apply") {
    return gitStageEventEvidence(details);
  }
  if (toolName === "git_commit_preview" || toolName === "git_commit_apply") {
    return gitCommitEventEvidence(details);
  }
  return undefined;
}

export function gitToolSummaryParts(view: GitToolEventTraceView): string[] {
  return [
    ...gitInspectSummaryParts(view),
    ...gitStageSummaryParts(view),
    ...gitCommitSummaryParts(view),
  ];
}
