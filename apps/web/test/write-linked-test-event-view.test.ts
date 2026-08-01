import { describe, expect, it } from "vitest";

import {
  writeLinkedTestEventEvidence,
  writeLinkedTestSummaryParts,
} from "../src/write-linked-test-event-view";

describe("write-linked test event evidence", () => {
  it("projects monorepo resolution counts without configuration paths", () => {
    const evidence = writeLinkedTestEventEvidence({
      kind: "napier.write-linked-test-verification",
      schemaVersion: 2,
      status: "passed",
      changedFileCount: 1,
      changedSymbolCount: 1,
      changedSymbolsTruncated: false,
      scannedFileCount: 6,
      configurationFileCount: 4,
      workspacePackageCount: 2,
      pathAliasCount: 1,
      workspacePackageEdgeCount: 1,
      pathAliasEdgeCount: 1,
      candidateTestCount: 2,
      selectedTestCount: 1,
      omittedTestCount: 0,
      unresolvedImportCount: 0,
      graphTruncated: false,
      changedFileSetSha256: "1".repeat(64),
      changedSymbolSetSha256: "2".repeat(64),
      dependencyGraphSha256: "3".repeat(64),
      selectedTestSetSha256: "4".repeat(64),
      selectionSnapshotSha256: "5".repeat(64),
      observedSnapshotSha256: "5".repeat(64),
      verifierSha256: "6".repeat(64),
      durationMs: 20,
      exitCode: 0,
      stdoutSha256: "7".repeat(64),
      stderrSha256: "8".repeat(64),
      stdoutTruncated: false,
      stderrTruncated: false,
      resultSha256: "9".repeat(64),
      configPath: "PRIVATE_TSCONFIG_PATH",
      packageName: "PRIVATE_PACKAGE_NAME",
    });

    expect(evidence).toEqual(
      expect.objectContaining({
        writeLinkedTestStatus: "passed",
        writeLinkedConfigurationFileCount: 4,
        writeLinkedWorkspacePackageCount: 2,
        writeLinkedPathAliasCount: 1,
        writeLinkedWorkspacePackageEdgeCount: 1,
        writeLinkedPathAliasEdgeCount: 1,
      }),
    );
    const summary = writeLinkedTestSummaryParts(evidence!).join(" / ");
    expect(summary).toContain("workspace-package-edges 1");
    expect(summary).toContain("path-alias-edges 1");
    expect(summary).toContain("resolution-configs 4");
    expect(summary).not.toContain("PRIVATE");
  });

  it("rejects incomplete schema-v2 resolution evidence", () => {
    const malformed = writeLinkedTestEventEvidence({
      kind: "napier.write-linked-test-verification",
      schemaVersion: 2,
      status: "no_match",
      changedFileCount: 1,
      changedSymbolCount: 0,
      changedSymbolsTruncated: false,
      scannedFileCount: 1,
      configurationFileCount: 1,
      workspacePackageCount: 1,
      pathAliasCount: 0,
      workspacePackageEdgeCount: 0,
      candidateTestCount: 0,
      selectedTestCount: 0,
      omittedTestCount: 0,
      unresolvedImportCount: 0,
      graphTruncated: false,
      changedFileSetSha256: "1".repeat(64),
      changedSymbolSetSha256: "2".repeat(64),
      dependencyGraphSha256: "3".repeat(64),
      selectedTestSetSha256: "4".repeat(64),
      selectionSnapshotSha256: "5".repeat(64),
      durationMs: 3,
      resultSha256: "6".repeat(64),
    });

    expect(malformed).toBeUndefined();
  });
});
