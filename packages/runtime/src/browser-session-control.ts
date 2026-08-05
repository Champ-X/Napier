import type { BrowserSessionPauseState } from "@napier/contracts/browser-session-control";
import type {
  BrowserTakeoverActionReceipt,
  BrowserTakeoverSnapshot,
  ExecuteBrowserTakeoverActionRequest,
} from "@napier/contracts/browser-takeover";

import type { AgentCapabilityRuntime } from "./agent-capability-runtime.js";
import type { BrowserSessionPauseManager } from "./browser-session-pause.js";
import { BrowserTakeoverService } from "./browser-takeover.js";
import type { LocalStore } from "./store.js";

interface BrowserSessionControlOwner {
  threadId: string;
  runId: string;
}

export class BrowserSessionControlService {
  private readonly takeovers: BrowserTakeoverService;

  constructor(
    private readonly store: LocalStore,
    private readonly sessions: Pick<
      AgentCapabilityRuntime,
      | "captureBrowserTakeoverSnapshot"
      | "executeBrowserTakeoverAction"
      | "hasActiveBrowserSession"
    >,
    private readonly pauses: BrowserSessionPauseManager,
  ) {
    this.takeovers = new BrowserTakeoverService(store, sessions, pauses);
  }

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
    this.takeovers.clear(threadId, runId);
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
    const state = await this.pauses.resume(owner, expectedPauseStateSha256);
    this.takeovers.clear(threadId, runId);
    return state;
  }

  snapshot(
    threadId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<BrowserTakeoverSnapshot> {
    return this.takeovers.snapshot(threadId, runId, signal);
  }

  executeTakeover(
    threadId: string,
    runId: string,
    request: ExecuteBrowserTakeoverActionRequest,
    signal?: AbortSignal,
  ): Promise<BrowserTakeoverActionReceipt> {
    return this.takeovers.execute(threadId, runId, request, signal);
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
