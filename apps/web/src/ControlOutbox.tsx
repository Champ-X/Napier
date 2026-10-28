import { useId, useRef } from "react";
import type { useRunControlOutbox } from "./use-run-control-outbox";
import type { ControlOutboxEntry } from "./run-control-outbox-store";
import { controlOutboxCopy as copy } from "./run-control-outbox-copy";
import "./control-outbox.css";

export interface ControlOutboxProps {
  outbox: ReturnType<typeof useRunControlOutbox>;
}
export function ControlOutbox({ outbox }: ControlOutboxProps) {
  if (!outbox.entries.length && !outbox.persistenceUnavailable) return null;
  return (
    <aside className="control-outbox" aria-label={copy.title}>
      {outbox.persistenceUnavailable ? (
        <p role="alert">{copy.unavailable}</p>
      ) : null}
      {outbox.entries.length ? (
        <details open>
          <summary>
            {copy.title} ({outbox.entries.length})
          </summary>
          <p className="control-outbox-hint">{copy.hint}</p>
          <ol>
            {outbox.entries.map((entry) => (
              <ControlOutboxRow key={entry.id} entry={entry} outbox={outbox} />
            ))}
          </ol>
        </details>
      ) : null}
    </aside>
  );
}

interface ControlOutboxRowProps extends ControlOutboxProps {
  entry: ControlOutboxEntry;
}
function ControlOutboxRow({ entry, outbox }: ControlOutboxRowProps) {
  const id = useId();
  const status = useRef<HTMLParagraphElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const actions = outbox.actions;
  if (!actions) return null;
  const busy = actions.busy.has(entry.id);
  const replaced = Boolean(
    entry.edit &&
    outbox.entries.some((item) => item.id === entry.edit?.replacementId),
  );
  const canEdit = entry.state === "cancelled" && entry.edit && !replaced;
  async function act(action: () => Promise<void>) {
    const previous = document.activeElement;
    await action();
    requestAnimationFrame(() => {
      if (
        document.activeElement === previous ||
        document.activeElement === document.body
      )
        (editor.current ?? status.current)?.focus();
    });
  }
  return (
    <li data-message-id={entry.id} aria-busy={busy}>
      <p
        className="control-outbox-state"
        ref={status}
        tabIndex={-1}
        role="status"
        aria-atomic="true"
      >
        <strong>{copy[entry.mode]}</strong>
        <span>
          {entry.cancelRequested ? copy.cancelling : copy[entry.state]}
        </span>
      </p>
      <pre id={`${id}-text`}>{entry.text ?? copy.unknownText}</pre>
      {entry.state === "cancelled" ? <p>{copy.cancelledHint}</p> : null}
      {entry.state === "delivered" && entry.edit ? <p>{copy.race}</p> : null}
      {entry.error ? (
        <p id={`${id}-error`} className="control-outbox-error">
          {entry.error === copy.invalid ? copy.invalid : copy.failure}
        </p>
      ) : null}
      <ControlOutboxButtons
        entry={entry}
        outbox={outbox}
        act={act}
        textId={`${id}-text`}
      />
      {canEdit && entry.edit ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void act(() => actions.replace(entry));
          }}
        >
          <p id={`${id}-hint`}>{copy.editHint}</p>
          <label htmlFor={`${id}-editor`}>{copy.editing}</label>
          <textarea
            ref={editor}
            id={`${id}-editor`}
            required
            aria-invalid={entry.error === copy.invalid || undefined}
            aria-describedby={`${id}-hint${entry.error ? ` ${id}-error` : ""}`}
            value={entry.edit.text}
            disabled={busy}
            onChange={(event) =>
              actions.updateEdit(
                entry,
                event.currentTarget.value,
                entry.edit!.mode,
              )
            }
          />
          <label htmlFor={`${id}-mode`}>{copy.mode}</label>
          <select
            id={`${id}-mode`}
            value={entry.edit.mode}
            disabled={busy}
            onChange={(event) =>
              actions.updateEdit(
                entry,
                entry.edit!.text,
                event.currentTarget.value === "follow_up"
                  ? "follow_up"
                  : "steering",
              )
            }
          >
            <option value="steering">{copy.steering}</option>
            <option value="follow_up">{copy.follow_up}</option>
          </select>
          <div className="control-outbox-actions">
            <button type="submit" disabled={busy}>
              {copy.replacement}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                actions.discardEdit(entry);
                status.current?.focus();
              }}
            >
              {copy.abandonEdit}
            </button>
          </div>
        </form>
      ) : null}
      {replaced ? <p>{copy.savedReplacement}</p> : null}
      <details className="control-outbox-details">
        <summary>{copy.details}</summary>
        <dl>
          <dt>{copy.originalRun}</dt>
          <dd>{entry.runId}</dd>
          <dt>{copy.identity}</dt>
          <dd>{entry.clientMessageId ?? entry.receipt?.id}</dd>
        </dl>
        {entry.error ? <pre>{entry.error}</pre> : null}
      </details>
    </li>
  );
}

function ControlOutboxButtons({
  entry,
  outbox,
  act,
  textId,
}: ControlOutboxRowProps & {
  act(action: () => Promise<void>): Promise<void>;
  textId: string;
}) {
  const actions = outbox.actions;
  if (!actions) return null;
  const busy = actions.busy.has(entry.id);
  const pending = !["delivered", "cancelled"].includes(entry.state);
  return (
    <div className="control-outbox-actions">
      {pending ? (
        <button
          type="button"
          aria-describedby={textId}
          disabled={busy}
          onClick={() => void act(() => actions.refresh())}
        >
          {copy.refresh}
        </button>
      ) : null}
      {pending &&
      entry.clientMessageId &&
      entry.text !== undefined &&
      !entry.receipt &&
      !entry.cancelRequested ? (
        <button
          type="button"
          aria-describedby={textId}
          disabled={busy}
          onClick={() => void act(() => actions.retry(entry))}
        >
          {copy.retry}
        </button>
      ) : null}
      {pending && (entry.receipt || entry.cancelRequested) ? (
        <button
          type="button"
          aria-describedby={textId}
          disabled={busy}
          onClick={() => void act(() => actions.cancel(entry))}
        >
          {copy.cancel}
        </button>
      ) : null}
      {entry.state === "queued" && entry.text !== undefined && !entry.edit ? (
        <button
          type="button"
          aria-describedby={textId}
          disabled={busy}
          onClick={() => void act(() => actions.cancel(entry, true))}
        >
          {copy.edit}
        </button>
      ) : null}
    </div>
  );
}
