const STORAGE_PREFIX = "napier.prompt-request-draft:";

export type PromptRequestDraft = {
  fingerprint: string;
  requestId: string;
};

function storageKey(workspaceKey: string, threadId: string): string {
  return `${STORAGE_PREFIX}${JSON.stringify([workspaceKey, threadId])}`;
}

export function readPromptRequestDraft(
  workspaceKey: string | undefined,
  threadId: string | undefined,
  storage: Storage | undefined = typeof window === "undefined"
    ? undefined
    : window.sessionStorage,
): PromptRequestDraft | null {
  if (!workspaceKey || !threadId || !storage) return null;
  try {
    const raw = storage.getItem(storageKey(workspaceKey, threadId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PromptRequestDraft>;
    if (
      typeof parsed.fingerprint !== "string" ||
      typeof parsed.requestId !== "string" ||
      !parsed.fingerprint ||
      !parsed.requestId
    ) {
      return null;
    }
    return { fingerprint: parsed.fingerprint, requestId: parsed.requestId };
  } catch {
    return null;
  }
}

export function writePromptRequestDraft(
  workspaceKey: string | undefined,
  threadId: string | undefined,
  draft: PromptRequestDraft,
  storage: Storage | undefined = typeof window === "undefined"
    ? undefined
    : window.sessionStorage,
): void {
  if (!workspaceKey || !threadId || !storage) return;
  try {
    storage.setItem(storageKey(workspaceKey, threadId), JSON.stringify(draft));
  } catch {
    // Quota or privacy mode: keep in-memory retry only.
  }
}

export function clearPromptRequestDraft(
  workspaceKey: string | undefined,
  threadId: string | undefined,
  storage: Storage | undefined = typeof window === "undefined"
    ? undefined
    : window.sessionStorage,
): void {
  if (!workspaceKey || !threadId || !storage) return;
  try {
    storage.removeItem(storageKey(workspaceKey, threadId));
  } catch {
    // Ignore persistence failures on clear.
  }
}
