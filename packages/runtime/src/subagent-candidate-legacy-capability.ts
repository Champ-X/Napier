import type { WorktreePreviewSource } from "./subagent-worktree-mutation-model.js";

declare const legacyProofBrand: unique symbol;
export interface LegacyCandidateMigrationProof { readonly [legacyProofBrand]: true }
export interface LegacyCandidateEvidence {
  purpose: "migration" | "settled_result";
  candidateId: string;
  createdAt: string;
  expiresAt: string;
  workspaceRoot: string;
  dataRoot: string;
  source: WorktreePreviewSource;
}
export interface LegacyCandidateMigrationReceipt {
  kind: "napier.subagent-legacy-candidate-migration";
  schemaVersion: 1;
  candidateId: string;
  candidateSourceSha256: string;
  candidateIdentityEvidence: "current_private_capsule";
  sourceConstraint: { kind: "original_full_source_snapshot"; contentSha256: string };
  taskId: string;
  threadId: string;
  parentRunId: string;
  childRunId: string;
  executionId: string;
  taskSha256: string;
  resultKind: "outcome" | "typed_output";
  resultSha256: string;
  outputSchemaSha256?: string;
  completedEventId: string;
  completedEventSha256: string;
  acceptedEventSha256: string;
  terminalEventSha256: string;
  workspaceRootSha256: string;
  dataRootSha256: string;
  candidateCreatedAt: string;
  candidateExpiresAt: string;
  migratedAt: string;
  contentSha256: string;
}
export type LegacyCandidateMigrationAuthority = (
  proof: LegacyCandidateMigrationProof,
) => Promise<LegacyCandidateMigrationReceipt | undefined>;

const proofs = new WeakMap<LegacyCandidateMigrationProof, LegacyCandidateEvidence>();

/** A proof exists only while the candidate and storage inventory locks are held. */
export async function withLegacyCandidateProof<T>(evidence: LegacyCandidateEvidence,
  operation: (proof: LegacyCandidateMigrationProof) => Promise<T>): Promise<T> {
  const proof = Object.freeze({}) as LegacyCandidateMigrationProof;
  proofs.set(proof, structuredClone(evidence));
  try { return await operation(proof); }
  finally { proofs.delete(proof); }
}

export function resolveLegacyCandidateProof(proof: LegacyCandidateMigrationProof): LegacyCandidateEvidence {
  const evidence = proofs.get(proof);
  if (!evidence) throw new Error("Legacy candidate migration requires locked local proof");
  return structuredClone(evidence);
}
