import {
  EXTERNAL_PUBLICATION_WORKFLOW,
  canonicalJson,
  isRecord,
  sha256,
} from "./sandbox-external-publication-model.mjs";
import { WINDOWS_ACCEPTANCE_WORKFLOW } from "./windows-host-product-acceptance-artifact.mjs";

export const S1_READINESS_KIND = "napier.s1-shell-sandbox-readiness-stage22";
export const S1_COMPLETION_KIND = "napier.s1-shell-sandbox-completion-stage22";
export const S1_COMPLETION_WORKFLOW =
  ".github/workflows/s1-shell-sandbox-completion.yml";
export const S1_REQUIREMENT_GROUPS = [
  {
    id: "official_toolchain_supply_chain",
    evidenceKinds: [
      "sandbox-image-sbom",
      "sandbox-image-provenance",
      "sandbox-multi-architecture-stage14",
      "sandbox-oci-supply-chain-stage18",
    ],
  },
  {
    id: "setup_doctor_lifecycle",
    evidenceKinds: [
      "sandbox-product-acceptance-stage13",
      "sandbox-acquisition-stage20",
      "linux-host-product-acceptance-stage19",
    ],
  },
  {
    id: "daemon_execution_recovery",
    evidenceKinds: [
      "sandbox-product-acceptance-stage13",
      "oci-crash-recovery-stage11",
      "sandbox-portable-process-stage15",
      "sandbox-portable-lsp-stage16",
      "sandbox-portable-dap-stage17",
      "linux-host-product-acceptance-stage19",
    ],
  },
  {
    id: "isolation_and_fail_closed_limits",
    evidenceKinds: [
      "sandbox-image-provenance",
      "oci-resource-limits-stage10",
      "sandbox-security-casebook-stage12",
      "sandbox-product-acceptance-stage13",
      "oci-crash-recovery-stage11",
    ],
  },
  {
    id: "run_scoped_mode_and_profile_upgrade",
    evidenceKinds: ["profile-upgrade-stage21"],
  },
];
export const S1_EXTERNAL_BLOCKERS = [
  "public_signed_external_release",
  "windows_host_product_acceptance",
];

const SOURCE_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

export function createS1ShellSandboxReadinessArtifact(input) {
  const requirements = input.requirements.map((group) => ({
    ...group,
    evidenceSetSha256: sha256(canonicalJson(group.evidence)),
  }));
  const content = {
    kind: S1_READINESS_KIND,
    schemaVersion: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    implementation: input.implementation,
    requirements,
    requirementSetSha256: sha256(canonicalJson(requirements)),
    externalRequirements: externalRequirements(),
    status: "blocked",
    blockers: S1_EXTERNAL_BLOCKERS,
    retention: readinessRetention(),
    scope: {
      localRequirementsReady: true,
      externalPublicationAccepted: false,
      windowsHostProductAcceptance: false,
      s1Complete: false,
      remaining: S1_EXTERNAL_BLOCKERS,
    },
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export function validateS1ShellSandboxReadinessArtifact(value, expected = {}) {
  const errors = [];
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "kind",
      "schemaVersion",
      "generatedAt",
      "implementation",
      "requirements",
      "requirementSetSha256",
      "externalRequirements",
      "status",
      "blockers",
      "retention",
      "scope",
      "contentSha256",
    ]) ||
    value.kind !== S1_READINESS_KIND ||
    value.schemaVersion !== 1 ||
    !isoDate(value.generatedAt) ||
    !validHashRecord(value.implementation) ||
    !validRequirements(value.requirements) ||
    value.requirementSetSha256 !== sha256(canonicalJson(value.requirements)) ||
    canonicalJson(value.externalRequirements) !==
      canonicalJson(externalRequirements()) ||
    value.status !== "blocked" ||
    canonicalJson(value.blockers) !== canonicalJson(S1_EXTERNAL_BLOCKERS) ||
    canonicalJson(value.retention) !== canonicalJson(readinessRetention()) ||
    canonicalJson(value.scope) !==
      canonicalJson({
        localRequirementsReady: true,
        externalPublicationAccepted: false,
        windowsHostProductAcceptance: false,
        s1Complete: false,
        remaining: S1_EXTERNAL_BLOCKERS,
      }) ||
    !SHA256.test(value.contentSha256 ?? "")
  ) {
    errors.push("S1 Shell/Sandbox readiness artifact shape is invalid");
    return errors;
  }
  if (
    expected.implementation &&
    canonicalJson(value.implementation) !==
      canonicalJson(expected.implementation)
  ) {
    errors.push("S1 Shell/Sandbox readiness implementation is stale");
  }
  if (
    expected.requirements &&
    canonicalJson(value.requirements) !==
      canonicalJson(
        expected.requirements.map((group) => ({
          ...group,
          evidenceSetSha256: sha256(canonicalJson(group.evidence)),
        })),
      )
  ) {
    errors.push("S1 Shell/Sandbox readiness evidence is stale");
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push("S1 Shell/Sandbox readiness content hash is invalid");
  }
  return errors;
}

