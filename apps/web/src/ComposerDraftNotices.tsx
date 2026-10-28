import { composerDraftCopy as copy } from "./composer-draft-copy";
import type { useThreadComposer } from "./use-thread-composer";
import "./composer-draft-notices.css";

export interface ComposerDraftNoticesProps {
  vm: Pick<
    ReturnType<typeof useThreadComposer>,
    | "composerPersistenceUnavailable"
    | "recoveredComposerDrafts"
    | "recoverComposerDraft"
    | "discardRecoveredComposerDraft"
  >;
}
export function ComposerDraftNotices({ vm }: ComposerDraftNoticesProps) {
  if (!vm.composerPersistenceUnavailable && !vm.recoveredComposerDrafts.length)
    return null;
  return (
    <aside className="composer-draft-notices">
      {vm.composerPersistenceUnavailable ? (
        <p role="alert">{copy.unavailable}</p>
      ) : null}
      {vm.recoveredComposerDrafts.length ? (
        <details open>
          <summary>
            {copy.recovered} ({vm.recoveredComposerDrafts.length})
          </summary>
          <p>{copy.hint}</p>
          <ul>
            {vm.recoveredComposerDrafts.map((text) => (
              <li key={text}>
                <pre>{text}</pre>
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      vm.recoverComposerDraft(text);
                      focusComposer();
                    }}
                  >
                    {copy.restore}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      vm.discardRecoveredComposerDraft(text);
                      focusComposer();
                    }}
                  >
                    {copy.discard}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </aside>
  );
}

function focusComposer(): void {
  document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus();
}
