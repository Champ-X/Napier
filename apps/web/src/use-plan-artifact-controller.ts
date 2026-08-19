import { useEffect, useState } from "react";

import type { ArtifactManifestEntry, ExecutionPlan } from "@napier/contracts";

import {
  checkPlanArtifactDrift,
  downloadPlanArtifactFile,
  previewPlanArtifactDataProfile,
  previewPlanArtifactDirectoryManifest,
  previewPlanArtifactText,
  type PlanArtifactDataProfile,
  type PlanArtifactDirectoryManifest,
  verifyPlanArtifactDataProfile,
  verifyPlanArtifactDirectoryManifest,
  verifyPlanArtifactFile,
} from "./artifact-file-api";
import { artifactDataProfileFilename } from "./artifact-data-profile-view-model";
import { artifactDirectoryManifestFilename } from "./artifact-manifest-view-model";
import { formatApiErrorMessage } from "./api-error";
import { updatePlanArtifact } from "./api";
import type {
  PlanArtifactManifestActions,
  PlanArtifactManifestState,
} from "./plan-artifact-manifest-types";
import {
  downloadPlanBlob,
  downloadPlanJson,
  planArtifactActionEvidence,
} from "./plan-panel-helpers";
import { planCopy } from "./plan-copy";

const EMPTY_ARTIFACT_STATE: PlanArtifactManifestState = {
  busyId: undefined,
  error: undefined,
  fileDownload: undefined,
  fileVerification: undefined,
  textPreview: undefined,
  dataProfile: undefined,
  dataProfileVerification: undefined,
  directoryManifest: undefined,
  directoryManifestVerification: undefined,
  driftCheck: undefined,
};

export interface PlanArtifactController {
  state: PlanArtifactManifestState;
  actions: PlanArtifactManifestActions;
}

export interface UsePlanArtifactControllerOptions {
  threadId: string | undefined;
  plan: ExecutionPlan | undefined;
  resetKey: string | undefined;
  onChanged: () => void | Promise<void>;
}

