const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;

export function threadIdFromLocation(
  location: Pick<Location, "href"> = window.location,
): string | undefined {
  const value = new URL(location.href).searchParams.get("thread");
  return value && THREAD_ID.test(value) ? value : undefined;
}

export function replaceThreadLocation(
  threadId: string | undefined,
  location: Pick<Location, "href"> = window.location,
  history: Pick<History, "replaceState"> = window.history,
): void {
  const url = new URL(location.href);
  if (threadId && THREAD_ID.test(threadId)) {
    url.searchParams.set("thread", threadId);
  } else {
    url.searchParams.delete("thread");
  }
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function commitThreadLocation(
  setSelectedThreadId: (threadId: string | undefined) => void,
  threadId: string | undefined,
  location?: Pick<Location, "href">,
  history?: Pick<History, "replaceState">,
): void {
  setSelectedThreadId(threadId);
  replaceThreadLocation(threadId, location, history);
}
