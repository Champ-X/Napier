import type {
  QueueRunControlMessageRequest,
  RunControlMessage,
} from "@napier/contracts";
import { NapierApiError, formatApiErrorMessage, sha256Text } from "./api-error";
import { controlOutboxCopy as copy } from "./run-control-outbox-copy";
import {
  ControlOutboxStore,
  type ControlOutboxEntry,
} from "./run-control-outbox-store";

export interface ControlOutboxTransport {
  queue(
    threadId: string,
    runId: string,
    body: QueueRunControlMessageRequest,
  ): Promise<RunControlMessage>;
  cancel(
    threadId: string,
    runId: string,
    id: string,
  ): Promise<RunControlMessage>;
  load(threadId: string, runId: string): Promise<RunControlMessage[]>;
}

export class ControlOutboxActions {
  readonly busy = new Set<string>();
  private readonly refreshing = new Map<string, Promise<void>>();
  constructor(
    readonly workspaceKey: string,
    readonly threadId: string,
    private readonly store: ControlOutboxStore,
    private readonly transport: ControlOutboxTransport,
    private readonly currentWorkspace: () => boolean,
    private readonly changed: () => void,
  ) {}

  list() {
    return this.store.list(this.workspaceKey, this.threadId);
  }

  async enqueue(
    runId: string,
    body: QueueRunControlMessageRequest,
    onSaved: () => void = () => {},
  ): Promise<boolean> {
    if (!this.currentWorkspace() || !validText(body.text)) return false;
    const id = body.clientMessageId ?? crypto.randomUUID();
    const existing = this.list().find((entry) => entry.id === id);
    if (
      existing &&
      (existing.runId !== runId ||
        existing.mode !== body.mode ||
        existing.text !== body.text.trim())
    )
      throw new Error(copy.mismatch);
    const entry: ControlOutboxEntry = existing ?? {
      schemaVersion: 1,
      workspaceKey: this.workspaceKey,
      threadId: this.threadId,
      runId,
      id,
      clientMessageId: id,
      text: body.text.trim(),
      mode: body.mode,
      createdAt: new Date().toISOString(),
      state: "sending",
    };
    if (!this.store.save(entry, true)) return false;
    onSaved();
    await this.retry(entry);
    return true;
  }

  async observe(
    messages: RunControlMessage[],
    texts = new Map<string, string>(),
  ): Promise<void> {
    for (const receipt of messages) {
      if (receipt.threadId !== this.threadId) continue;
      const entry = this.list().find(
        (entry) =>
          entry.runId === receipt.runId &&
          (entry.receipt?.id === receipt.id ||
            (receipt.clientMessageId &&
              entry.clientMessageId === receipt.clientMessageId)),
      );
      const candidate =
        entry?.text === undefined ? texts.get(receipt.id) : undefined;
      const text =
        candidate !== undefined &&
        validText(candidate) &&
        (await sha256Text(candidate)) === receipt.textSha256
          ? candidate
          : undefined;
      const target = entry ?? {
        schemaVersion: 1 as const,
        workspaceKey: this.workspaceKey,
        threadId: this.threadId,
        runId: receipt.runId,
        id: receipt.clientMessageId ?? receipt.id,
        ...(receipt.clientMessageId
          ? { clientMessageId: receipt.clientMessageId }
          : {}),
        mode: receipt.mode,
        createdAt: receipt.queuedAt,
        state: receipt.status,
      };
      await this.accept(target, receipt);
      if (text !== undefined && this.store.get(target).text === undefined)
        this.store.save({ ...this.store.get(target), text });
    }
  }

  async refresh(runId?: string): Promise<void> {
    if (!this.currentWorkspace()) return;
    const runs = runId
      ? [runId]
      : [
          ...new Set(
            this.list()
              .filter(
                (entry) =>
                  !["cancelled", "delivered"].includes(entry.state) ||
                  entry.cancelRequested,
              )
              .map((entry) => entry.runId),
          ),
        ];
    await Promise.all(runs.map((id) => this.refreshRun(id)));
  }

  private refreshRun(runId: string): Promise<void> {
    const pending = this.refreshing.get(runId);
    if (pending) return pending;
    const refresh = (async () => {
      try {
        const messages = await this.transport.load(this.threadId, runId);
        if (!this.currentWorkspace()) return;
        await this.observe(
          messages.filter((receipt) => receipt.runId === runId),
        );
      } catch (error) {
        for (const entry of this.list().filter((item) => item.runId === runId))
          this.store.save({
            ...this.store.get(entry),
            error: formatApiErrorMessage(error),
          });
      } finally {
        this.refreshing.delete(runId);
      }
    })();
    this.refreshing.set(runId, refresh);
    return refresh;
  }

