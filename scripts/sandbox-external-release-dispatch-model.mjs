import {
  canonicalJson,
  sha256,
} from "./sandbox-external-publication-model.mjs";
import { SANDBOX_PUBLICATION_ACTIVE_RUN_STATUSES } from "./sandbox-external-release-dispatch-state.mjs";

export const SANDBOX_RELEASE_DISPATCH_PREVIEW_KIND =
  "napier.sandbox-external-release-dispatch-preview";
export const SANDBOX_RELEASE_DISPATCH_RESULT_KIND =
  "napier.sandbox-external-release-dispatch-result";

const REPOSITORY = "Champ-X/Napier";
const WORKFLOW = ".github/workflows/publish-sandbox.yml";
const SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export function validateSandboxExternalReleaseDispatchPreview(value) {
  const errors = [];
  if (
    !record(value) ||
    !exactKeys(value, [
      "kind",
      "schemaVersion",
      "repository",
      "workflow",
      "sourceSha",
      "contextSha256",
      "bootstrap",
      "visibility",
      "activeRunCount",
      "activeRunStateSha256",
      "successfulReleaseCount",
      "successfulReleaseSetSha256",
      "status",
      "blockers",
      "retention",
      "scope",
      "contentSha256",
    ]) ||
    value.kind !== SANDBOX_RELEASE_DISPATCH_PREVIEW_KIND ||
    value.schemaVersion !== 1 ||
    value.repository !== REPOSITORY ||
    value.workflow !== WORKFLOW ||
    !SHA.test(value.sourceSha ?? "") ||
    !SHA256.test(value.contextSha256 ?? "") ||
    !validBootstrap(value.bootstrap) ||
    !validVisibility(value.visibility, value) ||
    !counts(value) ||
    !SHA256.test(value.activeRunStateSha256 ?? "") ||
    !SHA256.test(value.successfulReleaseSetSha256 ?? "") ||
    !validPreviewState(value) ||
    canonicalJson(value.retention) !== canonicalJson(dispatchRetention()) ||
    !SHA256.test(value.contentSha256 ?? "")
  ) {
    errors.push("Sandbox release dispatch preview shape is invalid");
    return errors;
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push("Sandbox release dispatch preview hash is invalid");
  }
  return errors;
}

export function validateSandboxExternalReleaseDispatchResult(value, preview) {
  const errors = [];
  if (
    validateSandboxExternalReleaseDispatchPreview(preview).length > 0 ||
    preview.status !== "ready" ||
    !record(value) ||
    !exactKeys(value, [
      "kind",
      "schemaVersion",
      "repository",
      "workflow",
      "sourceSha",
      "workflowRunId",
      "workflowRunAttempt",
      "runStatus",
      "status",
      "outcomeCode",
      "previewSha256",
      "visibilityEvidenceSha256",
      "retention",
      "scope",
      "contentSha256",
    ]) ||
    value.kind !== SANDBOX_RELEASE_DISPATCH_RESULT_KIND ||
    value.schemaVersion !== 1 ||
    value.repository !== REPOSITORY ||
    value.workflow !== WORKFLOW ||
    value.sourceSha !== preview.sourceSha ||
    !validDispatchOutcome(value) ||
    value.previewSha256 !== preview.contentSha256 ||
    value.visibilityEvidenceSha256 !== preview.visibility.evidenceSha256 ||
    canonicalJson(value.retention) !== canonicalJson(dispatchRetention()) ||
    canonicalJson(value.scope) !==
      canonicalJson({
        anonymousVisibilityVerified: true,
        packageVisibilityChanged: false,
        dispatchRequested: true,
        dispatchOutcomeKnown: value.status === "dispatched",
        externalReleaseAccepted: false,
        s1Complete: false,
      }) ||
    !SHA256.test(value.contentSha256 ?? "")
  ) {
    errors.push("Sandbox release dispatch result shape is invalid");
    return errors;
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push("Sandbox release dispatch result hash is invalid");
  }
  return errors;
}

export function dispatchRetention() {
  return {
    credentialValues: false,
    registryToken: false,
    rawRegistryResponse: false,
    rawApiResponse: false,
    actorIdentity: false,
    workflowLogs: false,
    downloadUrl: false,
    workspacePaths: false,
  };
}

function validBootstrap(value) {
  return (
    record(value) &&
    exactKeys(value, ["workflowRunId", "workflowRunAttempt", "updatedAt"]) &&
    positiveIntegerText(value.workflowRunId) &&
    positiveIntegerText(value.workflowRunAttempt) &&
    isoDate(value.updatedAt)
  );
}

