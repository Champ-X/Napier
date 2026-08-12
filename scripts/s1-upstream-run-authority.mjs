import {
  EXTERNAL_PUBLICATION_WORKFLOW,
  canonicalJson,
  isRecord,
  sha256,
} from "./sandbox-external-publication-model.mjs";
import { WINDOWS_ACCEPTANCE_WORKFLOW } from "./windows-host-product-acceptance-artifact.mjs";

export const S1_RUN_AUTHORITY_KIND = "napier.s1-upstream-run-authority";
export const S1_RUN_AUTHORITY_CONFIG = {
  external_publication: {
    workflow: EXTERNAL_PUBLICATION_WORKFLOW,
    artifactName: (sourceSha) => `sandbox-external-publication-${sourceSha}`,
  },
  windows_host_product_acceptance: {
    workflow: WINDOWS_ACCEPTANCE_WORKFLOW,
    artifactName: (sourceSha) =>
      `napier-windows-host-product-acceptance-${sourceSha}`,
  },
};

const REPOSITORY = "Champ-X/Napier";
const SOURCE_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export function createS1UpstreamRunAuthority(input) {
  const sourceSha = String(input.sourceSha ?? "");
  const expectedRunId = String(input.expectedRunId ?? "");
  const config = S1_RUN_AUTHORITY_CONFIG[input.authority];
  if (
    !config ||
    !SOURCE_SHA.test(sourceSha) ||
    !positiveIntegerText(expectedRunId)
  ) {
    throw new Error("S1 upstream run authority input is invalid");
  }
  const run = input.run;
  const artifacts = input.artifacts;
  const runId = positiveInteger(run?.id);
  const runAttempt = positiveInteger(run?.run_attempt);
  const repositoryId = positiveInteger(run?.repository?.id);
  const headRepositoryId = positiveInteger(run?.head_repository?.id);
  if (
    !isRecord(run) ||
    runId !== expectedRunId ||
    !runAttempt ||
    run.event !== "workflow_dispatch" ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    run.head_branch !== "main" ||
    run.head_sha !== sourceSha ||
    run.path !== config.workflow ||
    run.repository?.full_name !== REPOSITORY ||
    run.head_repository?.full_name !== REPOSITORY ||
    !isoDate(run.updated_at) ||
    !repositoryId ||
    headRepositoryId !== repositoryId
  ) {
    throw new Error("S1 upstream workflow run authority is invalid");
  }
  if (
    !isRecord(artifacts) ||
    !Number.isSafeInteger(artifacts.total_count) ||
    artifacts.total_count < 1 ||
    artifacts.total_count > 100 ||
    !Array.isArray(artifacts.artifacts) ||
    artifacts.artifacts.length !== artifacts.total_count
  ) {
    throw new Error("S1 upstream artifact list authority is invalid");
  }
  const expectedName = config.artifactName(sourceSha);
  const matches = artifacts.artifacts.filter(
    (artifact) => artifact?.name === expectedName,
  );
  const artifact = matches.length === 1 ? matches[0] : undefined;
  const artifactId = positiveInteger(artifact?.id);
  const artifactRunId = positiveInteger(artifact?.workflow_run?.id);
  const artifactRepositoryId = positiveInteger(
    artifact?.workflow_run?.repository_id,
  );
  const artifactHeadRepositoryId = positiveInteger(
    artifact?.workflow_run?.head_repository_id,
  );
  if (
    !isRecord(artifact) ||
    !artifactId ||
    artifact.expired !== false ||
    !Number.isSafeInteger(artifact.size_in_bytes) ||
    artifact.size_in_bytes < 1 ||
    artifactRunId !== runId ||
    artifact.workflow_run?.head_branch !== "main" ||
    artifact.workflow_run?.head_sha !== sourceSha ||
    artifactRepositoryId !== repositoryId ||
    artifactHeadRepositoryId !== headRepositoryId
  ) {
    throw new Error("S1 upstream artifact authority is invalid");
  }
  const content = {
    kind: S1_RUN_AUTHORITY_KIND,
    schemaVersion: 1,
    generatedAt: input.generatedAt ?? new Date(run.updated_at).toISOString(),
    repository: REPOSITORY,
    repositoryId,
    authority: input.authority,
    sourceSha,
    workflow: config.workflow,
    workflowRunId: runId,
    workflowRunAttempt: runAttempt,
    event: "workflow_dispatch",
    headBranch: "main",
    status: "completed",
    conclusion: "success",
    artifact: {
      id: artifactId,
      name: expectedName,
      expired: false,
      sizeBytes: artifact.size_in_bytes,
      workflowRunId: artifactRunId,
      headBranch: "main",
      headSha: sourceSha,
      repositoryId: artifactRepositoryId,
      headRepositoryId: artifactHeadRepositoryId,
    },
    retention: retention(),
    scope: {
      necessarySourceAuthority: true,
      semanticReceiptVerified: false,
      s1Complete: false,
    },
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export function validateS1UpstreamRunAuthority(value, expected = {}) {
  const errors = [];
  const config = S1_RUN_AUTHORITY_CONFIG[value?.authority];
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "kind",
      "schemaVersion",
      "generatedAt",
      "repository",
      "repositoryId",
      "authority",
      "sourceSha",
      "workflow",
      "workflowRunId",
      "workflowRunAttempt",
      "event",
      "headBranch",
      "status",
      "conclusion",
      "artifact",
      "retention",
      "scope",
      "contentSha256",
    ]) ||
    value.kind !== S1_RUN_AUTHORITY_KIND ||
    value.schemaVersion !== 1 ||
    !isoDate(value.generatedAt) ||
    value.repository !== REPOSITORY ||
    !positiveIntegerText(value.repositoryId) ||
    !config ||
    !SOURCE_SHA.test(value.sourceSha ?? "") ||
    value.workflow !== config?.workflow ||
    !positiveIntegerText(value.workflowRunId) ||
    !positiveIntegerText(value.workflowRunAttempt) ||
    value.event !== "workflow_dispatch" ||
    value.headBranch !== "main" ||
    value.status !== "completed" ||
    value.conclusion !== "success" ||
    !validArtifact(value.artifact, value, config) ||
    canonicalJson(value.retention) !== canonicalJson(retention()) ||
    canonicalJson(value.scope) !==
      canonicalJson({
        necessarySourceAuthority: true,
        semanticReceiptVerified: false,
        s1Complete: false,
      }) ||
    !SHA256.test(value.contentSha256 ?? "")
  ) {
    errors.push("S1 upstream run authority shape is invalid");
    return errors;
  }
  for (const field of ["authority", "sourceSha", "workflowRunId"]) {
    if (
      Object.hasOwn(expected, field) &&
      value[field] !== String(expected[field])
    ) {
      errors.push(`S1 upstream run authority ${field} does not match`);
    }
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push("S1 upstream run authority content hash is invalid");
  }
  return errors;
}

