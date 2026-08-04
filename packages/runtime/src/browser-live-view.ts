import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";

import type { AgentCapabilityRuntime } from "./agent-capability-runtime.js";
import type { LocalStore } from "./store.js";

export class BrowserLiveViewService {
  constructor(
    private readonly store: LocalStore,
    private readonly capabilities: Pick<
      AgentCapabilityRuntime,
      "captureBrowserLiveView"
    >,
  ) {}

  async capture(
    threadId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<{ image: Buffer; receipt: BrowserLiveViewReceipt }> {
    const thread = this.store.getThread(threadId);
    const run = this.store
      .listRuns(threadId)
      .find((candidate) => candidate.id === runId);
    if (
      !run ||
      run.source !== "user" ||
      run.status !== "running" ||
      thread.currentRunId !== run.id
    ) {
      throw new Error("Browser live view requires the active user Run");
    }
    return await this.capabilities.captureBrowserLiveView(
      { threadId, runId },
      signal,
    );
  }
}
