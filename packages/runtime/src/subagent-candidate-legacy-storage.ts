import { readdir } from "node:fs/promises";
import { assertLegacyCandidateContent, assertLegacyCandidateState } from "./subagent-candidate-legacy-validation.js";
import { withLegacyCandidateProof, type LegacyCandidateMigrationAuthority } from "./subagent-candidate-legacy-capability.js";
import type { CandidateEnvelope, CandidateState } from "./subagent-candidate-state.js";
import { assertLegacySourceSnapshot } from "./subagent-legacy-source-snapshot.js";

/** Called with the inventory and selected candidate locks held through authority settlement. */
export async function reconcileLegacyCandidateStorage(input: {
  id: string; envelope: CandidateEnvelope; state: CandidateState | undefined; root: string;
  now: Date; ttlMs: number; authority: LegacyCandidateMigrationAuthority | undefined;
  read(id: string): Promise<CandidateEnvelope>; reuseSettled: boolean;
}) {
  const { envelope, state, authority } = input;
  if (!authority) throw new Error("Subagent candidate has no durable completion binding; retained for inspection");
  if (envelope.schemaVersion !== 1 || envelope.source.completion)
    throw new Error("Legacy candidate migration requires an original v1 capsule");
  assertLegacyCandidateContent(envelope.source);
  assertLegacyCandidateState(envelope.source, state);
  const expired = Date.parse(envelope.expiresAt) <= input.now.getTime();
  const readOnly = input.reuseSettled && state?.result?.details.status === "applied" && expired;
  if ((expired && !readOnly) || Date.parse(envelope.expiresAt) !== Date.parse(envelope.createdAt) + input.ttlMs)
    throw new Error("Legacy candidate expired or its original expiry changed; retained for inspection");
  const entries = (await readdir(input.root)).filter((name) => /^[a-f0-9]{64}\.json$/u.test(name));
  let matching = 0;
  for (const name of entries) {
    const candidate = await input.read(`subworkpreview_${name.slice(0, -5)}`);
    if (candidate.source.taskId === envelope.source.taskId) matching += 1;
  }
  if (matching !== 1) throw new Error("Legacy candidate identity is ambiguous; retained for inspection");
  if (state?.result?.details.status !== "applied") await assertLegacySourceSnapshot(envelope.source);
  const receipt = await withLegacyCandidateProof({ purpose: readOnly ? "settled_result" : "migration",
    candidateId: input.id, createdAt: envelope.createdAt, expiresAt: envelope.expiresAt,
    workspaceRoot: envelope.workspaceRoot, dataRoot: envelope.dataRoot, source: envelope.source }, authority);
  if (!receipt && !readOnly) throw new Error("Legacy candidate migration authority was not committed");
  return receipt;
}
