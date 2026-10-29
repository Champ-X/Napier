import { useEffect, useRef, useState } from "react";

import { formatApiErrorMessage } from "./api-error";
import { assertArtifactReceiptVersion } from "./artifact-version-binding";
import {
  artifactUsesTextPreview,
  requestArtifactPreview,
  type ArtifactInspection,
  type ArtifactPreviewReceipt,
} from "./artifact-inspection";
import {
  previewPlanArtifactFile,
  previewPlanArtifactDiff,
  previewPlanArtifactText,
  type PlanArtifactDiffPreviewReceipt,
} from "./artifact-file-api";

export type ArtifactInspectorView = "preview" | "source" | "diff";

export function useArtifactInspectorView({
  inspection,
  onLedgerChanged,
  previewArtifact,
  previewArtifactFile,
  previewDiff,
}: {
  inspection: ArtifactInspection;
  onLedgerChanged?: () => void | Promise<void>;
  previewArtifact: typeof previewPlanArtifactText;
  previewArtifactFile: typeof previewPlanArtifactFile;
  previewDiff: typeof previewPlanArtifactDiff;
}) {
  const supportsText = artifactUsesTextPreview(inspection.artifact.path);
  const initialView =
    inspection.mode === "diff" && supportsText ? "diff" : "preview";
  const [view, setView] = useState<ArtifactInspectorView>(initialView);
  const [loadingView, setLoadingView] = useState<ArtifactInspectorView>();
  const [error, setError] = useState<string>();
  const [stateInspection, setStateInspection] = useState(inspection);
  const [preview, setPreview] = useState<ArtifactPreviewReceipt>();
  const [diff, setDiff] = useState<PlanArtifactDiffPreviewReceipt>();
  const onLedgerChangedRef = useRef(onLedgerChanged);
  onLedgerChangedRef.current = onLedgerChanged;
  const inspectionRef = useRef(inspection);
  inspectionRef.current = inspection;
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    const isCurrent = () =>
      generation === generationRef.current &&
      inspectionRef.current === inspection;
    const invalidate = () => {
      generationRef.current += 1;
    };
    setStateInspection(inspection);
    setView(initialView);
    setPreview(undefined);
    setDiff(undefined);
    setError(undefined);
    setLoadingView(initialView);
    void (async () => {
      try {
        if (inspection.receipt && inspection.mode === initialView) {
          assertArtifactReceiptVersion(
            inspection,
            inspection.receipt,
            inspection.mode === "diff" ? "identity" : "content",
          );
          if (isCurrent()) {
            if (inspection.mode === "diff") setDiff(inspection.receipt);
            else setPreview(inspection.receipt);
          }
          return;
        }
        if (initialView === "diff") {
          const receipt = await previewDiff(
            inspection.threadId,
            inspection.planId,
            inspection.artifact.id,
          );
          assertArtifactReceiptVersion(inspection, receipt);
          if (isCurrent()) setDiff(receipt);
        } else {
          const receipt = await requestArtifactPreview(
            inspection,
            previewArtifact,
            previewArtifactFile,
          );
          if (isCurrent()) setPreview(receipt);
        }
        if (!isCurrent()) return;
        await onLedgerChangedRef.current?.();
      } catch (reason) {
        if (isCurrent()) setError(formatApiErrorMessage(reason));
      } finally {
        if (isCurrent()) setLoadingView(undefined);
      }
    })();
    return invalidate;
  }, [
    inspection,
    previewArtifact,
    previewArtifactFile,
    previewDiff,
    initialView,
  ]);

  const load = async (nextView: ArtifactInspectorView, force = false) => {
    if (loadingView) return;
    if (!supportsText && nextView !== "preview") return;
    const cached = nextView === "diff" ? diff : preview;
    if (!force && cached) {
      setView(nextView);
      return;
    }
    const generation = ++generationRef.current;
    const isCurrent = () =>
      generation === generationRef.current &&
      inspectionRef.current === inspection;
    setLoadingView(nextView);
    setError(undefined);
    try {
      if (nextView === "diff") {
        const receipt = await previewDiff(
          inspection.threadId,
          inspection.planId,
          inspection.artifact.id,
        );
        assertArtifactReceiptVersion(inspection, receipt);
        if (!isCurrent()) return;
        setDiff(receipt);
      } else {
        const receipt = await requestArtifactPreview(
          inspection,
          previewArtifact,
          previewArtifactFile,
        );
        if (!isCurrent()) return;
        setPreview(receipt);
      }
      setView(nextView);
      await onLedgerChangedRef.current?.();
    } catch (reason) {
      if (isCurrent()) setError(formatApiErrorMessage(reason));
    } finally {
      if (isCurrent()) setLoadingView(undefined);
    }
  };

  const currentState = stateInspection === inspection;
  return {
    diff: currentState ? diff : undefined,
    error: currentState ? error : undefined,
    load,
    loadingView: currentState ? loadingView : initialView,
    preview: currentState ? preview : undefined,
    supportsText,
    view: currentState ? view : initialView,
  };
}
