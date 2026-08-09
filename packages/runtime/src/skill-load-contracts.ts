import type {
  ProjectSkillSnapshotManifestV1,
  SkillCatalogBindingV1,
  SkillLoadFailureV1,
  SkillLoadReceiptV1,
  SkillLoadSelectionV1,
} from "@napier/contracts/skill-load";
import {
  isProjectSkillSnapshotManifestV1,
  isSkillCatalogBindingV1,
  isSkillLoadFailureV1,
  isSkillLoadReceiptV1,
  isSkillLoadSelectionV1,
} from "@napier/contracts/skill-load";
import type {
  StandardSkillCatalogBindingV2,
  StandardSkillLoadFailureV2,
  StandardSkillLoadReceiptV2,
  StandardSkillLoadSelectionV2,
  StandardSkillSnapshotManifestV2,
} from "@napier/contracts/skill-load-standard";
import {
  isStandardSkillCatalogBindingV2,
  isStandardSkillLoadFailureV2,
  isStandardSkillLoadReceiptV2,
  isStandardSkillLoadSelectionV2,
  isStandardSkillSnapshotManifestV2,
} from "@napier/contracts/skill-load-standard";

export type SkillCatalogBinding =
  | SkillCatalogBindingV1
  | StandardSkillCatalogBindingV2;
export type SkillLoadFailure = SkillLoadFailureV1 | StandardSkillLoadFailureV2;
export type SkillLoadReceipt = SkillLoadReceiptV1 | StandardSkillLoadReceiptV2;
export type SkillLoadSelection =
  | SkillLoadSelectionV1
  | StandardSkillLoadSelectionV2;
export type SkillSnapshotManifest =
  | ProjectSkillSnapshotManifestV1
  | StandardSkillSnapshotManifestV2;

export function isSkillCatalogBinding(
  value: unknown,
): value is SkillCatalogBinding {
  return (
    isSkillCatalogBindingV1(value) || isStandardSkillCatalogBindingV2(value)
  );
}

export function isSkillLoadFailure(value: unknown): value is SkillLoadFailure {
  return isSkillLoadFailureV1(value) || isStandardSkillLoadFailureV2(value);
}

export function isSkillLoadReceipt(value: unknown): value is SkillLoadReceipt {
  return isSkillLoadReceiptV1(value) || isStandardSkillLoadReceiptV2(value);
}

export function isSkillLoadSelection(
  value: unknown,
): value is SkillLoadSelection {
  return isSkillLoadSelectionV1(value) || isStandardSkillLoadSelectionV2(value);
}

export function isSkillSnapshotManifest(
  value: unknown,
): value is SkillSnapshotManifest {
  return (
    isProjectSkillSnapshotManifestV1(value) ||
    isStandardSkillSnapshotManifestV2(value)
  );
}