export function createS1ShellSandboxCompletionArtifact(input) {
  const blockers = [];
  if (!input.externalPublication) {
    blockers.push("public_signed_external_release");
  }
  if (!input.windowsHost) {
    blockers.push("windows_host_product_acceptance");
  }
  const complete = blockers.length === 0;
  const content = {
    kind: S1_COMPLETION_KIND,
    schemaVersion: 2,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    repository: "Champ-X/Napier",
    workflow: S1_COMPLETION_WORKFLOW,
    workflowRunId: input.workflowRunId ?? null,
    workflowRunAttempt: input.workflowRunAttempt ?? null,
    sourceSha: input.sourceSha,
    readiness: input.readiness,
    requirements: input.requirements,
    requirementSetSha256: sha256(canonicalJson(input.requirements)),
    externalPublication: input.externalPublication ?? null,
    windowsHost: input.windowsHost ?? null,
    status: complete ? "complete" : "blocked",
    blockers,
    retention: completionRetention(),
    scope: {
      localRequirementsReady: true,
      externalPublicationAccepted: Boolean(input.externalPublication),
      windowsHostProductAcceptance: Boolean(input.windowsHost),
      s1Complete: complete,
      nextStage: complete ? "S2" : null,
    },
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export function validateS1ShellSandboxCompletionArtifact(value, expected = {}) {
  const errors = [];
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "kind",
      "schemaVersion",
      "generatedAt",
      "repository",
      "workflow",
      "workflowRunId",
      "workflowRunAttempt",
      "sourceSha",
      "readiness",
      "requirements",
      "requirementSetSha256",
      "externalPublication",
      "windowsHost",
      "status",
      "blockers",
      "retention",
      "scope",
      "contentSha256",
    ]) ||
    value.kind !== S1_COMPLETION_KIND ||
    value.schemaVersion !== 2 ||
    !isoDate(value.generatedAt) ||
    value.repository !== "Champ-X/Napier" ||
    value.workflow !== S1_COMPLETION_WORKFLOW ||
    !validWorkflowIdentity(
      value.workflowRunId,
      value.workflowRunAttempt,
      value.status,
    ) ||
    !SOURCE_SHA.test(value.sourceSha ?? "") ||
    !validReadinessReference(value.readiness) ||
    !validRequirements(value.requirements) ||
    value.requirementSetSha256 !== sha256(canonicalJson(value.requirements)) ||
    value.readiness.requirementSetSha256 !== value.requirementSetSha256 ||
    !validExternalPublication(value.externalPublication, value.sourceSha) ||
    !validWindowsHost(value.windowsHost, value.sourceSha) ||
    !validCompletionState(value) ||
    canonicalJson(value.retention) !== canonicalJson(completionRetention()) ||
    !SHA256.test(value.contentSha256 ?? "")
  ) {
    errors.push("S1 Shell/Sandbox completion artifact shape is invalid");
    return errors;
  }
  for (const field of [
    "workflowRunId",
    "workflowRunAttempt",
    "sourceSha",
    "readiness",
    "requirements",
    "externalPublication",
    "windowsHost",
  ]) {
    if (
      Object.hasOwn(expected, field) &&
      canonicalJson(value[field]) !== canonicalJson(expected[field])
    ) {
      errors.push(`S1 Shell/Sandbox completion ${field} does not match`);
    }
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push("S1 Shell/Sandbox completion content hash is invalid");
  }
  return errors;
}

function validRequirements(value) {
  return (
    Array.isArray(value) &&
    value.length === S1_REQUIREMENT_GROUPS.length &&
    value.every((group, index) => {
      const expected = S1_REQUIREMENT_GROUPS[index];
      return (
        isRecord(group) &&
        exactKeys(group, ["id", "status", "evidence", "evidenceSetSha256"]) &&
        group.id === expected.id &&
        group.status === "verified" &&
        Array.isArray(group.evidence) &&
        group.evidence.length === expected.evidenceKinds.length &&
        group.evidence.every(
          (item, evidenceIndex) =>
            isRecord(item) &&
            exactKeys(item, ["kind", "path", "sha256", "verifierSha256"]) &&
            item.kind === expected.evidenceKinds[evidenceIndex] &&
            safeRelativePath(item.path) &&
            SHA256.test(item.sha256 ?? "") &&
            SHA256.test(item.verifierSha256 ?? ""),
        ) &&
        group.evidenceSetSha256 === sha256(canonicalJson(group.evidence))
      );
    })
  );
}

