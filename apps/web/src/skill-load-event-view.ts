import type { SkillLifecycleState } from "@napier/contracts/skill-load";
import {
  isSkillLoadFailureV1,
  isSkillLoadReceiptV1,
  isSkillLoadSelectionV1,
} from "@napier/contracts/skill-load";
import type { StandardSkillRootKind } from "@napier/contracts/skill-load-standard";
import {
  isStandardSkillLoadFailureV2,
  isStandardSkillLoadReceiptV2,
  isStandardSkillLoadSelectionV2,
} from "@napier/contracts/skill-load-standard";
import {
  isSkillResourceLoadFailureV1,
  isSkillResourceLoadReceiptV1,
  type SkillResourceFailureCode,
} from "@napier/contracts/skill-resource";

export interface SkillLoadToolEventTraceView {
  skillLoadName?: string;
  skillLoadState?: SkillLifecycleState;
  skillLoadSource?: "project" | "user" | "composite";
  skillLoadRootKind?: StandardSkillRootKind;
  skillLoadCandidateRootKinds?: StandardSkillRootKind[];
  skillLoadCatalogSha256?: string;
  skillLoadAvailabilitySetSha256?: string;
  skillLoadSnapshotManifestSha256?: string;
  skillLoadReceiptSha256?: string;
  skillLoadFailureSha256?: string;
  skillLoadRawContentSha256?: string;
  skillLoadInvocationSha256?: string;
  skillLoadRelativePathSha256?: string;
}

export interface SkillResourceToolEventTraceView {
  skillResourceName?: string;
  skillResourcePath?: string;
  skillResourceState?: "loaded" | "failed";
  skillResourceFailureCode?: SkillResourceFailureCode;
  skillResourceSource?: "project" | "user" | "composite";
  skillResourceRootKind?: StandardSkillRootKind;
  skillResourceCandidateRootKinds?: StandardSkillRootKind[];
  skillResourceCatalogSha256?: string;
  skillResourceSnapshotManifestSha256?: string;
  skillResourceReceiptSha256?: string;
  skillResourceFailureSha256?: string;
  skillResourceRawContentSha256?: string;
  skillResourceBindingSha256?: string;
  skillResourceRequestedPathSha256?: string;
}

export interface SkillToolEventTraceView
  extends SkillLoadToolEventTraceView, SkillResourceToolEventTraceView {}

export function skillToolEventEvidence(
  toolName: string,
  value: unknown,
): SkillToolEventTraceView {
  return {
    ...(toolName === "skill_load" ? skillLoadEventEvidence(value) : {}),
    ...(toolName === "skill_resource" ? skillResourceEventEvidence(value) : {}),
  };
}

export function skillToolSummaryParts(view: SkillToolEventTraceView): string[] {
  return [...skillLoadSummaryParts(view), ...skillResourceSummaryParts(view)];
}

export function skillLoadEventEvidence(
  value: unknown,
): SkillLoadToolEventTraceView | undefined {
  if (isSkillLoadSelectionV1(value)) {
    return {
      skillLoadName: value.name,
      skillLoadState: "selected",
      skillLoadSource: "project",
      skillLoadCatalogSha256: value.catalogSha256,
      skillLoadAvailabilitySetSha256: value.availabilitySetSha256,
      skillLoadSnapshotManifestSha256: value.snapshotManifestSha256,
    };
  }
  if (isStandardSkillLoadSelectionV2(value)) {
    return {
      skillLoadName: value.name,
      skillLoadState: "selected",
      skillLoadSource: value.source,
      skillLoadRootKind: value.rootKind,
      skillLoadCatalogSha256: value.catalogSha256,
      skillLoadAvailabilitySetSha256: value.availabilitySetSha256,
      skillLoadSnapshotManifestSha256: value.snapshotManifestSha256,
    };
  }
  if (isSkillLoadReceiptV1(value)) {
    return {
      skillLoadName: value.name,
      skillLoadState: "loaded",
      skillLoadSource: "project",
      skillLoadCatalogSha256: value.catalogSha256,
      skillLoadSnapshotManifestSha256: value.snapshotManifestSha256,
      skillLoadReceiptSha256: value.contentSha256,
      skillLoadRawContentSha256: value.rawContentSha256,
      skillLoadInvocationSha256: value.invocationSha256,
    };
  }
  if (isStandardSkillLoadReceiptV2(value)) {
    return {
      skillLoadName: value.name,
      skillLoadState: "loaded",
      skillLoadSource: value.source,
      skillLoadRootKind: value.rootKind,
      skillLoadCatalogSha256: value.catalogSha256,
      skillLoadSnapshotManifestSha256: value.snapshotManifestSha256,
      skillLoadReceiptSha256: value.contentSha256,
      skillLoadRawContentSha256: value.rawContentSha256,
      skillLoadInvocationSha256: value.invocationSha256,
    };
  }
  if (isSkillLoadFailureV1(value)) {
    return {
      ...(value.subject === "skill_request" && value.canonicalName
        ? { skillLoadName: value.canonicalName }
        : {}),
      skillLoadState: value.state,
      skillLoadSource: "project",
      skillLoadCatalogSha256: value.catalogSha256,
      ...(value.subject === "skill_request" && value.snapshotManifestSha256
        ? {
            skillLoadSnapshotManifestSha256: value.snapshotManifestSha256,
          }
        : {}),
      skillLoadFailureSha256: value.contentSha256,
    };
  }
  if (isStandardSkillLoadFailureV2(value)) {
    return {
      ...(value.canonicalName ? { skillLoadName: value.canonicalName } : {}),
      skillLoadState: value.state,
      skillLoadSource: "composite",
      skillLoadCandidateRootKinds: value.candidateRootKinds,
      skillLoadCatalogSha256: value.catalogSha256,
      ...(value.snapshotManifestSha256
        ? { skillLoadSnapshotManifestSha256: value.snapshotManifestSha256 }
        : {}),
      skillLoadFailureSha256: value.contentSha256,
    };
  }
  return undefined;
}

