import { useState } from "react";

import type {
  InboundDeadLetterExport,
  InboundDeadLetterExportVerification,
  InboundDeadLetterRetryApplyResult,
  InboundDeadLetterRetryHistory,
  InboundDeadLetterRetryPreview,
  InboundDelivery,
} from "@napier/contracts";

import {
  applyDeadLetterRetry,
  downloadDeadLetters,
  verifyDeadLetterFile,
} from "./automation-dead-letter-artifact-actions";
import { deadLetterQualificationSummary } from "./automation-panel-helpers";
import type { AutomationOperationController } from "./use-automation-operation";

export interface DeadLetterExportSummary {
  deliveryCount: number;
  contentSha256: string;
  qualifiedCount: number;
  evidenceMissingCount: number;
  adapterCatalogDriftCount: number;
}

interface DeadLetterArtifactState {
  exports: Record<string, DeadLetterExportSummary>;
  verifications: Record<string, InboundDeadLetterExportVerification>;
  artifacts: Record<string, unknown>;
  previews: Record<string, InboundDeadLetterRetryPreview>;
  results: Record<string, InboundDeadLetterRetryApplyResult>;
  confirmId: string | undefined;
}

export interface AutomationDeadLetterArtifactController {
  exports: DeadLetterArtifactState["exports"];
  verifications: DeadLetterArtifactState["verifications"];
  previews: DeadLetterArtifactState["previews"];
  results: DeadLetterArtifactState["results"];
  confirmId: string | undefined;
  setConfirmId: (value: string | undefined) => void;
  download: (channelId: string) => Promise<void>;
  verifyFile: (channelId: string, file: File) => Promise<void>;
  apply: (channelId: string) => Promise<void>;
}

export interface UseAutomationDeadLetterArtifactOptions {
  operation: AutomationOperationController;
  refresh: () => Promise<void>;
  updateDeliveries: (channelId: string, value: InboundDelivery[]) => void;
  onHistory: (channelId: string, value: InboundDeadLetterRetryHistory) => void;
  onHistoryChanged: (channelId: string) => void;
}

export function useAutomationDeadLetterArtifacts(
  options: UseAutomationDeadLetterArtifactOptions,
): AutomationDeadLetterArtifactController {
  const [state, setState] = useState<DeadLetterArtifactState>(initialState);
  const context = {
    ...options,
    artifacts: state.artifacts,
    previews: state.previews,
    onInspected: (
      channelId: string,
      artifact: unknown,
      verification: InboundDeadLetterExportVerification,
      preview: InboundDeadLetterRetryPreview,
    ) =>
      setState((current) =>
        inspectedState(current, channelId, artifact, verification, preview),
      ),
    onExported: (channelId: string, artifact: InboundDeadLetterExport) =>
      setState((current) => ({
        ...current,
        exports: {
          ...current.exports,
          [channelId]: projectExportSummary(artifact),
        },
      })),
    onApplied: (
      channelId: string,
      result: InboundDeadLetterRetryApplyResult,
      preview: InboundDeadLetterRetryPreview,
    ) =>
      setState((current) => ({
        ...current,
        confirmId: undefined,
        results: { ...current.results, [channelId]: result },
        previews: { ...current.previews, [channelId]: preview },
      })),
    onDeliveries: options.updateDeliveries,
  };
  return {
    ...state,
    setConfirmId: (confirmId) =>
      setState((current) => ({ ...current, confirmId })),
    download: (channelId) => downloadDeadLetters(context, channelId),
    verifyFile: (channelId, file) =>
      verifyDeadLetterFile(context, channelId, file),
    apply: (channelId) => applyDeadLetterRetry(context, channelId),
  };
}

const initialState: DeadLetterArtifactState = {
  exports: {},
  verifications: {},
  artifacts: {},
  previews: {},
  results: {},
  confirmId: undefined,
};

function inspectedState(
  current: DeadLetterArtifactState,
  channelId: string,
  artifact: unknown,
  verification: InboundDeadLetterExportVerification,
  preview: InboundDeadLetterRetryPreview,
): DeadLetterArtifactState {
  const results = { ...current.results };
  delete results[channelId];
  return {
    ...current,
    confirmId: undefined,
    results,
    artifacts: { ...current.artifacts, [channelId]: artifact },
    verifications: { ...current.verifications, [channelId]: verification },
    previews: { ...current.previews, [channelId]: preview },
  };
}

function projectExportSummary(
  artifact: InboundDeadLetterExport,
): DeadLetterExportSummary {
  return {
    deliveryCount: artifact.deliveryCount,
    contentSha256: artifact.contentSha256,
    ...deadLetterQualificationSummary(artifact),
  };
}