export function usePlanArtifactController({
  threadId,
  plan,
  resetKey,
  onChanged,
}: UsePlanArtifactControllerOptions): PlanArtifactController {
  const [state, setState] =
    useState<PlanArtifactManifestState>(EMPTY_ARTIFACT_STATE);

  useEffect(() => setState(EMPTY_ARTIFACT_STATE), [resetKey]);

  const execute = async <T>(
    busyId: string,
    operation: () => Promise<T>,
    commit: (result: T) => Partial<PlanArtifactManifestState>,
    formatError: (error: unknown) => string = formatApiErrorMessage,
  ): Promise<void> => {
    if (!threadId || !plan || state.busyId) return;
    setState({ ...EMPTY_ARTIFACT_STATE, busyId });
    try {
      const result = await operation();
      setState({ ...EMPTY_ARTIFACT_STATE, ...commit(result) });
      await onChanged();
    } catch (error) {
      setState({ ...EMPTY_ARTIFACT_STATE, error: formatError(error) });
    }
  };

  const update = async (
    artifact: ArtifactManifestEntry,
    action: "produced" | "verified" | "missing",
  ): Promise<void> =>
    execute(
      `${artifact.id}:${action}`,
      () =>
        updatePlanArtifact(threadId!, plan!.id, artifact.id, {
          status: action,
          evidence: planArtifactActionEvidence(artifact, action),
          ...(action === "verified" ||
          (action === "missing" && artifact.status === "verified")
            ? { observeWorkspace: true }
            : {}),
        }),
      () => ({}),
    );

  const download = async (artifact: ArtifactManifestEntry): Promise<void> =>
    execute(
      `${artifact.id}:download`,
      () => downloadPlanArtifactFile(threadId!, plan!.id, artifact.id),
      (result) => {
        downloadPlanBlob(result.blob, result.filename);
        return {
          fileDownload: {
            artifactId: artifact.id,
            filename: result.filename,
            sha256: result.sha256,
            sizeBytes: result.sizeBytes,
            ledgerEventId: result.ledgerEventId,
            ledgerEventSeq: result.ledgerEventSeq,
            ledgerEventSha256: result.ledgerEventSha256,
          },
        };
      },
    );

  const previewText = async (artifact: ArtifactManifestEntry): Promise<void> =>
    execute(
      `${artifact.id}:preview`,
      () => previewPlanArtifactText(threadId!, plan!.id, artifact.id),
      (textPreview) => ({ textPreview }),
    );

  const verifyFile = async (
    artifact: ArtifactManifestEntry,
    file: File,
  ): Promise<void> =>
    execute(
      `${artifact.id}:file-verify`,
      () => verifyPlanArtifactFile(threadId!, plan!.id, artifact.id, file),
      (fileVerification) => ({ fileVerification }),
    );

  const profileData = async (artifact: ArtifactManifestEntry): Promise<void> =>
    execute(
      `${artifact.id}:data`,
      () => previewPlanArtifactDataProfile(threadId!, plan!.id, artifact.id),
      (dataProfile) => ({ dataProfile }),
    );

  const verifyDataProfile = async (
    artifact: ArtifactManifestEntry,
    file: File,
  ): Promise<void> =>
    execute(
      `${artifact.id}:data-verify`,
      async () =>
        verifyPlanArtifactDataProfile(
          threadId!,
          plan!.id,
          artifact.id,
          JSON.parse(await file.text()) as PlanArtifactDataProfile,
        ),
      (dataProfileVerification) => ({ dataProfileVerification }),
      (error) =>
        error instanceof SyntaxError
          ? planCopy.artifactActions.dataProfileVerifyInvalidJson
          : formatApiErrorMessage(error),
    );

  const inspectDirectory = async (
    artifact: ArtifactManifestEntry,
  ): Promise<void> =>
    execute(
      `${artifact.id}:manifest`,
      () =>
        previewPlanArtifactDirectoryManifest(threadId!, plan!.id, artifact.id),
      (directoryManifest) => ({ directoryManifest }),
    );

  const verifyDirectory = async (
    artifact: ArtifactManifestEntry,
    file: File,
  ): Promise<void> =>
    execute(
      `${artifact.id}:manifest-verify`,
      async () =>
        verifyPlanArtifactDirectoryManifest(
          threadId!,
          plan!.id,
          artifact.id,
          JSON.parse(await file.text()) as PlanArtifactDirectoryManifest,
        ),
      (directoryManifestVerification) => ({
        directoryManifestVerification,
      }),
      (error) =>
        error instanceof SyntaxError
          ? planCopy.artifactActions.manifestVerifyInvalidJson
          : formatApiErrorMessage(error),
    );

  const checkDrift = async (artifact: ArtifactManifestEntry): Promise<void> =>
    execute(
      `${artifact.id}:drift-check`,
      () => checkPlanArtifactDrift(threadId!, plan!.id, artifact.id),
      (driftCheck) => ({ driftCheck }),
    );

  return {
    state,
    actions: {
      onUpdate: update,
      onDownload: download,
      onVerifyFile: verifyFile,
      onPreviewText: previewText,
      onCloseTextPreview: () => setState(EMPTY_ARTIFACT_STATE),
      onProfileData: profileData,
      onDownloadDataProfile: (profile) =>
        downloadPlanJson(profile, artifactDataProfileFilename(profile)),
      onVerifyDataProfile: verifyDataProfile,
      onCloseDataProfile: () => setState(EMPTY_ARTIFACT_STATE),
      onInspectDirectoryManifest: inspectDirectory,
      onDownloadDirectoryManifest: (manifest) =>
        downloadPlanJson(manifest, artifactDirectoryManifestFilename(manifest)),
      onVerifyDirectoryManifest: verifyDirectory,
      onCloseDirectoryManifest: () => setState(EMPTY_ARTIFACT_STATE),
      onCheckDrift: checkDrift,
    },
  };
}