  retry(entry: ControlOutboxEntry): Promise<void> {
    return this.lock(entry, async () => {
      let current = this.store.get(entry);
      if (current.cancelRequested) {
        await this.withdraw(current);
        return;
      }
      if (current.receipt || !current.clientMessageId || !current.text) return;
      const { clientMessageId, text } = current;
      current = { ...current, state: "sending", error: undefined };
      if (!this.store.save(current, true)) return;
      try {
        await this.accept(
          current,
          await this.transport.queue(current.threadId, current.runId, {
            clientMessageId,
            mode: current.mode,
            text,
          }),
        );
      } catch (error) {
        const latest = this.store.get(current);
        this.store.save({
          ...latest,
          state:
            latest.receipt?.status ??
            (error instanceof NapierApiError &&
            error.status >= 400 &&
            error.status < 500
              ? "failed"
              : "uncertain"),
          error: formatApiErrorMessage(error),
        });
        await this.refresh(current.runId);
      }
    });
  }

  cancel(entry: ControlOutboxEntry, edit = false): Promise<void> {
    return this.lock(entry, async () => {
      const current = this.store.get(entry);
      if (current.state === "delivered") return;
      const next = {
        ...current,
        cancelRequested: true,
        ...(edit && current.text !== undefined && !current.edit
          ? {
              edit: {
                text: current.text,
                mode: current.mode,
                replacementId: crypto.randomUUID(),
              },
            }
          : {}),
      };
      if (!this.store.save(next, true)) return;
      await this.withdraw(next);
    });
  }

  updateEdit(
    entry: ControlOutboxEntry,
    text: string,
    mode: ControlOutboxEntry["mode"],
  ): void {
    const current = this.store.get(entry);
    if (current.edit)
      this.store.save({ ...current, edit: { ...current.edit, text, mode } });
  }

  discardEdit(entry: ControlOutboxEntry): void {
    this.store.save({ ...this.store.get(entry), edit: undefined });
  }

  replace(entry: ControlOutboxEntry): Promise<void> {
    return this.lock(entry, async () => {
      const current = this.store.get(entry);
      if (current.receipt?.status !== "cancelled" || !current.edit) return;
      if (!validText(current.edit.text)) {
        this.store.save({ ...current, error: copy.invalid });
        return;
      }
      await this.enqueue(current.runId, {
        clientMessageId: current.edit.replacementId,
        text: current.edit.text,
        mode: current.edit.mode,
      });
    });
  }

  private async withdraw(entry: ControlOutboxEntry): Promise<void> {
    await this.refresh(entry.runId);
    const current = this.store.get(entry);
    if (!this.currentWorkspace()) return;
    if (
      current.receipt?.status === "cancelled" ||
      current.receipt?.status === "delivered"
    )
      return;
    if (!current.receipt) {
      this.store.save({ ...current, error: copy.missing });
      return;
    }
    try {
      await this.accept(
        current,
        await this.transport.cancel(
          current.threadId,
          current.runId,
          current.receipt.id,
        ),
      );
    } catch (error) {
      this.store.save({
        ...this.store.get(current),
        error: formatApiErrorMessage(error),
      });
      await this.refresh(current.runId);
    }
  }

  private async accept(
    entry: ControlOutboxEntry,
    receipt: RunControlMessage,
  ): Promise<void> {
    if (
      receipt.threadId !== entry.threadId ||
      receipt.runId !== entry.runId ||
      receipt.clientMessageId !== entry.clientMessageId ||
      receipt.mode !== entry.mode ||
      (entry.text !== undefined &&
        receipt.textSha256 !== (await sha256Text(entry.text)))
    )
      throw new Error(copy.mismatch);
    const current = this.store.get(entry);
    // A delayed queue response or cached detail cannot roll a terminal receipt back.
    if (current.receipt && sequence(current.receipt) >= sequence(receipt)) {
      if (current.cancelRequested && current.receipt.status !== "queued")
        this.store.save({
          ...current,
          cancelRequested: false,
          error: undefined,
        });
      return;
    }
    this.store.save({
      ...current,
      receipt,
      state: receipt.status,
      error: undefined,
      cancelRequested:
        receipt.status === "queued" ? current.cancelRequested : false,
    });
  }

  private async lock(
    entry: ControlOutboxEntry,
    action: () => Promise<void>,
  ): Promise<void> {
    if (!this.currentWorkspace() || this.busy.has(entry.id)) return;
    this.busy.add(entry.id);
    this.changed();
    try {
      await action();
    } catch (error) {
      this.store.save({
        ...this.store.get(entry),
        error: formatApiErrorMessage(error),
      });
    } finally {
      this.busy.delete(entry.id);
      this.changed();
    }
  }
}

function sequence(receipt: RunControlMessage): number {
  return (
    receipt.cancellationEventSeq ??
    receipt.deliveredEventSeq ??
    receipt.queuedEventSeq
  );
}
export function validText(text: string): boolean {
  const bytes = new TextEncoder().encode(text.trim()).byteLength;
  return bytes > 0 && bytes <= 16 * 1024;
}
