import { useState } from "react";

import { applySkillContent, previewSkillContent } from "./context-api";
import { contextCopy } from "./context-copy";
import {
  MAX_SKILL_CONTENT_FILE_BYTES,
  skillContentAppliedReason,
  toErrorMessage,
  utf8Size,
} from "./context-panel-helpers";
import type { SkillContentReceipt } from "./package-management-types";

export interface ContextSkillContentControllerInput {
  threadId: string;
  onError: (message: string | undefined) => void;
  onRefresh: () => Promise<void>;
}

export function useContextSkillContentController({
  threadId,
  onError,
  onRefresh,
}: ContextSkillContentControllerInput) {
  const [skillContentText, setSkillContentText] = useState("");
  const [skillContentBusy, setSkillContentBusy] = useState(false);
  const [skillContentReceipt, setSkillContentReceipt] =
    useState<SkillContentReceipt>();
  const [skillContentInstallConfirmed, setSkillContentInstallConfirmed] =
    useState(false);
  const [
    skillContentReplacementConfirmed,
    setSkillContentReplacementConfirmed,
  ] = useState(false);

  const updateSkillContentText = (value: string): void => {
    setSkillContentText(value);
    setSkillContentReceipt(undefined);
    setSkillContentInstallConfirmed(false);
    setSkillContentReplacementConfirmed(false);
  };
  const loadSkillContentFile = async (file: File): Promise<void> => {
    if (skillContentBusy) return;
    if (file.size > MAX_SKILL_CONTENT_FILE_BYTES) {
      onError(contextCopy.skillContentTooLarge);
      return;
    }
    onError(undefined);
    updateSkillContentText(await file.text());
  };
  const previewSkillContentDraft = async (): Promise<void> => {
    if (skillContentBusy) return;
    if (utf8Size(skillContentText) > MAX_SKILL_CONTENT_FILE_BYTES) {
      onError(contextCopy.skillContentTooLarge);
      return;
    }
    setSkillContentBusy(true);
    onError(undefined);
    try {
      const review = await previewSkillContent({
        threadId,
        content: skillContentText,
      });
      setSkillContentReceipt({
        action: "previewed",
        review,
        reason: contextCopy.skillContentReviewReady,
      });
      setSkillContentInstallConfirmed(false);
      setSkillContentReplacementConfirmed(false);
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setSkillContentBusy(false);
    }
  };
  const applySkillContentDraft = async (): Promise<void> => {
    const review = skillContentReceipt?.review;
    if (skillContentBusy) return;
    if (!review) {
      onError(contextCopy.skillContentNoReview);
      return;
    }
    if (review.action === "install" && !skillContentInstallConfirmed) {
      onError(contextCopy.skillContentInstallConfirmRequired);
      return;
    }
    if (review.action === "replace" && !skillContentReplacementConfirmed) {
      onError(contextCopy.skillContentReplacementConfirmRequired);
      return;
    }
    setSkillContentBusy(true);
    onError(undefined);
    try {
      const result = await applySkillContent({
        threadId,
        content: skillContentText,
        expectedReviewSha256: review.reviewSha256,
        ...(review.action === "install"
          ? { confirmInstall: skillContentInstallConfirmed }
          : {}),
        ...(review.action === "replace"
          ? { confirmReplacement: skillContentReplacementConfirmed }
          : {}),
      });
      setSkillContentReceipt({
        action: "applied",
        review: result.review,
        applied: result.applied,
        reason: skillContentAppliedReason(result.review, result.applied),
      });
      setSkillContentInstallConfirmed(false);
      setSkillContentReplacementConfirmed(false);
      await onRefresh();
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setSkillContentBusy(false);
    }
  };
  return {
    skillContentText,
    skillContentBusy,
    skillContentReceipt,
    skillContentInstallConfirmed,
    setSkillContentInstallConfirmed,
    skillContentReplacementConfirmed,
    setSkillContentReplacementConfirmed,
    updateSkillContentText,
    loadSkillContentFile,
    previewSkillContentDraft,
    applySkillContentDraft,
  };
}