function validReadinessReference(value) {
  return (
    isRecord(value) &&
    exactKeys(value, [
      "path",
      "sha256",
      "contentSha256",
      "requirementSetSha256",
    ]) &&
    safeRelativePath(value.path) &&
    SHA256.test(value.sha256 ?? "") &&
    SHA256.test(value.contentSha256 ?? "") &&
    SHA256.test(value.requirementSetSha256 ?? "")
  );
}

function validExternalPublication(value, sourceSha) {
  return (
    value === null ||
    (isRecord(value) &&
      exactKeys(value, [
        "workflow",
        "workflowRunId",
        "workflowRunAttempt",
        "sourceSha",
        "runAuthorityFileSha256",
        "runAuthoritySha256",
        "receiptSha256",
        "contentSha256",
        "digest",
        "contextSha256",
      ]) &&
      value.workflow === EXTERNAL_PUBLICATION_WORKFLOW &&
      positiveIntegerText(value.workflowRunId) &&
      positiveIntegerText(value.workflowRunAttempt) &&
      value.sourceSha === sourceSha &&
      SHA256.test(value.runAuthorityFileSha256 ?? "") &&
      SHA256.test(value.runAuthoritySha256 ?? "") &&
      SHA256.test(value.receiptSha256 ?? "") &&
      SHA256.test(value.contentSha256 ?? "") &&
      DIGEST.test(value.digest ?? "") &&
      SHA256.test(value.contextSha256 ?? ""))
  );
}

function validWindowsHost(value, sourceSha) {
  return (
    value === null ||
    (isRecord(value) &&
      exactKeys(value, [
        "workflow",
        "workflowRunId",
        "workflowRunAttempt",
        "sourceSha",
        "runAuthorityFileSha256",
        "runAuthoritySha256",
        "receiptSha256",
        "contentSha256",
        "hostIdentitySha256",
        "productContentSha256",
      ]) &&
      value.workflow === WINDOWS_ACCEPTANCE_WORKFLOW &&
      positiveIntegerText(value.workflowRunId) &&
      positiveIntegerText(value.workflowRunAttempt) &&
      value.sourceSha === sourceSha &&
      [
        value.runAuthorityFileSha256,
        value.runAuthoritySha256,
        value.receiptSha256,
        value.contentSha256,
        value.hostIdentitySha256,
        value.productContentSha256,
      ].every((item) => SHA256.test(item ?? "")))
  );
}

function validCompletionState(value) {
  const expectedBlockers = [];
  if (value.externalPublication === null) {
    expectedBlockers.push("public_signed_external_release");
  }
  if (value.windowsHost === null) {
    expectedBlockers.push("windows_host_product_acceptance");
  }
  const complete = expectedBlockers.length === 0;
  return (
    value.status === (complete ? "complete" : "blocked") &&
    canonicalJson(value.blockers) === canonicalJson(expectedBlockers) &&
    canonicalJson(value.scope) ===
      canonicalJson({
        localRequirementsReady: true,
        externalPublicationAccepted: value.externalPublication !== null,
        windowsHostProductAcceptance: value.windowsHost !== null,
        s1Complete: complete,
        nextStage: complete ? "S2" : null,
      })
  );
}

function validWorkflowIdentity(runId, attempt, status) {
  if (status === "blocked" && runId === null && attempt === null) return true;
  return positiveIntegerText(runId) && positiveIntegerText(attempt);
}

function externalRequirements() {
  return [
    {
      id: "public_signed_external_release",
      workflow: EXTERNAL_PUBLICATION_WORKFLOW,
      artifactName: "sandbox-external-publication-${sourceSha}",
      verifier: "verifySandboxExternalPublicationEvidence",
      status: "missing",
    },
    {
      id: "windows_host_product_acceptance",
      workflow: WINDOWS_ACCEPTANCE_WORKFLOW,
      artifactName: "napier-windows-host-product-acceptance-${sourceSha}",
      verifier: "verifyWindowsHostProductAcceptance",
      status: "missing",
    },
  ];
}

function readinessRetention() {
  return {
    credentialValues: false,
    rawCommandOutput: false,
    rawDockerOutput: false,
    rawWorkflowLog: false,
    workspacePaths: false,
    receiptBodies: false,
  };
}

function completionRetention() {
  return {
    credentialValues: false,
    rawCommandOutput: false,
    rawDockerOutput: false,
    rawWorkflowLog: false,
    workspacePaths: false,
    upstreamReceiptBodies: false,
    imageBytes: false,
  };
}

function validHashRecord(value) {
  return (
    isRecord(value) &&
    Object.keys(value).length >= 4 &&
    Object.values(value).every((item) => SHA256.test(item))
  );
}

function safeRelativePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 200 &&
    !value.startsWith("/") &&
    !value.startsWith("\\") &&
    !value.split(/[\\/]/u).includes("..")
  );
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