function validArtifact(value, authority, config) {
  return (
    isRecord(value) &&
    exactKeys(value, [
      "id",
      "name",
      "expired",
      "sizeBytes",
      "workflowRunId",
      "headBranch",
      "headSha",
      "repositoryId",
      "headRepositoryId",
    ]) &&
    positiveIntegerText(value.id) &&
    value.name === config.artifactName(authority.sourceSha) &&
    value.expired === false &&
    Number.isSafeInteger(value.sizeBytes) &&
    value.sizeBytes > 0 &&
    value.workflowRunId === authority.workflowRunId &&
    value.headBranch === "main" &&
    value.headSha === authority.sourceSha &&
    value.repositoryId === authority.repositoryId &&
    value.headRepositoryId === authority.repositoryId
  );
}

function retention() {
  return {
    credentialValues: false,
    rawRunResponse: false,
    rawArtifactList: false,
    downloadUrl: false,
    actorIdentity: false,
    workflowLogs: false,
  };
}

function positiveInteger(value) {
  const text = String(value ?? "");
  return positiveIntegerText(text) ? text : undefined;
}

function positiveIntegerText(value) {
  return typeof value === "string" && /^[1-9][0-9]*$/u.test(value);
}

function isoDate(value) {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function exactKeys(value, keys) {
  return (
    isRecord(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort())
  );
}
