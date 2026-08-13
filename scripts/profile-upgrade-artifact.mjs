import { readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const ENTRY = new Set(["built_cli", "production_web"]);

export async function profileUpgradeImplementation(repoRoot) {
  const files = {
    contract: "packages/contracts/src/agent-capability-contract.ts",
    upgradeModel: "packages/runtime/src/agent-capability-upgrade.ts",
    bindings: "packages/runtime/src/agent-capability-bindings.ts",
    service: "packages/runtime/src/agent-capability-service.ts",
    storeMutation: "packages/runtime/src/agent-capability-store-mutations.ts",
    store: "packages/runtime/src/store.ts",
    cli: "apps/cli/src/capability-cli.ts",
    cliOptions: "apps/cli/src/cli-capability-options.ts",
    http: "apps/server/src/agent-capability-http.ts",
    webApi: "apps/web/src/agent-capability-api.ts",
    webCard: "apps/web/src/AgentCapabilityContractCard.tsx",
    harness: "scripts/profile-upgrade-acceptance.mjs",
    verifier: "scripts/profile-upgrade-artifact.mjs",
    check: "scripts/check-profile-upgrade.mjs",
  };
  return Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([name, relative]) => [
        `${name}Sha256`,
        sha256(await readFile(path.join(repoRoot, relative))),
      ]),
    ),
  );
}

export function validateProfileUpgradeArtifact(value, implementation) {
  const errors = [];
  if (
    !record(value) ||
    !exactKeys(value, [
      "kind",
      "schemaVersion",
      "generatedAt",
      "implementation",
      "cli",
      "web",
      "unmanaged",
      "cleanup",
      "retention",
      "scope",
      "contentSha256",
    ]) ||
    value.kind !== "napier.profile-upgrade-stage21" ||
    value.schemaVersion !== 1 ||
    !isoDate(value.generatedAt) ||
    canonicalJson(value.implementation) !== canonicalJson(implementation) ||
    !validUpgradeArm(value.cli, "built_cli", true) ||
    !validUpgradeArm(value.web, "production_web", false) ||
    !validUnmanaged(value.unmanaged) ||
    !validCleanup(value.cleanup) ||
    !validRetention(value.retention) ||
    !validScope(value.scope) ||
    !SHA256.test(value.contentSha256 ?? "")
  ) {
    errors.push("Profile upgrade artifact shape is invalid");
    return errors;
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push("Profile upgrade artifact content hash is invalid");
  }
  return errors;
}

function validUpgradeArm(value, entry, stalePreviewRejected) {
  const keys = [
    "entry",
    "stalePreviewRejected",
    "sourceContractVersion",
    "targetContractVersion",
    "revisionBefore",
    "revisionAfter",
    "revisionCountDelta",
    "operationCount",
    "operationSetSha256",
    "diffSha256",
    "explicitOverrideFields",
    "overridesPreserved",
    "skillLoadAdded",
    "nonManagedStateUnchanged",
    "bindingSource",
    "bindingOwnership",
    "projectionSha256",
  ];
  if (entry === "production_web") {
    keys.splice(2, 0, "consoleErrorCount", "horizontalOverflowPx");
  }
  return (
    record(value) &&
    exactKeys(value, keys) &&
    ENTRY.has(value.entry) &&
    value.entry === entry &&
    value.stalePreviewRejected === stalePreviewRejected &&
    value.sourceContractVersion === 2 &&
    value.targetContractVersion === 3 &&
    value.revisionBefore === 2 &&
    value.revisionAfter === 3 &&
    value.revisionCountDelta === 1 &&
    value.operationCount === 1 &&
    SHA256.test(value.operationSetSha256 ?? "") &&
    SHA256.test(value.diffSha256 ?? "") &&
    canonicalJson(value.explicitOverrideFields) ===
      canonicalJson(["enabledSkills"]) &&
    value.overridesPreserved === true &&
    value.skillLoadAdded === true &&
    value.nonManagedStateUnchanged === true &&
    value.bindingSource === "contract_upgrade" &&
    value.bindingOwnership === "explicit_overrides" &&
    SHA256.test(value.projectionSha256 ?? "") &&
    (entry !== "production_web" ||
      (value.consoleErrorCount === 0 && value.horizontalOverflowPx === 0))
  );
}

function validUnmanaged(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "entry",
      "driftState",
      "ownership",
      "upgradePreviewAbsent",
      "rejected",
      "profileUnchanged",
      "revisionCountDelta",
    ]) &&
    value.entry === "built_cli" &&
    value.driftState === "custom_unmanaged" &&
    value.ownership === "unmanaged" &&
    value.upgradePreviewAbsent === true &&
    value.rejected === true &&
    value.profileUnchanged === true &&
    value.revisionCountDelta === 0
  );
}

function validCleanup(value) {
  return (
    record(value) &&
    exactKeys(value, ["serverClosed", "browserClosed", "taskRootRemoved"]) &&
    Object.values(value).every((item) => item === true)
  );
}

function validRetention(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "profileBodies",
      "systemPrompts",
      "workspacePaths",
      "rawCliOutput",
      "rawBrowserOutput",
      "credentialValues",
    ]) &&
    Object.values(value).every((item) => item === false)
  );
}

function validScope(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "sliceComplete",
      "s1Complete",
      "managedUpgradeAccepted",
      "explicitOverridesPreserved",
      "unmanagedInferenceRejected",
      "remaining",
    ]) &&
    value.sliceComplete === true &&
    value.s1Complete === false &&
    value.managedUpgradeAccepted === true &&
    value.explicitOverridesPreserved === true &&
    value.unmanagedInferenceRejected === true &&
    canonicalJson(value.remaining) ===
      canonicalJson([
        "public signed external release",
        "Windows host product acceptance",
      ])
  );
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return (
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort())
  );
}

function isoDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
