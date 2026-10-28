import type { RunControlMessageMode } from "@napier/contracts";

export interface ThreadComposerDraft {
  schemaVersion: 1;
  text: string;
  mode: RunControlMessageMode;
  recovered: string[];
}

const empty = (): ThreadComposerDraft => ({
  schemaVersion: 1,
  text: "",
  mode: "steering",
  recovered: [],
});
export const COMPOSER_DRAFT_PREFIX = "napier.thread-composer.v1:";

/** Text and mode only. Attachments retain their existing in-memory lifecycle. */
export class ThreadComposerDrafts {
  private readonly drafts = new Map<string, ThreadComposerDraft>();
  private readonly unavailable = new Set<string>();
  constructor(
    private readonly storage: () => Pick<Storage, "getItem" | "setItem">,
  ) {}

  read(key: string): ThreadComposerDraft {
    const cached = this.drafts.get(key);
    if (cached) return cached;
    let value = empty();
    try {
      const raw = this.storage().getItem(COMPOSER_DRAFT_PREFIX + key);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (!isDraft(parsed)) throw new Error("Invalid draft");
        value = parsed;
      }
    } catch {
      this.unavailable.add(key);
    }
    this.drafts.set(key, value);
    return value;
  }

  update(
    key: string,
    change: (draft: ThreadComposerDraft) => ThreadComposerDraft,
  ): void {
    const next = change(this.read(key));
    this.drafts.set(key, next);
    try {
      this.storage().setItem(COMPOSER_DRAFT_PREFIX + key, JSON.stringify(next));
      this.unavailable.delete(key);
    } catch {
      this.unavailable.add(key);
    }
  }

  restore(key: string, text: string): void {
    this.update(key, (draft) =>
      !draft.text
        ? { ...draft, text }
        : draft.text === text || draft.recovered.includes(text)
          ? draft
          : { ...draft, recovered: [...draft.recovered, text] },
    );
  }

  recover(key: string, text: string): void {
    this.update(key, (draft) => ({
      ...draft,
      text,
      recovered: [
        ...draft.recovered.filter((item) => item !== text),
        ...(draft.text && draft.text !== text ? [draft.text] : []),
      ],
    }));
  }

  persistenceUnavailable(key: string): boolean {
    return this.unavailable.has(key);
  }
}

function isDraft(value: unknown): value is ThreadComposerDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<ThreadComposerDraft>;
  return (
    draft.schemaVersion === 1 &&
    typeof draft.text === "string" &&
    (draft.mode === "steering" || draft.mode === "follow_up") &&
    Array.isArray(draft.recovered) &&
    draft.recovered.every((text) => typeof text === "string")
  );
}
