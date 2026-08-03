import type { JsonValue } from "@napier/contracts";

import {
  commandToolCallArgumentsLedgerProjection,
  commandToolInputLedgerProjection,
  commandToolOutputLedgerProjection,
} from "./command-tool.js";
import {
  gitBranchToolCallArgumentsLedgerProjection,
  gitBranchToolInputLedgerProjection,
  gitBranchToolOutputLedgerProjection,
} from "./git-branch-tool.js";
import {
  gitBranchSwitchToolCallArgumentsLedgerProjection,
  gitBranchSwitchToolInputLedgerProjection,
  gitBranchSwitchToolOutputLedgerProjection,
} from "./git-branch-switch-tool.js";
import {
  gitInspectToolCallArgumentsLedgerProjection,
  gitInspectToolInputLedgerProjection,
  gitInspectToolOutputLedgerProjection,
} from "./git-inspect-tool.js";
import {
  gitCommitToolCallArgumentsLedgerProjection,
  gitCommitToolInputLedgerProjection,
  gitCommitToolOutputLedgerProjection,
} from "./git-commit-tool.js";
import {
  gitStageToolCallArgumentsLedgerProjection,
  gitStageToolInputLedgerProjection,
  gitStageToolOutputLedgerProjection,
} from "./git-stage-tool.js";

export function agentProcessToolCallProjection(
  toolName: string,
  args: unknown,
): JsonValue | undefined {
  if (toolName === "run_command") {
    return commandToolCallArgumentsLedgerProjection(args);
  }
  if (
    toolName === "git_branch_create_preview" ||
    toolName === "git_branch_create_apply"
  ) {
    return gitBranchToolCallArgumentsLedgerProjection(toolName, args);
  }
  if (
    toolName === "git_branch_switch_preview" ||
    toolName === "git_branch_switch_apply"
  ) {
    return gitBranchSwitchToolCallArgumentsLedgerProjection(toolName, args);
  }
  if (toolName === "git_commit_preview" || toolName === "git_commit_apply") {
    return gitCommitToolCallArgumentsLedgerProjection(toolName, args);
  }
  if (toolName === "git_stage_preview" || toolName === "git_stage_apply") {
    return gitStageToolCallArgumentsLedgerProjection(toolName, args);
  }
  return toolName === "git_inspect"
    ? gitInspectToolCallArgumentsLedgerProjection(args)
    : undefined;
}

export function agentProcessToolInputProjection(
  toolName: string,
  args: unknown,
): Record<string, JsonValue> | undefined {
  if (toolName === "run_command") {
    return commandToolInputLedgerProjection(args);
  }
  if (
    toolName === "git_branch_create_preview" ||
    toolName === "git_branch_create_apply"
  ) {
    return gitBranchToolInputLedgerProjection(toolName, args);
  }
  if (
    toolName === "git_branch_switch_preview" ||
    toolName === "git_branch_switch_apply"
  ) {
    return gitBranchSwitchToolInputLedgerProjection(toolName, args);
  }
  if (toolName === "git_commit_preview" || toolName === "git_commit_apply") {
    return gitCommitToolInputLedgerProjection(toolName, args);
  }
  if (toolName === "git_stage_preview" || toolName === "git_stage_apply") {
    return gitStageToolInputLedgerProjection(toolName, args);
  }
  return toolName === "git_inspect"
    ? gitInspectToolInputLedgerProjection(args)
    : undefined;
}

export function agentProcessToolOutputProjection(
  toolName: string,
  output: string,
  result: unknown,
): Record<string, JsonValue> | undefined {
  if (toolName === "run_command") {
    return commandToolOutputLedgerProjection(output, result);
  }
  if (
    toolName === "git_branch_create_preview" ||
    toolName === "git_branch_create_apply"
  ) {
    return gitBranchToolOutputLedgerProjection(output, result);
  }
  if (
    toolName === "git_branch_switch_preview" ||
    toolName === "git_branch_switch_apply"
  ) {
    return gitBranchSwitchToolOutputLedgerProjection(output, result);
  }
  if (toolName === "git_commit_preview" || toolName === "git_commit_apply") {
    return gitCommitToolOutputLedgerProjection(output, result);
  }
  if (toolName === "git_stage_preview" || toolName === "git_stage_apply") {
    return gitStageToolOutputLedgerProjection(output, result);
  }
  return toolName === "git_inspect"
    ? gitInspectToolOutputLedgerProjection(output, result)
    : undefined;
}