function validVisibility(value, parent) {
  if (
    record(value) &&
    exactKeys(value, [
      "status",
      "blocker",
      "sourceSha",
      "contextSha256",
      "image",
      "tag",
      "digest",
      "tokenHttpStatus",
      "manifestHttpStatus",
      "platforms",
      "anonymousTokenAcquired",
      "indexDigestVerified",
      "sourceLabelsVerified",
      "evidenceSha256",
    ]) &&
    ["ready", "blocked"].includes(value.status) &&
    value.sourceSha === parent.sourceSha &&
    value.contextSha256 === parent.contextSha256 &&
    value.image === "ghcr.io/champ-x/napier-sandbox" &&
    value.tag === `bootstrap-${parent.sourceSha}` &&
    (value.digest === null || /^sha256:[a-f0-9]{64}$/u.test(value.digest)) &&
    Number.isSafeInteger(value.tokenHttpStatus) &&
    (value.manifestHttpStatus === null ||
      Number.isSafeInteger(value.manifestHttpStatus)) &&
    Array.isArray(value.platforms) &&
    SHA256.test(value.evidenceSha256 ?? "")
  ) {
    const { evidenceSha256, ...content } = value;
    if (evidenceSha256 !== sha256(canonicalJson(content))) return false;
    if (value.status === "ready") {
      return (
        value.blocker === null &&
        value.digest !== null &&
        value.tokenHttpStatus === 200 &&
        value.manifestHttpStatus === 200 &&
        validPlatforms(value.platforms) &&
        value.anonymousTokenAcquired === true &&
        value.indexDigestVerified === true &&
        value.sourceLabelsVerified === true
      );
    }
    return (
      value.digest === null &&
      value.platforms.length === 0 &&
      value.indexDigestVerified === false &&
      value.sourceLabelsVerified === false &&
      ((value.blocker === "ghcr_anonymous_token_unavailable" &&
        value.anonymousTokenAcquired === false &&
        [401, 403].includes(value.tokenHttpStatus) &&
        value.manifestHttpStatus === null) ||
        (value.blocker === "ghcr_bootstrap_tag_unavailable" &&
          value.anonymousTokenAcquired === true &&
          value.tokenHttpStatus === 200 &&
          [401, 403, 404].includes(value.manifestHttpStatus)))
    );
  }
  return false;
}

function validPlatforms(value) {
  return (
    value.length === 2 &&
    value
      .map((platform) => platform.platform)
      .sort()
      .join("\n") === "linux/amd64\nlinux/arm64" &&
    value.every(
      (platform) =>
        record(platform) &&
        exactKeys(platform, [
          "platform",
          "manifestDigest",
          "configDigest",
          "layerCount",
          "layerSetSha256",
        ]) &&
        /^sha256:[a-f0-9]{64}$/u.test(platform.manifestDigest ?? "") &&
        /^sha256:[a-f0-9]{64}$/u.test(platform.configDigest ?? "") &&
        Number.isSafeInteger(platform.layerCount) &&
        platform.layerCount > 0 &&
        SHA256.test(platform.layerSetSha256 ?? ""),
    )
  );
}

function counts(value) {
  return (
    Number.isSafeInteger(value.activeRunCount) &&
    value.activeRunCount >= 0 &&
    Number.isSafeInteger(value.successfulReleaseCount) &&
    value.successfulReleaseCount >= 0
  );
}

function validPreviewState(value) {
  const expectedBlockers = [];
  if (value.visibility.status !== "ready") {
    expectedBlockers.push(value.visibility.blocker);
  }
  if (value.activeRunCount > 0) {
    expectedBlockers.push("sandbox_publication_run_active");
  }
  if (value.successfulReleaseCount > 0) {
    expectedBlockers.push("sandbox_release_already_succeeded");
  }
  const ready = expectedBlockers.length === 0;
  return (
    canonicalJson(value.blockers) === canonicalJson(expectedBlockers) &&
    value.status === (ready ? "ready" : "blocked") &&
    canonicalJson(value.scope) ===
      canonicalJson({
        currentMainVerified: true,
        bootstrapRunVerified: true,
        anonymousVisibilityOnly: true,
        packageVisibilityChanged: false,
        dispatchAllowed: ready,
        externalReleaseAccepted: false,
        s1Complete: false,
      })
  );
}

function validDispatchOutcome(value) {
  const codes = [
    "dispatch_command_failed",
    "run_url_missing",
    "run_lookup_failed",
    "run_identity_invalid",
    "run_identity_verified",
  ];
  if (!codes.includes(value.outcomeCode)) return false;
  if (value.status === "dispatched") {
    return (
      value.outcomeCode === "run_identity_verified" &&
      positiveIntegerText(value.workflowRunId) &&
      positiveIntegerText(value.workflowRunAttempt) &&
      [...SANDBOX_PUBLICATION_ACTIVE_RUN_STATUSES, "completed"].includes(
        value.runStatus,
      )
    );
  }
  if (value.status !== "indeterminate") return false;
  if (value.workflowRunAttempt !== null || value.runStatus !== null)
    return false;
  if (
    ["run_lookup_failed", "run_identity_invalid"].includes(value.outcomeCode)
  ) {
    return positiveIntegerText(value.workflowRunId);
  }
  return value.workflowRunId === null;
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
    record(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort())
  );
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
