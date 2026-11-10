import { useRef } from "react";
import type { ModelRef, ThreadDetail, StreamFrame } from "@napier/contracts";
import type { AgentCapabilityPresetId } from "@napier/contracts/agent-capabilities";
import type { NextRunPromptInput } from "./next-run-capability-preset-execution";
import type { useThreadComposer } from "./use-thread-composer";
import { useRunControlOutbox } from "./use-run-control-outbox";
import { promptImagesFromAttachments } from "./composer-image-attachments";
import { validText } from "./run-control-outbox-actions";
import { controlOutboxCopy } from "./run-control-outbox-copy";

export function useThreadSubmission(input: {
  workspaceKey: string | undefined;
  threadId: string | undefined;
  detail: ThreadDetail | undefined;
  composer: ReturnType<typeof useThreadComposer>;
  activeRunId: string | undefined;
  isRunning: boolean;
  blocked: boolean;
  modelConfigured: boolean;
  modelUnavailableHint: string;
  model: ModelRef;
  capabilityPreset: AgentCapabilityPresetId | undefined;
  execute(input: NextRunPromptInput): Promise<void>;
  onStart(threadId: string, detail: ThreadDetail): void;
  onFinish(threadId: string): void;
  onRefresh(threadId: string): Promise<void>;
  onError(threadId: string, error: unknown): void;
  onFrame(threadId: string): (frame: StreamFrame) => void;
  setError(error: string | undefined): void;
}) {
  const controlOutbox = useRunControlOutbox(input);
  const submitting = useRef(new Set<string>());
  const pendingPrompt = useRef<{ fingerprint: string; requestId: string } | null>(
    null,
  );
  const submit = async (override?: string) => {
    const draft = input.composer;
    const text = (override ?? draft.composer).trim();
    const detail = input.detail;
    if (
      !text ||
      !detail ||
      detail.thread.id !== input.threadId ||
      input.blocked
    )
      return;
    const threadId = detail.thread.id;
    const key = JSON.stringify([
      input.workspaceKey,
      threadId,
      input.isRunning ? input.activeRunId : "prompt",
      text,
    ]);
    if (submitting.current.has(key)) return;
    submitting.current.add(key);
    try {
      if (input.isRunning) {
        if (!input.activeRunId || !controlOutbox.actions) return;
        if (!validText(text)) {
          input.onError(threadId, new Error(controlOutboxCopy.invalid));
          return;
        }
        await controlOutbox.actions.enqueue(
          input.activeRunId,
          { mode: draft.controlMessageMode, text },
          () => {
            draft.setComposer("");
            input.setError(undefined);
          },
        );
        return;
      }
      if (!input.modelConfigured) {
        input.setError(input.modelUnavailableHint);
        return;
      }
      const imageAttachments = draft.composerImages;
      const images = promptImagesFromAttachments(imageAttachments);
      const fingerprint = JSON.stringify([
        input.workspaceKey,
        threadId,
        text,
        imageAttachments.map((image) => image.id),
      ]);
      const pending = pendingPrompt.current;
      const requestId =
        pending?.fingerprint === fingerprint
          ? pending.requestId
          : crypto.randomUUID();
      pendingPrompt.current = { fingerprint, requestId };
      draft.setComposer("");
      draft.setComposerImages([]);
      await input.execute({
        threadId,
        text,
        requestId,
        ...(images ? { images } : {}),
        model: input.model,
        ...(input.capabilityPreset
          ? { capabilityPreset: input.capabilityPreset }
          : {}),
        onStart: () => input.onStart(threadId, detail),
        onRefresh: () => input.onRefresh(threadId),
        onError: (error) => input.onError(threadId, error),
        restoreInput: draft.restoreComposer,
        restoreImages: () => draft.setComposerImages(imageAttachments),
        onFinish: () => {
          if (pendingPrompt.current?.requestId === requestId) {
            pendingPrompt.current = null;
          }
          input.onFinish(threadId);
        },
        onFrame: input.onFrame(threadId),
      });
    } finally {
      submitting.current.delete(key);
    }
  };
  return { submit, controlOutbox };
}
export { useThreadRecovery } from "./use-thread-recovery";
