const MAX_ACTIVE_BROWSER_LIVE_STREAMS = 8;

export class BrowserLiveViewStreamAdmission {
  private readonly active = new Set<string>();

  claim(threadId: string, runId: string): () => void {
    const key = `${threadId}\u0000${runId}`;
    if (this.active.has(key)) {
      throw new Error("Browser Live stream is already active for this Run");
    }
    if (this.active.size >= MAX_ACTIVE_BROWSER_LIVE_STREAMS) {
      throw new Error("Browser Live stream capacity is unavailable");
    }
    this.active.add(key);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active.delete(key);
    };
  }
}
