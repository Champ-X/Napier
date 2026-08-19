import { workspaceProcessCopy as copy } from "./workspace-process-copy";
import type {
  WorkspaceProcessCardView,
  WorkspaceProcessPanelState,
  WorkspaceProcessSession,
} from "./workspace-process-card-types";

export interface WorkspaceProcessInputProps {
  state: WorkspaceProcessPanelState;
  card: WorkspaceProcessCardView;
  session: WorkspaceProcessSession;
}

export function WorkspaceProcessInput({
  state,
  card,
  session,
}: WorkspaceProcessInputProps) {
  if (!card.running || card.stdinState !== "open") return null;
  const draft = state.inputDrafts[card.id] ?? "";
  const busy = state.inputBusy?.processId === card.id;
  return (
    <form
      className="process-input"
      onSubmit={(event) => {
        event.preventDefault();
        void state.sendInput(card.id, "send");
      }}
    >
      <label htmlFor={`process-input-${card.id}`}>{copy.inputLabel}</label>
      <textarea
        id={`process-input-${card.id}`}
        value={draft}
        maxLength={32 * 1024}
        rows={3}
        disabled={busy}
        placeholder={copy.inputPlaceholder}
        onChange={(event) =>
          state.setInputDrafts((current) => ({
            ...current,
            [card.id]: event.currentTarget.value,
          }))
        }
      />
      <small>
        {session.ioMode === "pty" ? copy.ptyInputSafety : copy.inputSafety}
      </small>
      <div>
        <button
          type="submit"
          className="secondary-button"
          disabled={busy || draft.length === 0}
        >
          {busy && state.inputBusy?.action === "send"
            ? copy.sendingInput
            : copy.sendInput}
        </button>
        {card.stdinCanClose ? (
          <button
            type="button"
            className="secondary-button danger"
            disabled={busy}
            onClick={() => void state.sendInput(card.id, "close")}
          >
            {busy && state.inputBusy?.action === "close"
              ? copy.closingInput
              : copy.closeInput}
          </button>
        ) : null}
      </div>
    </form>
  );
}
