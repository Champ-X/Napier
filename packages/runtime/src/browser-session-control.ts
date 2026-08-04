import type { BrowserSessionPauseState } from "@napier/contracts/browser-session-control";

import type { AgentCapabilityRuntime } from "./agent-capability-runtime.js";
import type { BrowserSessionPauseManager } from "./browser-session-pause.js";
import type { LocalStore } from "./store.js";

interface BrowserSessionControlOwner {
  threadId: string;
  runId: string;
}

export class BrowserSessionControlService {
  constructor(
    private readonly store: LocalStore,
    private readonly sessions: Pick<
      AgentCapabilityRuntime,
      "hasActiveBrowserSession"
    >,
    private readonly pauses: BrowserSessionPauseManager,
  ) {}

  async state(
    threadId: string,
    runId: string,
  ): Promise<BrowserSessionPauseState> {
    const owner = await this.authorize(threadId, runId);
    return this.pauses.state(owner);
  }

  async pause(
    threadId: string,
    runId: string,
  ): Promise<BrowserSessionPauseState> {
    const owner = await this.authorize(threadId, runId);
    const state = await this.pauses.pause(owner);
    try {
      await this.authorize(threadId, runId);
      return state;
    } catch (error) {
      await this.pauses.cancelRun(owner);
      throw error;
    }
  }

  async resume(
    threadId: string,
    runId: string,
    expectedPauseStateSha256: string,
  ): Promise<BrowserSessionPauseState> {
    const owner = await this.authorize(threadId, runId);
    return await this.pauses.resume(owner, expectedPauseStateSha256);
  }

  private async authorize(
    threadId: string,
    runId: string,
  ): Promise<BrowserSessionControlOwner> {
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
      throw new Error("Browser Session control requires the active user Run");
    }
    const owner = { threadId, runId };
    if (!this.sessions.hasActiveBrowserSession(owner)) {
      throw new Error("Browser Session is not active for this Run");
    }
    return owner;
  }
}
