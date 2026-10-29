import type { SubagentWorktreeApplyResult } from "./subagent-worktree-mutation-model.js";
import type { WorktreePreviewSource } from "./subagent-worktree-mutation-model.js";

export interface CandidateEnvelope {
  schemaVersion: 1 | 2;
  nonce?: string;
  workspaceRoot: string;
  dataRoot: string;
  createdAt: string;
  expiresAt: string;
  source: WorktreePreviewSource;
}

export interface CandidateState {
  candidateId: string;
  status: "applying" | "settled" | "revoked";
  updatedAt: string;
  result?: SubagentWorktreeApplyResult;
  merge?: Array<{ path: string; beforeSha256: string | null; afterSha256: string | null }>;
}
