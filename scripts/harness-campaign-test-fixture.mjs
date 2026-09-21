import { createHash } from "node:crypto";
import { dependencyGraphReceipt } from "./harness-runtime-dependencies.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
export const observation = (arm, patch = {}) => {
  const runId =
    patch.runId ??
    `run_${arm}_${patch.caseId ?? "case_one"}_${patch.trial ?? 0}`;
  const environment = {
    kind: "napier.harness-environment-evidence",
    schemaVersion: 1,
    runId,
    sandboxId: "test",
    configurationSha256: hash("configuration"),
    valid: true,
    eligible: true,
    executionMode: "standard",
    missingTools: [],
    receipts: [],
    blockers: [],
  };
  return {
    arm,
    caseId: "case_one",
    trial: 0,
    runId,
    qualifyingEvidence: true,
    runtimeArtifactStable: true,
    sourceStable: true,
    servingIdentityMatched: true,
    runtimeArtifactSha256: hash(arm),
    runtimeDependencyEvidence: dependencyGraphReceipt(
      {
        contentSha256: hash(arm + "dependencies"),
        eligible: true,
        packages: [{}],
        fileCount: 1,
      },
      undefined,
      runId,
    ),
    sourceIdentity: { nodeVersion: process.version },
    taskSuccess: true,
    allowedChanges: true,
    status: "completed",
    toolFailures: 0,
    fixtureSha256: hash("fixture"),
    promptSha256: hash("prompt"),
    outcomeSha256: hash("outcome"),
    requestedModel: { provider: "test", id: "test" },
    sandbox: "test",
    profile: null,
    environmentEvidence: {
      ...environment,
      contentSha256: hash(JSON.stringify(environment)),
    },
    ...patch,
  };
};
