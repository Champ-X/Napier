import type { PersistentBrowserSession } from "./browser-page-session.js";
import {
  assertBrowserConfirmationPageStateCurrent,
  type BrowserConfirmationPageState,
} from "./browser-confirmed-action.js";
import {
  assertBrowserPreparedUpload,
  type BrowserPreparedUpload,
} from "./browser-workspace-files.js";
import type {
  BrowserSessionOperationResult,
  BrowserSessionOwner,
  BrowserSessionRequest,
} from "./browser-session-model.js";

type ConfirmedBrowserRequest = Extract<
  BrowserSessionRequest,
  { action: "click" | "type" | "select" | "upload" | "download" }
>;

export class BrowserConfirmedSessionExecutor {
  constructor(
    private readonly withSession: <T>(
      owner: BrowserSessionOwner,
      signal: AbortSignal | undefined,
      operation: (session: PersistentBrowserSession, key: string) => Promise<T>,
    ) => Promise<T>,
    private readonly runOperation: (
      key: string,
      session: PersistentBrowserSession,
      request: BrowserSessionRequest,
      signal?: AbortSignal,
      preparedUpload?: BrowserPreparedUpload,
    ) => Promise<BrowserSessionOperationResult>,
  ) {}

  async capture(
    owner: BrowserSessionOwner,
    request: ConfirmedBrowserRequest,
    signal?: AbortSignal,
  ): Promise<BrowserConfirmationPageState> {
    return await this.withSession(owner, signal, (session) =>
      session.captureConfirmationPageState(request, signal),
    );
  }

  async execute(
    owner: BrowserSessionOwner,
    request: ConfirmedBrowserRequest,
    expected: BrowserConfirmationPageState,
    signal?: AbortSignal,
    preparedUpload?: BrowserPreparedUpload,
  ): Promise<BrowserSessionOperationResult> {
    if (preparedUpload) assertBrowserPreparedUpload(preparedUpload);
    try {
      return await this.withSession(owner, signal, async (session, key) => {
        const current = await session.captureConfirmationPageState(
          request,
          signal,
        );
        assertBrowserConfirmationPageStateCurrent(expected, current);
        return await this.runOperation(
          key,
          session,
          request,
          signal,
          preparedUpload,
        );
      });
    } finally {
      preparedUpload?.buffer.fill(0);
    }
  }
}
