import type { ModelRef } from "@napier/contracts";

export interface CliWorkspaceOptions {
  workspace: string;
  dataRoot?: string;
  jsonl: boolean;
}

export interface CliExecutionOptions extends CliWorkspaceOptions {
  model?: ModelRef;
  timeoutMs: number;
}
