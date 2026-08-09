import type { SkillLifecycleState } from "@napier/contracts/skill-load";
import {
  isSkillLoadFailureV1,
  isSkillLoadReceiptV1,
  isSkillLoadSelectionV1,
} from "@napier/contracts/skill-load";

export interface SkillLoadToolEventTraceView {
  skillLoadName?: string;
  skillLoadState?: SkillLifecycleState;
  skillLoadSource?: "project";
  skillLoadCatalogSha256?: string;
  skillLoadAvailabilitySetSha256?: string;
  skillLoadSnapshotManifestSha256?: string;
  skillLoadReceiptSha256?: string;
  skillLoadFailureSha256?: string;
  skillLoadRawContentSha256?: string;
  skillLoadInvocationSha256?: string;
  skillLoadRelativePathSha256?: string;
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
            skillLoadSnapshotManifestSha256:
              value.snapshotManifestSha256,
          }
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
    ...hash("skill-catalog", view.skillLoadCatalogSha256),
    ...hash("skill-availability", view.skillLoadAvailabilitySetSha256),
    ...hash("skill-manifest", view.skillLoadSnapshotManifestSha256),
    ...hash("skill-receipt", view.skillLoadReceiptSha256),
    ...hash("skill-failure", view.skillLoadFailureSha256),
    ...hash("skill-content", view.skillLoadRawContentSha256),
    ...hash("skill-invocation", view.skillLoadInvocationSha256),
  ];
}

function hash(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}
