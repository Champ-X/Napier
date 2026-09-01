import {
  isStandardSkillCatalogBindingV2,
  isStandardSkillLoadFailureV2,
  isStandardSkillLoadReceiptV2,
  isStandardSkillLoadSelectionV2,
  isStandardSkillSnapshotManifestV2,
  type StandardSkillLoadFailureV2,
  type StandardSkillManifestEntryV2,
  type StandardSkillRequestRecord,
} from "../src/skill-load-standard.js";
import { canonical, sha256 } from "../src/skill-load-validation.js";
import { describe, expect, it } from "vitest";

const name = "shared-skill";
const digest = sha256(name);
const entry: StandardSkillManifestEntryV2 = {
  canonicalName: name,
  requestedNameSha256: digest,
  source: "user",
  rootKind: "user_standard",
  relativePath: `.agents/skills/${name}/SKILL.md`,
  virtualPath: `/user/.agents/skills/${name}/SKILL.md`,
  directoryKind: "directory",
  fileKind: "regular_file",
  symlinkFree: true,
  sizeBytes: 123,
  lineCount: 7,
  rawContentSha256: "1".repeat(64),
  metadataSha256: "2".repeat(64),
  invocationSha256: "3".repeat(64),
};

describe("standard Skill load contracts", () => {
  it("accepts source-explicit user selection and receipt", () => {
    const selection = seal({
      kind: "napier.skill-load-selection",
      schemaVersion: 2,
      operation: "skill.load",
      agentToolName: "skill_load",
      state: "selected",
      name,
      requestedNameSha256: digest,
      source: "user",
      rootKind: "user_standard",
      catalogSha256: "4".repeat(64),
      availabilitySetSha256: "5".repeat(64),
      snapshotManifestSha256: "6".repeat(64),
      inputSha256: sha256(canonical({ name })),
    });
    const receipt = seal({
      kind: "napier.skill-load-receipt",
      schemaVersion: 2,
      operation: "skill.load",
      agentToolName: "skill_load",
      state: "loaded",
      name,
      requestedNameSha256: digest,
      source: "user",
      rootKind: "user_standard",
      relativePath: `.agents/skills/${name}/SKILL.md`,
      sizeBytes: 123,
      lineCount: 7,
      rawContentSha256: "1".repeat(64),
      invocationSha256: "3".repeat(64),
      catalogSha256: "4".repeat(64),
      snapshotManifestSha256: "6".repeat(64),
    });

    expect(isStandardSkillLoadSelectionV2(selection)).toBe(true);
    expect(isStandardSkillLoadReceiptV2(receipt)).toBe(true);
    expect(
      isStandardSkillLoadReceiptV2({
        ...receipt,
        source: "project",
      }),
    ).toBe(false);
  });

  it("accepts fail-closed cross-root conflict evidence", () => {
    const failure = conflictFailure();
    expect(isStandardSkillLoadFailureV2(failure)).toBe(true);
    expect(
      isStandardSkillLoadFailureV2({
        ...failure,
        candidateRootKinds: ["user_standard", "project_standard"],
      }),
    ).toBe(false);
  });

  it("binds request source, roots, entries and failure relations", () => {
    const requests: StandardSkillRequestRecord[] = [
      {
        position: 0,
        requestedNameSha256: digest,
        state: "loadable",
        canonicalName: name,
        source: "user",
        rootKind: "user_standard",
      },
    ];
    const observedRootKinds = ["user_standard"] as const;
    const rootIdentitySetSha256 = "7".repeat(64);
    const catalogSha256 = sha256(
      canonical({
        observedRootKinds,
        rootIdentitySetSha256,
        directDirectoryCount: 1,
        entries: [entry],
      }),
    );
    const availabilitySetSha256 = sha256(
      canonical({
        configuredSkillRequests: requests,
        loadableSkillNames: [name],
        unavailableFailureContentSha256s: [],
        catalogSha256,
      }),
    );
    const manifest = sealAs(
      {
        kind: "napier.standard-skill-snapshot-manifest",
        schemaVersion: 2,
        source: "composite",
        trustOrigins: [
          "active_user_selected_project",
          "local_user_skill_store",
        ],
        workspaceIdentitySha256: "8".repeat(64),
        trustPolicySha256: "9".repeat(64),
        configuredSkillRequests: requests,
        selectionSha256: sha256(canonical(requests)),
        observedRootKinds: [...observedRootKinds],
        rootIdentitySetSha256,
        directDirectoryCount: 1,
        catalogSha256,
        availabilitySetSha256,
        entryCount: 1,
        aggregateRawBytes: 123,
        entries: [entry],
        unavailableFailureContentSha256s: [],
        snapshotContentSha256: "a".repeat(64),
      },
      "snapshotManifestSha256",
    );
    const binding = seal({
      kind: "napier.skill-catalog-binding",
      schemaVersion: 2,
      operation: "skill.load",
      agentToolName: "skill_load",
      configuredSkillRequests: requests,
      loadableSkillNames: [name],
      unavailableSkills: [],
      catalogSha256,
      availabilitySetSha256,
      snapshotManifestSha256: manifest.snapshotManifestSha256,
    });

    expect(isStandardSkillSnapshotManifestV2(manifest)).toBe(true);
    const {
      snapshotManifestSha256: _snapshotManifestSha256,
      ...manifestWithoutHash
    } = manifest;
    expect(
      isStandardSkillSnapshotManifestV2(
        sealAs(
          {
            ...manifestWithoutHash,
            trustOrigins: [
              "active_user_selected_project",
              "local_user_skill_store",
              "napier_read_only_bundle",
            ],
          },
          "snapshotManifestSha256",
        ),
      ),
    ).toBe(false);
    expect(isStandardSkillCatalogBindingV2(binding)).toBe(true);
    expect(
      isStandardSkillCatalogBindingV2({
        ...binding,
        configuredSkillRequests: [{ ...requests[0]!, source: "project" }],
      }),
    ).toBe(false);
  });
});

function conflictFailure(): StandardSkillLoadFailureV2 {
  return seal({
    kind: "napier.skill-load-failure",
    schemaVersion: 2,
    operation: "skill.load",
    agentToolName: "skill_load",
    source: "composite",
    subject: "skill_request",
    state: "unavailable",
    failureCode: "skill_ambiguous",
    requestedNameSha256: digest,
    canonicalName: name,
    candidateRootKinds: ["project_standard", "user_standard"],
    catalogSha256: "4".repeat(64),
    diagnosticSha256: "5".repeat(64),
  }) as StandardSkillLoadFailureV2;
}

function seal<T extends Record<string, unknown>>(value: T) {
  return { ...value, contentSha256: sha256(canonical(value)) };
}

function sealAs<T extends Record<string, unknown>, K extends string>(
  value: T,
  key: K,
): T & Record<K, string> {
  return { ...value, [key]: sha256(canonical(value)) } as T & Record<K, string>;
}
