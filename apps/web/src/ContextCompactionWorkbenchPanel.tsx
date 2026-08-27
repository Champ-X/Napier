import type { ContextCompactionPreview } from "@napier/contracts/context-compaction";
import { Check, GitFork, ScanText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { formatApiErrorMessage } from "./api-error";
import {
  applyContextCompactionFork,
  previewContextCompaction,
} from "./context-compaction-api";
import { copy } from "./copy";
import type { SelectedModelAvailability } from "./model-selection-view-model";

const RETAINED_MESSAGE_OPTIONS = [2, 4, 6, 8, 10, 12, 16, 20, 24];

export function ContextCompactionWorkbenchPanel({
  threadId,
  threadTitle,
  messageCount,
  model,
  running,
  onOpenThread,
  onRefresh,
  previewRequest = previewContextCompaction,
  applyRequest = applyContextCompactionFork,
}: {
  threadId?: string;
  threadTitle?: string;
  messageCount: number;
  model: SelectedModelAvailability;
  running: boolean;
  onOpenThread(threadId: string): void | Promise<void>;
  onRefresh(): Promise<void>;
  previewRequest?: typeof previewContextCompaction;
  applyRequest?: typeof applyContextCompactionFork;
}) {
  const text = copy.settingsSurface.contextCompaction;
  const availableRetainedCounts = useMemo(
    () => RETAINED_MESSAGE_OPTIONS.filter((count) => count < messageCount),
    [messageCount],
  );
  const [retainedMessageCount, setRetainedMessageCount] = useState(10);
  const [preview, setPreview] = useState<ContextCompactionPreview>();
  const [forkTitle, setForkTitle] = useState("");
  const [busy, setBusy] = useState<"preview" | "apply">();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const preferred = availableRetainedCounts.includes(10)
      ? 10
      : availableRetainedCounts.at(-1);
    setRetainedMessageCount(preferred ?? 2);
    setPreview(undefined);
    setForkTitle("");
    setBusy(undefined);
    setError(undefined);
  }, [threadId, model.key, availableRetainedCounts.join("|")]);

  const unavailableReason = !threadId
    ? text.noThread
    : !model.configured
      ? text.modelUnavailable
      : availableRetainedCounts.length === 0
        ? text.notEnoughMessages
        : running
          ? text.runActive
          : undefined;

  async function generatePreview(): Promise<void> {
    if (!threadId || unavailableReason) return;
    setBusy("preview");
    setPreview(undefined);
    setForkTitle("");
    setError(undefined);
    try {
      const result = await previewRequest(threadId, {
        retainedMessageCount,
        model: { provider: model.provider, id: model.id },
      });
      setPreview(result);
      setForkTitle(
        `${threadTitle ?? text.untitledThread} / compacted`.slice(0, 100),
      );
      await onRefresh();
    } catch (cause) {
      setError(formatApiErrorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function applyFork(): Promise<void> {
    if (!threadId || !preview || busy) return;
    setBusy("apply");
    setError(undefined);
    try {
      const result = await applyRequest(threadId, {
        expectedPreviewSha256: preview.previewSha256,
        ...(forkTitle.trim() ? { title: forkTitle.trim() } : {}),
      });
      setPreview(undefined);
      await onOpenThread(result.targetThreadId);
    } catch (cause) {
      setError(formatApiErrorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section
      className="context-compaction-workbench"
      aria-labelledby="context-compaction-title"
    >
      <header className="context-compaction-heading">
        <div>
          <span>{text.eyebrow}</span>
          <h2 id="context-compaction-title">{text.title}</h2>
          <p>{text.body}</p>
        </div>
        <span className="context-compaction-safety">
          <GitFork size={14} aria-hidden="true" />
          {text.forkOnly}
        </span>
      </header>

      <div className="context-compaction-controls">
        <label>
          <span>{text.retainedMessages}</span>
          <select
            value={retainedMessageCount}
            disabled={Boolean(unavailableReason) || Boolean(busy)}
            onChange={(event) => {
              setRetainedMessageCount(Number(event.currentTarget.value));
              setPreview(undefined);
              setError(undefined);
            }}
          >
            {availableRetainedCounts.length > 0 ? (
              availableRetainedCounts.map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))
            ) : (
              <option value={2}>2</option>
            )}
          </select>
        </label>
        <div className="context-compaction-source">
          <span>{text.source}</span>
          <strong>
            {messageCount} {text.messages}
          </strong>
          <code title={model.key}>{model.key}</code>
        </div>
        <button
          id="context-compaction-preview-action"
          type="button"
          className="task-primary-action"
          disabled={Boolean(unavailableReason) || Boolean(busy)}
          aria-busy={busy === "preview"}
          onClick={() => void generatePreview()}
        >
          <ScanText size={15} aria-hidden="true" />
          {busy === "preview" ? text.previewing : text.previewAction}
        </button>
      </div>

      {unavailableReason ? (
        <p className="context-compaction-notice">{unavailableReason}</p>
      ) : null}
      {error ? (
        <p className="context-compaction-error" role="alert">
          {error}
        </p>
      ) : null}

      {preview ? (
        <div className="context-compaction-preview">
          <div className="context-compaction-preview-heading">
            <div>
              <span>{text.previewReady}</span>
              <strong>
                {preview.sourceMessageCount} {text.messagesCompacted}
              </strong>
            </div>
            <code title={preview.previewSha256}>
              {preview.previewSha256.slice(0, 12)}
            </code>
          </div>

          <section className="context-compaction-summary">
            <h3>{text.summary}</h3>
            <p>{preview.summary}</p>
          </section>

          <div className="context-compaction-ledgers">
            <PreviewList
              title={text.decisions}
              items={preview.decisions}
              empty={text.none}
            />
            <PreviewList
              title={text.openLoops}
              items={preview.openLoops}
              empty={text.none}
            />
            <PreviewList
              title={text.artifacts}
              items={preview.artifacts}
              empty={text.none}
            />
          </div>

          <dl className="context-compaction-evidence">
            <div>
              <dt>{text.range}</dt>
              <dd>
                {preview.fromSeq}–{preview.toSeq}
              </dd>
            </div>
            <div>
              <dt>{text.retainedFrom}</dt>
              <dd>#{preview.retainedFromSeq}</dd>
            </div>
            <div>
              <dt>{text.continuity}</dt>
              <dd>{preview.continuityEventCount}</dd>
            </div>
            <div>
              <dt>{text.sourceHash}</dt>
              <dd>
                <code title={preview.sourceEventSetSha256}>
                  {preview.sourceEventSetSha256.slice(0, 12)}
                </code>
              </dd>
            </div>
          </dl>

          <div className="context-compaction-apply">
            <label>
              <span>{text.forkTitle}</span>
              <input
                value={forkTitle}
                maxLength={100}
                disabled={Boolean(busy)}
                onChange={(event) => setForkTitle(event.currentTarget.value)}
              />
            </label>
            <button
              id="context-compaction-apply-action"
              type="button"
              className="context-compaction-apply-action"
              disabled={Boolean(busy)}
              aria-busy={busy === "apply"}
              onClick={() => void applyFork()}
            >
              <Check size={15} aria-hidden="true" />
              {busy === "apply" ? text.applying : text.applyAction}
            </button>
          </div>
          <p className="context-compaction-footnote">{text.applyNote}</p>
        </div>
      ) : null}
    </section>
  );
}

function PreviewList({
  title,
  items,
  empty,
}: {
  title: string;
  items: string[];
  empty: string;
}) {
  return (
    <section>
      <h3>{title}</h3>
      {items.length > 0 ? (
        <ul>
          {items.map((item, index) => (
            <li key={`${index}:${item}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>{empty}</p>
      )}
    </section>
  );
}
