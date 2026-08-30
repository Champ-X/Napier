import { useEffect, useRef, useState } from "react";

import { formatApiErrorMessage } from "./api-error";
import type { ArtifactInspection } from "./artifact-inspection";
import {
  previewPlanArtifactDiff,
  previewPlanArtifactText,
  type PlanArtifactDiffPreviewReceipt,
  type PlanArtifactTextPreview,
  type PlanArtifactTextPreviewReceipt,
} from "./artifact-file-api";

export type ArtifactInspectorView = "preview" | "source" | "diff";

export function useArtifactInspectorView({
  inspection,
  onLedgerChanged,
  previewArtifact,
  previewDiff,
}: {
  inspection: ArtifactInspection;
  onLedgerChanged?: () => void | Promise<void>;
  previewArtifact: typeof previewPlanArtifactText;
  previewDiff: typeof previewPlanArtifactDiff;
}) {
  const [view, setView] = useState<ArtifactInspectorView>(inspection.mode);
  const [loadingView, setLoadingView] = useState<ArtifactInspectorView>();
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<
    PlanArtifactTextPreview | PlanArtifactTextPreviewReceipt | undefined
  >(inspection.mode === "preview" ? inspection.receipt : undefined);
  const [diff, setDiff] = useState<PlanArtifactDiffPreviewReceipt | undefined>(
    inspection.mode === "diff" ? inspection.receipt : undefined,
  );
  const onLedgerChangedRef = useRef(onLedgerChanged);
  onLedgerChangedRef.current = onLedgerChanged;

  useEffect(() => {
    setView(inspection.mode);
    setPreview(inspection.mode === "preview" ? inspection.receipt : undefined);
    setDiff(inspection.mode === "diff" ? inspection.receipt : undefined);
    setError(undefined);
    if (inspection.receipt) return;
    let active = true;
    setLoadingView(inspection.mode);
    void (async () => {
      try {
        if (inspection.mode === "diff") {
          const receipt = await previewDiff(
            inspection.threadId,
            inspection.planId,
            inspection.artifact.id,
          );
          if (active) setDiff(receipt);
        } else {
          const receipt = await previewArtifact(
            inspection.threadId,
            inspection.planId,
            inspection.artifact.id,
          );
          if (active) setPreview(receipt);
        }
        if (!active) return;
        await onLedgerChangedRef.current?.();
      } catch (reason) {
        if (active) setError(formatApiErrorMessage(reason));
      } finally {
        if (active) setLoadingView(undefined);
      }
    })();
    return () => {
      active = false;
    };
  }, [inspection, previewArtifact, previewDiff]);

  const load = async (nextView: ArtifactInspectorView, force = false) => {
    if (loadingView) return;
    const cached = nextView === "diff" ? diff : preview;
    if (!force && cached) {
      setView(nextView);
      return;
    }
    setLoadingView(nextView);
    setError(undefined);
    try {
      if (nextView === "diff") {
        setDiff(
          await previewDiff(
            inspection.threadId,
            inspection.planId,
            inspection.artifact.id,
          ),
        );
      } else {
        setPreview(
          await previewArtifact(
            inspection.threadId,
            inspection.planId,
            inspection.artifact.id,
          ),
        );
      }
      setView(nextView);
      await onLedgerChangedRef.current?.();
    } catch (reason) {
      setError(formatApiErrorMessage(reason));
    } finally {
      setLoadingView(undefined);
    }
  };

  return { diff, error, load, loadingView, preview, view };
}
