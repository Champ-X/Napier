import { describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";
import { validateProfileUpgradeArtifact } from "./profile-upgrade-artifact.mjs";

const digest = "a".repeat(64);
const implementation = { contractSha256: digest };

describe("Profile upgrade Stage21 artifact", () => {
  it("accepts the strict current receipt", () => {
    expect(validateProfileUpgradeArtifact(artifact(), implementation)).toEqual(
      [],
    );
  });

  it.each([
    ["CLI override loss", (value) => (value.cli.overridesPreserved = false)],
    [
      "Web overflow",
      (value) => {
        value.web.horizontalOverflowPx = 1;
      },
    ],
    [
      "unmanaged inference",
      (value) => {
        value.unmanaged.rejected = false;
      },
    ],
    [
      "binding source drift",
      (value) => {
        value.cli.bindingSource = "updated";
      },
    ],
    [
      "unknown retained field",
      (value) => {
        value.cli.rawProfile = "forbidden";
      },
    ],
  ])("rejects %s after recomputing the outer hash", (_name, mutate) => {
    const value = artifact();
    mutate(value);
    value.contentSha256 = contentHash(value);
    expect(validateProfileUpgradeArtifact(value, implementation)).not.toEqual(
      [],
    );
  });

  it("rejects an implementation substitution", () => {
    expect(
      validateProfileUpgradeArtifact(artifact(), {
        contractSha256: "b".repeat(64),
      }),
    ).not.toEqual([]);
  });
});

function artifact() {
  const value = {
    kind: "napier.profile-upgrade-stage21",
    schemaVersion: 1,
    generatedAt: "2026-08-12T00:00:00.000Z",
    implementation,
    cli: arm("built_cli", true),
    web: {
      ...arm("production_web", false),
      consoleErrorCount: 0,
      horizontalOverflowPx: 0,
    },
    unmanaged: {
      entry: "built_cli",
      driftState: "custom_unmanaged",
      ownership: "unmanaged",
      upgradePreviewAbsent: true,
      rejected: true,
      profileUnchanged: true,
      revisionCountDelta: 0,
    },
    cleanup: {
      serverClosed: true,
      browserClosed: true,
      taskRootRemoved: true,
    },
    retention: {
      profileBodies: false,
      systemPrompts: false,
      workspacePaths: false,
      rawCliOutput: false,
      rawBrowserOutput: false,
      credentialValues: false,
    },
    scope: {
      sliceComplete: true,
      s1Complete: false,
      managedUpgradeAccepted: true,
      explicitOverridesPreserved: true,
      unmanagedInferenceRejected: true,
      remaining: [
        "public signed external release",
        "Windows host product acceptance",
      ],
    },
  };
  return { ...value, contentSha256: sha256(canonicalJson(value)) };
}

function arm(entry, stalePreviewRejected) {
  return {
    entry,
    stalePreviewRejected,
    sourceContractVersion: 2,
    targetContractVersion: 3,
    revisionBefore: 2,
    revisionAfter: 3,
    revisionCountDelta: 1,
    operationCount: 1,
    operationSetSha256: digest,
    diffSha256: digest,
    explicitOverrideFields: ["enabledSkills"],
    overridesPreserved: true,
    skillLoadAdded: true,
    nonManagedStateUnchanged: true,
    bindingSource: "contract_upgrade",
    bindingOwnership: "explicit_overrides",
    projectionSha256: digest,
  };
}

function contentHash(value) {
  const { contentSha256: _contentSha256, ...content } = value;
  return sha256(canonicalJson(content));
}
