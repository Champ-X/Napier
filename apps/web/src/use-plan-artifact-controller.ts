import { useEffect, useRef, useState } from "react";

import {
  artifactVersionKey,
  assertArtifactReceiptVersion,
  type ArtifactVersionReceipt,
  type ArtifactReceiptMode,
} from "./artifact-version-binding";
import { canonicalJson } from "./stable-digest";

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

  const scopeKey = canonicalJson({ threadId, plan, resetKey });
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  useEffect(() => {
    setState(EMPTY_ARTIFACT_STATE);
  }, [scopeKey]);
  useEffect(() => {
    currentScope.current = scopeKey;
    return () => {
      currentScope.current = "";
    };
  }, [scopeKey]);

  const execute = async <T>(
    artifact: ArtifactManifestEntry,
    busyId: string,
    operation: () => Promise<T>,
    commit: (result: T) => Partial<PlanArtifactManifestState>,
    mode: ArtifactReceiptMode | "mutation",
    formatError: (error: unknown) => string = formatApiErrorMessage,
  ): Promise<void> => {
    if (!threadId || !plan || state.busyId) return;
    const selection = {
      artifact,
      threadId,
      planId: plan.id,
      planRevision: plan.revision,
    };
    const selectionKey = artifactVersionKey(selection);
    setState({ ...EMPTY_ARTIFACT_STATE, busyId });
    try {
      const result = await operation();
      if (mode !== "mutation") {
        assertArtifactReceiptVersion(
          selection,
          result as unknown as ArtifactVersionReceipt,
          mode,
        );
      }
      if (currentScope.current !== scopeKey) return;
      setState({ ...EMPTY_ARTIFACT_STATE, selectionKey, ...commit(result) });
      await onChanged();
    } catch (error) {
      if (currentScope.current === scopeKey)
        setState({ ...EMPTY_ARTIFACT_STATE, error: formatError(error) });
    }
  };

  const update = async (
    artifact: ArtifactManifestEntry,
    action: "produced" | "verified" | "missing",
  ): Promise<void> =>
    execute(
      artifact,
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
      "mutation",
    );

  const download = async (artifact: ArtifactManifestEntry): Promise<void> =>
    execute(
      artifact,
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
      "content",
    );

  const previewText = async (artifact: ArtifactManifestEntry): Promise<void> =>
    execute(
      artifact,
      `${artifact.id}:preview`,
      () => previewPlanArtifactText(threadId!, plan!.id, artifact.id),
      (textPreview) => ({ textPreview }),
      "content",
    );

  const verifyFile = async (
    artifact: ArtifactManifestEntry,
    file: File,
  ): Promise<void> =>
    execute(
      artifact,
      `${artifact.id}:file-verify`,
      () => verifyPlanArtifactFile(threadId!, plan!.id, artifact.id, file),
      (fileVerification) => ({ fileVerification }),
      "expected",
    );

  const profileData = async (artifact: ArtifactManifestEntry): Promise<void> =>
    execute(
      artifact,
      `${artifact.id}:data`,
      () => previewPlanArtifactDataProfile(threadId!, plan!.id, artifact.id),
      (dataProfile) => ({ dataProfile }),
      "content",
    );

  const verifyDataProfile = async (
    artifact: ArtifactManifestEntry,
    file: File,
  ): Promise<void> =>
    execute(
      artifact,
      `${artifact.id}:data-verify`,
      async () =>
        verifyPlanArtifactDataProfile(
          threadId!,
          plan!.id,
          artifact.id,
          JSON.parse(await file.text()) as PlanArtifactDataProfile,
        ),
      (dataProfileVerification) => ({ dataProfileVerification }),
      "identity",
      (error) =>
        error instanceof SyntaxError
          ? planCopy.artifactActions.dataProfileVerifyInvalidJson
          : formatApiErrorMessage(error),
    );

  const inspectDirectory = async (
    artifact: ArtifactManifestEntry,
  ): Promise<void> =>
    execute(
      artifact,
      `${artifact.id}:manifest`,
      () =>
        previewPlanArtifactDirectoryManifest(threadId!, plan!.id, artifact.id),
      (directoryManifest) => ({ directoryManifest }),
      "content",
    );

  const verifyDirectory = async (
    artifact: ArtifactManifestEntry,
    file: File,
  ): Promise<void> =>
    execute(
      artifact,
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
      "identity",
      (error) =>
        error instanceof SyntaxError
          ? planCopy.artifactActions.manifestVerifyInvalidJson
          : formatApiErrorMessage(error),
    );

  const checkDrift = async (artifact: ArtifactManifestEntry): Promise<void> =>
    execute(
      artifact,
      `${artifact.id}:drift-check`,
      () => checkPlanArtifactDrift(threadId!, plan!.id, artifact.id),
      (driftCheck) => ({ driftCheck }),
      "expected",
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
