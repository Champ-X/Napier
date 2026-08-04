import type {
  ArtifactManifestEntry,
  ExecutionPlanReplanRecord,
} from "@napier/contracts";

import type {
  PlanArtifactDataProfileReceipt,
  PlanArtifactDataProfileVerification,
  PlanArtifactDirectoryManifestReceipt,
  PlanArtifactDirectoryManifestVerification,
  PlanArtifactDriftCheckReceipt,
  PlanArtifactFileVerification,
  PlanArtifactLedgerEventReceipt,
  PlanArtifactTextPreviewReceipt,
} from "./artifact-file-api";

export type PlanArtifactUpdateAction = "produced" | "verified" | "missing";

export type PlanArtifactFileDownloadReceipt = PlanArtifactLedgerEventReceipt & {
  artifactId: string;
  filename: string;
  sha256: string;
  sizeBytes: number;
};

export interface PlanArtifactManifestState {
  busyId: string | undefined;
  error: string | undefined;
  fileDownload: PlanArtifactFileDownloadReceipt | undefined;
  fileVerification: PlanArtifactFileVerification | undefined;
  textPreview: PlanArtifactTextPreviewReceipt | undefined;
  dataProfile: PlanArtifactDataProfileReceipt | undefined;
  dataProfileVerification: PlanArtifactDataProfileVerification | undefined;
  directoryManifest: PlanArtifactDirectoryManifestReceipt | undefined;
  directoryManifestVerification:
    | PlanArtifactDirectoryManifestVerification
    | undefined;
  driftCheck: PlanArtifactDriftCheckReceipt | undefined;
}

export interface PlanArtifactDetailState {
  fileDownload: PlanArtifactFileDownloadReceipt | undefined;
  fileVerification: PlanArtifactFileVerification | undefined;
  textPreview: PlanArtifactTextPreviewReceipt | undefined;
  dataProfile: PlanArtifactDataProfileReceipt | undefined;
  dataProfileVerification: PlanArtifactDataProfileVerification | undefined;
  directoryManifest: PlanArtifactDirectoryManifestReceipt | undefined;
  directoryManifestVerification:
    | PlanArtifactDirectoryManifestVerification
    | undefined;
  driftCheck: PlanArtifactDriftCheckReceipt | undefined;
}

export interface PlanArtifactManifestActions {
  onUpdate: (
    artifact: ArtifactManifestEntry,
    action: PlanArtifactUpdateAction,
  ) => void;
  onDownload: (artifact: ArtifactManifestEntry) => void;
  onVerifyFile: (artifact: ArtifactManifestEntry, file: File) => void;
  onPreviewText: (artifact: ArtifactManifestEntry) => void;
  onCloseTextPreview: () => void;
  onProfileData: (artifact: ArtifactManifestEntry) => void;
  onDownloadDataProfile: (profile: PlanArtifactDataProfileReceipt) => void;
  onVerifyDataProfile: (artifact: ArtifactManifestEntry, file: File) => void;
  onCloseDataProfile: () => void;
  onInspectDirectoryManifest: (artifact: ArtifactManifestEntry) => void;
  onDownloadDirectoryManifest: (
    manifest: PlanArtifactDirectoryManifestReceipt,
  ) => void;
  onVerifyDirectoryManifest: (
    artifact: ArtifactManifestEntry,
    file: File,
  ) => void;
  onCloseDirectoryManifest: () => void;
  onCheckDrift: (artifact: ArtifactManifestEntry) => void;
}

export interface PlanArtifactManifestProps {
  artifacts: ArtifactManifestEntry[];
  latestReplan: ExecutionPlanReplanRecord | undefined;
  state: PlanArtifactManifestState;
  actions: PlanArtifactManifestActions;
}