export function skillLoadSummaryParts(
  view: SkillLoadToolEventTraceView,
): string[] {
  if (!view.skillLoadState) return [];
  return [
    `skill ${view.skillLoadName ?? "catalog"}`,
    `skill-state ${view.skillLoadState}`,
    ...(view.skillLoadSource ? [`skill-source ${view.skillLoadSource}`] : []),
    ...(view.skillLoadRootKind ? [`skill-root ${view.skillLoadRootKind}`] : []),
    ...(view.skillLoadCandidateRootKinds?.length
      ? [`skill-candidates ${view.skillLoadCandidateRootKinds.join(",")}`]
      : []),
    ...hash("skill-catalog", view.skillLoadCatalogSha256),
    ...hash("skill-availability", view.skillLoadAvailabilitySetSha256),
    ...hash("skill-manifest", view.skillLoadSnapshotManifestSha256),
    ...hash("skill-receipt", view.skillLoadReceiptSha256),
    ...hash("skill-failure", view.skillLoadFailureSha256),
    ...hash("skill-content", view.skillLoadRawContentSha256),
    ...hash("skill-invocation", view.skillLoadInvocationSha256),
  ];
}

export function skillResourceEventEvidence(
  value: unknown,
): SkillResourceToolEventTraceView | undefined {
  if (isSkillResourceLoadReceiptV1(value)) {
    return {
      skillResourceName: value.skillName,
      skillResourcePath: value.resourcePath,
      skillResourceState: "loaded",
      skillResourceSource: value.source,
      skillResourceRootKind: value.rootKind,
      skillResourceCatalogSha256: value.catalogSha256,
      skillResourceSnapshotManifestSha256: value.snapshotManifestSha256,
      skillResourceReceiptSha256: value.contentSha256,
      skillResourceRawContentSha256: value.rawContentSha256,
      skillResourceBindingSha256: value.resourceBindingSha256,
      skillResourceRequestedPathSha256: value.requestedResourcePathSha256,
    };
  }
  if (isSkillResourceLoadFailureV1(value)) {
    return {
      ...(value.skillName ? { skillResourceName: value.skillName } : {}),
      ...(value.resourcePath ? { skillResourcePath: value.resourcePath } : {}),
      skillResourceState: "failed",
      skillResourceFailureCode: value.failureCode,
      skillResourceSource: "composite",
      skillResourceCandidateRootKinds: value.candidateRootKinds,
      skillResourceCatalogSha256: value.catalogSha256,
      skillResourceSnapshotManifestSha256: value.snapshotManifestSha256,
      skillResourceFailureSha256: value.contentSha256,
    };
  }
  return undefined;
}

export function skillResourceSummaryParts(
  view: SkillResourceToolEventTraceView,
): string[] {
  if (!view.skillResourceState) return [];
  return [
    `skill-resource ${view.skillResourceName ?? "unknown"}`,
    `resource-state ${view.skillResourceState}`,
    ...(view.skillResourcePath
      ? [`resource-path ${view.skillResourcePath}`]
      : []),
    ...(view.skillResourceFailureCode
      ? [`resource-failure-code ${view.skillResourceFailureCode}`]
      : []),
    ...(view.skillResourceSource
      ? [`resource-source ${view.skillResourceSource}`]
      : []),
    ...(view.skillResourceRootKind
      ? [`resource-root ${view.skillResourceRootKind}`]
      : []),
    ...(view.skillResourceCandidateRootKinds?.length
      ? [
          `resource-candidates ${view.skillResourceCandidateRootKinds.join(",")}`,
        ]
      : []),
    ...hash("resource-catalog", view.skillResourceCatalogSha256),
    ...hash("resource-manifest", view.skillResourceSnapshotManifestSha256),
    ...hash("resource-receipt", view.skillResourceReceiptSha256),
    ...hash("resource-failure", view.skillResourceFailureSha256),
    ...hash("resource-content", view.skillResourceRawContentSha256),
    ...hash("resource-binding", view.skillResourceBindingSha256),
    ...hash("resource-path", view.skillResourceRequestedPathSha256),
  ];
}

function hash(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}
