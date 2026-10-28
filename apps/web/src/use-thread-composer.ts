import { useRef, useState, type SetStateAction } from "react";
import type { RunControlMessageMode } from "@napier/contracts";
import type { ComposerImageAttachment } from "./composer-image-attachments";
import { ThreadComposerDrafts } from "./thread-composer-drafts";

export function useThreadComposer(
  workspaceKey: string | undefined,
  threadId: string | undefined,
) {
  const [drafts] = useState(
    () => new ThreadComposerDrafts(() => window.localStorage),
  );
  const [, redraw] = useState(0);
  const key =
    workspaceKey && threadId
      ? JSON.stringify([workspaceKey, threadId])
      : undefined;
  const scope = useRef({ key, generation: 0 });
  if (scope.current.key !== key)
    scope.current = { key, generation: scope.current.generation + 1 };
  const generation = scope.current.generation;
  const [images, setImages] = useState({
    generation,
    value: [] as ComposerImageAttachment[],
  });
  const draft = key ? drafts.read(key) : undefined;
  const update = (
    change: (current: NonNullable<typeof draft>) => NonNullable<typeof draft>,
  ) => {
    if (key) {
      drafts.update(key, change);
      redraw((revision) => revision + 1);
    }
  };
  const setComposer = (value: SetStateAction<string>) =>
    update((current) => ({
      ...current,
      text: typeof value === "function" ? value(current.text) : value,
    }));
  return {
    composer: draft?.text ?? "",
    controlMessageMode: draft?.mode ?? "steering",
    setComposer,
    setControlMessageMode: (mode: RunControlMessageMode) =>
      update((current) => ({ ...current, mode })),
    composerImages: images.generation === generation ? images.value : [],
    setComposerImages: (value: SetStateAction<ComposerImageAttachment[]>) => {
      // A delayed file read or send failure must not restore another view's images.
      if (scope.current.generation !== generation || !key) return;
      setImages((current) => ({
        generation,
        value:
          typeof value === "function"
            ? value(current.generation === generation ? current.value : [])
            : value,
      }));
    },
    restoreComposer: (text: string) => {
      if (key) {
        drafts.restore(key, text);
        redraw((revision) => revision + 1);
      }
    },
    recoveredComposerDrafts: draft?.recovered ?? [],
    recoverComposerDraft: (text: string) => {
      if (key) {
        drafts.recover(key, text);
        redraw((revision) => revision + 1);
      }
    },
    discardRecoveredComposerDraft: (text: string) =>
      update((current) => ({
        ...current,
        recovered: current.recovered.filter((item) => item !== text),
      })),
    composerPersistenceUnavailable: Boolean(
      key && drafts.persistenceUnavailable(key),
    ),
  };
}
