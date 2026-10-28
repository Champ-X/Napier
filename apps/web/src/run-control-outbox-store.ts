import type {
  RunControlMessage,
  RunControlMessageMode,
} from "@napier/contracts";

export type OutboxState =
  | "sending"
  | "uncertain"
  | "failed"
  | RunControlMessage["status"];
export interface ControlOutboxEntry {
  schemaVersion: 1;
  workspaceKey: string;
  threadId: string;
  runId: string;
  id: string;
  clientMessageId?: string;
  text?: string;
  mode: RunControlMessageMode;
  createdAt: string;
  state: OutboxState;
  receipt?: RunControlMessage;
  error?: string | undefined;
  cancelRequested?: boolean | undefined;
  edit?:
    | { text: string; mode: RunControlMessageMode; replacementId: string }
    | undefined;
}

export const CONTROL_OUTBOX_PREFIX = "napier.control-outbox.v1:";
const storageKey = (
  entry: Pick<ControlOutboxEntry, "workspaceKey" | "threadId" | "id">,
) =>
  CONTROL_OUTBOX_PREFIX +
  JSON.stringify([entry.workspaceKey, entry.threadId, entry.id]);

/** One key per identity: independent sends from different tabs cannot replace
 * an entire thread's outbox. Pending entries are never evicted automatically. */
export class ControlOutboxStore {
  private readonly entries = new Map<string, ControlOutboxEntry>();
  private readonly loaded = new Set<string>();
  private readonly unavailable = new Set<string>();
  constructor(
    private readonly storage: () => Pick<
      Storage,
      "length" | "key" | "getItem" | "setItem"
    >,
    private readonly changed: () => void,
  ) {}

  list(workspaceKey: string, threadId: string): ControlOutboxEntry[] {
    const scope = JSON.stringify([workspaceKey, threadId]);
    if (!this.loaded.has(scope)) {
      this.loaded.add(scope);
      try {
        const storage = this.storage();
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (!key?.startsWith(CONTROL_OUTBOX_PREFIX)) continue;
          const identity: unknown = JSON.parse(
            key.slice(CONTROL_OUTBOX_PREFIX.length),
          );
          if (
            !Array.isArray(identity) ||
            identity[0] !== workspaceKey ||
            identity[1] !== threadId
          )
            continue;
          const entry: unknown = JSON.parse(storage.getItem(key) ?? "null");
          if (!isEntry(entry) || storageKey(entry) !== key)
            throw new Error("Invalid outbox record");
          this.entries.set(key, {
            ...entry,
            state: entry.state === "sending" ? "uncertain" : entry.state,
          });
        }
      } catch {
        this.unavailable.add(scope);
      }
    }
    return [...this.entries.values()]
      .filter(
        (entry) =>
          entry.workspaceKey === workspaceKey && entry.threadId === threadId,
      )
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      );
  }

  get(entry: ControlOutboxEntry): ControlOutboxEntry {
    return this.entries.get(storageKey(entry)) ?? entry;
  }

  /** Required writes precede every mutation request. On quota/access failure,
   * keep the user's composer/editor unchanged and send nothing. */
  save(entry: ControlOutboxEntry, required = false): boolean {
    const scope = JSON.stringify([entry.workspaceKey, entry.threadId]);
    try {
      this.storage().setItem(storageKey(entry), JSON.stringify(entry));
      this.unavailable.delete(scope);
    } catch {
      this.unavailable.add(scope);
      if (required) {
        this.changed();
        return false;
      }
    }
    const previous = this.entries.get(storageKey(entry));
    this.entries.set(storageKey(entry), entry);
    if (JSON.stringify(previous) !== JSON.stringify(entry)) this.changed();
    return true;
  }

  persistenceUnavailable(workspaceKey: string, threadId: string): boolean {
    return this.unavailable.has(JSON.stringify([workspaceKey, threadId]));
  }
}

function isEntry(value: unknown): value is ControlOutboxEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<ControlOutboxEntry>;
  const mode = (value: unknown) =>
    value === "steering" || value === "follow_up";
  return (
    entry.schemaVersion === 1 &&
    [
      entry.workspaceKey,
      entry.threadId,
      entry.runId,
      entry.id,
      entry.createdAt,
    ].every((value) => typeof value === "string" && value.length > 0) &&
    (entry.clientMessageId === undefined ||
      entry.clientMessageId === entry.id) &&
    (entry.text === undefined || typeof entry.text === "string") &&
    mode(entry.mode) &&
    [
      "sending",
      "uncertain",
      "failed",
      "queued",
      "delivered",
      "cancelled",
    ].includes(entry.state ?? "") &&
    (entry.error === undefined || typeof entry.error === "string") &&
    (entry.cancelRequested === undefined ||
      typeof entry.cancelRequested === "boolean") &&
    (!entry.edit ||
      (typeof entry.edit.text === "string" &&
        mode(entry.edit.mode) &&
        typeof entry.edit.replacementId === "string")) &&
    validReceipt(entry)
  );
}

function validReceipt(entry: Partial<ControlOutboxEntry>): boolean {
  const receipt = entry.receipt;
  return (
    !receipt ||
    (receipt.threadId === entry.threadId &&
      receipt.runId === entry.runId &&
      receipt.clientMessageId === entry.clientMessageId &&
      receipt.mode === entry.mode &&
      typeof receipt.id === "string" &&
      ["queued", "delivered", "cancelled"].includes(receipt.status))
  );
}
