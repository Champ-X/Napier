import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  canonicalJson,
  type BrowserSessionDetails,
  createLocalAgentRuntime,
  sha256,
  type LocalAgentRuntimeOptions,
  type RunBrowserSessionManager,
  UnsupportedSandboxAdapter,
} from "@napier/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli, type CliIo, type RunCliDependencies } from "../src/cli.js";

interface ConfirmationPageState {
  kind: "napier.browser-confirmation-page-state";
  schemaVersion: 1;
  sessionIdSha256: string;
  sessionOperation: number;
  activeTabId: string;
  tabCount: number;
  tabSetSha256: string;
  currentUrlSha256: string;
  currentOriginSha256: string;
  targetStateSha256: string;
  contentSha256: string;
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("terminal Browser interaction confirmation", () => {
  it("approves one exact Browser interaction in a human one-shot Run", async () => {
    const fixture = await createFixture();
    const operations: string[] = [];
    const provider = browserProvider(
      "one-shot-browser-confirm",
      "ONE_SHOT_BROWSER_CONFIRMED",
      "#PRIVATE_ONE_SHOT_SELECTOR",
      "PRIVATE_ONE_SHOT_TEXT",
    );
    const input = ttyInput();
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();
    const running = runCli(
      [
        "run",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--prompt",
        "Type into the confirmed Browser target.",
        "--model",
        "one-shot-browser-confirm/faux-1",
        "--preset",
        "safe_automation",
      ],
      {
        cwd: fixture.root,
        env: {},
        stdin: input,
        stdout,
        stderr,
      },
      browserDependencies(provider, browserSessions(operations), "one-shot"),
    );

    input.write("approve\n");
    await vi.waitFor(() =>
      expect(stderr.text()).toContain(
        "[confirm] Browser type paused before execution",
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(operations).toEqual(["start"]);
    expect(stderr.text()).toContain("Type approve or reject");
    expect(stderr.text()).not.toContain("PRIVATE_ONE_SHOT_SELECTOR");
    expect(stderr.text()).not.toContain("PRIVATE_ONE_SHOT_TEXT");
    input.write("not-a-decision\n");
    await vi.waitFor(() =>
      expect(
        stderr.text().split("Type approve or reject").length - 1,
      ).toBeGreaterThanOrEqual(2),
    );
    input.write("approve\n");

    expect(await running).toBe(0);
    expect(operations).toEqual(["start", "type"]);
    expect(stderr.text()).toContain("[confirm] Browser type approved");
    expect(stdout.text()).toBe("ONE_SHOT_BROWSER_CONFIRMED\n");
    expect(stdout.text()).not.toContain("PRIVATE_ONE_SHOT_TEXT");
  });

  it("rejects one exact Browser interaction in a human one-shot Run", async () => {
    const fixture = await createFixture();
    const operations: string[] = [];
    const provider = browserProvider(
      "one-shot-browser-reject",
      "ONE_SHOT_BROWSER_REJECTED",
      "#PRIVATE_ONE_SHOT_REJECT_SELECTOR",
      "PRIVATE_ONE_SHOT_REJECT_TEXT",
    );
    const input = ttyInput();
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();
    const running = runCli(
      [
        "run",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--prompt",
        "Reject the exact Browser interaction.",
        "--model",
        "one-shot-browser-reject/faux-1",
        "--preset",
        "safe_automation",
      ],
      {
        cwd: fixture.root,
        env: {},
        stdin: input,
        stdout,
        stderr,
      },
      browserDependencies(
        provider,
        browserSessions(operations),
        "one-shot-reject",
      ),
    );

    await vi.waitFor(() =>
      expect(stderr.text()).toContain(
        "[confirm] Browser type paused before execution",
      ),
    );
    input.write("reject\n");

    expect(await running).toBe(0);
    expect(operations).toEqual(["start"]);
    expect(stderr.text()).toContain("[confirm] Browser type rejected");
    expect(stdout.text()).toBe("ONE_SHOT_BROWSER_REJECTED\n");
    expect(`${stdout.text()}${stderr.text()}`).not.toContain(
      "PRIVATE_ONE_SHOT_REJECT_TEXT",
    );
  });

  it("cancels a pending one-shot Browser confirmation on EOF", async () => {
    const fixture = await createFixture();
    const operations: string[] = [];
    const provider = browserProvider(
      "one-shot-browser-eof",
      "ONE_SHOT_EOF_MUST_NOT_COMPLETE",
      "#PRIVATE_ONE_SHOT_EOF_SELECTOR",
      "PRIVATE_ONE_SHOT_EOF_TEXT",
    );
    const input = ttyInput();
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();
    const running = runCli(
      [
        "run",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--prompt",
        "Cancel if the confirmation input closes.",
        "--model",
        "one-shot-browser-eof/faux-1",
        "--preset",
        "safe_automation",
      ],
      {
        cwd: fixture.root,
        env: {},
        stdin: input,
        stdout,
        stderr,
      },
      browserDependencies(
        provider,
        browserSessions(operations),
        "one-shot-eof",
      ),
    );

    await vi.waitFor(() =>
      expect(stderr.text()).toContain(
        "[confirm] Browser type paused before execution",
      ),
    );
    input.end();

    expect(await running).toBe(1);
    expect(operations).toEqual(["start"]);
    expect(stdout.text()).not.toContain("ONE_SHOT_EOF_MUST_NOT_COMPLETE");
    expect(`${stdout.text()}${stderr.text()}`).not.toContain(
      "PRIVATE_ONE_SHOT_EOF_TEXT",
    );
  });

  it("keeps JSONL and non-TTY one-shot Browser surfaces read-only", async () => {
    for (const mode of ["jsonl", "non_tty"] as const) {
      const fixture = await createFixture();
      const operations: string[] = [];
      const provider = browserProvider(
        `one-shot-browser-${mode}`,
        `ONE_SHOT_${mode.toUpperCase()}_READ_ONLY`,
        `#PRIVATE_${mode.toUpperCase()}_SELECTOR`,
        `PRIVATE_${mode.toUpperCase()}_TEXT`,
      );
      const input = new PassThrough();
      if (mode === "jsonl") {
        Object.defineProperty(input, "isTTY", { value: true });
      }
      input.end("approve\n");
      const stdout = new CaptureWritable();
      const stderr = new CaptureWritable();

      const code = await runCli(
        [
          "run",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--prompt",
          "Do not expose Browser interaction without a human channel.",
          "--model",
          `one-shot-browser-${mode}/faux-1`,
          "--preset",
          "safe_automation",
          ...(mode === "jsonl" ? ["--jsonl"] : []),
        ],
        {
          cwd: fixture.root,
          env: {},
          stdin: input,
          stdout,
          stderr,
        },
        browserDependencies(
          provider,
          browserSessions(operations),
          `one-shot-${mode}`,
        ),
      );

      expect(code).toBe(0);
      expect(operations).toEqual(["start"]);
      expect(stdout.text()).toContain(
        `ONE_SHOT_${mode.toUpperCase()}_READ_ONLY`,
      );
      expect(stdout.text()).not.toContain(`PRIVATE_${mode.toUpperCase()}_TEXT`);
      expect(`${stdout.text()}${stderr.text()}`).not.toContain(
        "Browser type paused before execution",
      );
    }
  });

  it("approves one exact Browser interaction while the Chat Run is active", async () => {
    const fixture = await createFixture();
    const operations: string[] = [];
    const provider = browserProvider(
      "interactive-browser-confirm",
      "CHAT_BROWSER_CONFIRMED",
      "#PRIVATE_CHAT_SELECTOR",
      "PRIVATE_CHAT_TEXT",
    );
    const input = ttyInput();
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();
    const running = runCli(
      [
        "chat",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--model",
        "interactive-browser-confirm/faux-1",
        "--preset",
        "safe_automation",
      ],
      {
        cwd: fixture.root,
        env: {},
        stdin: input,
        stdout,
        stderr,
      },
      browserDependencies(provider, browserSessions(operations), "chat"),
    );

    await vi.waitFor(() => expect(stderr.text()).toContain("chat ready"));
    input.write("Type into the confirmed Browser target.\n");
    await vi.waitFor(() =>
      expect(stderr.text()).toContain(
        "[confirm] Browser type paused before execution",
      ),
    );
    expect(stderr.text()).toContain("Type approve or reject");
    expect(stderr.text()).not.toContain("PRIVATE_CHAT_SELECTOR");
    expect(stderr.text()).not.toContain("PRIVATE_CHAT_TEXT");
    input.write("approve\n");
    await vi.waitFor(() =>
      expect(stdout.text()).toContain("CHAT_BROWSER_CONFIRMED"),
    );
    input.end("/status\n/exit\n");

    expect(await running).toBe(0);
    expect(operations).toEqual(["start", "type"]);
    expect(stderr.text()).toContain("[confirm] Browser type approved");
    expect(stderr.text()).toContain("interact confirm");
    expect(stdout.text()).not.toContain("PRIVATE_CHAT_TEXT");
  });

  it("rejects one exact Browser interaction without queueing TUI input", async () => {
    const fixture = await createFixture();
    const operations: string[] = [];
    const provider = browserProvider(
      "tui-browser-confirm",
      "TUI_BROWSER_REJECTED",
      "#PRIVATE_TUI_SELECTOR",
      "PRIVATE_TUI_TEXT",
    );
    const input = new RawTtyInput();
    const output = new TtyCapture();
    const running = runCli(
      [
        "tui",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--model",
        "tui-browser-confirm/faux-1",
        "--preset",
        "safe_automation",
      ],
      {
        cwd: fixture.root,
        env: {},
        stdin: input,
        stdout: output,
        stderr: new CaptureWritable(),
      },
      browserDependencies(provider, browserSessions(operations), "tui"),
    );

    await waitForFrame(output, "Ready; type a prompt");
    input.write("Type into the Browser only if confirmed.\r");
    await waitForFrame(output, "Browser type paused before execution");
    expect(output.lastFrame()).toContain("Enter approve/reject");
    expect(output.text()).not.toContain("PRIVATE_TUI_SELECTOR");
    expect(output.text()).not.toContain("PRIVATE_TUI_TEXT");
    input.write("not-a-decision\r");
    await waitForFrame(output, "Type approve or reject");
    input.write("reject\r");
    await waitForFrame(output, "TUI_BROWSER_REJECTED");
    await waitForRunStatus(output, "completed");
    input.write("/exit\r");

    expect(await running).toBe(0);
    expect(operations).toEqual(["start"]);
    expect(output.text()).toContain("Browser type rejected");
    expect(output.text()).toContain("browser interact confirm");

    const reopened = await createLocalAgentRuntime({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sandbox: new UnsupportedSandboxAdapter("tui-browser-inspect"),
    });
    try {
      const events = (
        await Promise.all(
          reopened.store
            .listThreads()
            .map((thread) => reopened.store.listEvents(thread.id)),
        )
      ).flat();
      expect(JSON.stringify(events)).not.toContain("not-a-decision");
      expect(
        events
          .filter((event) =>
            event.type.startsWith("browser.interaction_confirmation."),
          )
          .map((event) => event.type),
      ).toEqual([
        "browser.interaction_confirmation.pending",
        "browser.interaction_confirmation.rejected",
      ]);
    } finally {
      await reopened.shutdown();
    }
  });

  it("cancels a pending Chat confirmation with Ctrl-C", async () => {
    const fixture = await createFixture();
    const operations: string[] = [];
    const provider = browserProvider(
      "interactive-browser-cancel",
      "CANCELLED_RESULT_MUST_NOT_RENDER",
      "#PRIVATE_CANCEL_SELECTOR",
      "PRIVATE_CANCEL_TEXT",
    );
    const input = ttyInput();
    const stderr = new CaptureWritable();
    let interrupt: (() => void) | undefined;
    const running = runCli(
      [
        "chat",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--model",
        "interactive-browser-cancel/faux-1",
        "--preset",
        "safe_automation",
      ],
      {
        cwd: fixture.root,
        env: {},
        stdin: input,
        stdout: new CaptureWritable(),
        stderr,
        subscribeInterrupt(listener) {
          interrupt = listener;
          return () => {
            interrupt = undefined;
          };
        },
      },
      browserDependencies(provider, browserSessions(operations), "cancel"),
    );

    await vi.waitFor(() => expect(stderr.text()).toContain("chat ready"));
    input.write("Attempt the Browser action.\n");
    await vi.waitFor(() =>
      expect(stderr.text()).toContain(
        "[confirm] Browser type paused before execution",
      ),
    );
    interrupt?.();
    await vi.waitFor(() => expect(stderr.text()).toContain("cancelled"));
    input.end("/status\n/exit\n");

    expect(await running).toBe(0);
    expect(operations).toEqual(["start"]);
    expect(stderr.text()).toContain("^C cancelling active Run");
    expect(stderr.text()).not.toContain("PRIVATE_CANCEL_SELECTOR");
    expect(stderr.text()).not.toContain("PRIVATE_CANCEL_TEXT");
  });
});

function browserProvider(
  providerId: string,
  result: string,
  selector: string,
  text: string,
) {
  const provider = fauxProvider({ provider: providerId });
  provider.setResponses([
    fauxAssistantMessage(
      fauxToolCall("browser", {
        action: "start",
        url: "https://example.com/",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("browser", {
        action: "type",
        target: { selector },
        text,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(result),
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  return provider;
}

function browserDependencies(
  provider: ReturnType<typeof fauxProvider>,
  sessions: RunBrowserSessionManager,
  name: string,
): RunCliDependencies {
  return {
    async createRuntime(options: LocalAgentRuntimeOptions) {
      const services = await createLocalAgentRuntime({
        ...options,
        browserSessions: sessions,
        sandbox: new UnsupportedSandboxAdapter(`${name}-browser-test`),
      });
      services.models.registerProvider(provider.provider);
      return services;
    },
  };
}

function browserSessions(operations: string[]): RunBrowserSessionManager {
  const session = {
    execute: vi.fn(
      async (
        _owner: { threadId: string; runId: string },
        request: { action: BrowserSessionDetails["action"] },
      ) => {
        operations.push(request.action);
        return {
          output: `TERMINAL_BROWSER_${request.action}`,
          details: browserDetails(request.action, operations.length),
        };
      },
    ),
    cancelRun: vi.fn(async () => undefined),
    hasActiveSession: vi.fn(() => true),
  };
  return withConfirmationState(session) as unknown as RunBrowserSessionManager;
}

function withConfirmationState<
  Session extends {
    execute(
      owner: { threadId: string; runId: string },
      request: { action: BrowserSessionDetails["action"] },
      signal?: AbortSignal,
    ): Promise<unknown>;
  },
>(session: Session): Session {
  const confirmed = session as Session & {
    captureConfirmationPageState(): Promise<ConfirmationPageState>;
    executeConfirmedAction(
      owner: { threadId: string; runId: string },
      request: { action: BrowserSessionDetails["action"] },
      expected: ConfirmationPageState,
      signal?: AbortSignal,
    ): Promise<unknown>;
  };
  confirmed.captureConfirmationPageState = async () =>
    terminalConfirmationPageState();
  confirmed.executeConfirmedAction = async (
    owner,
    request,
    _expected,
    signal,
  ) => session.execute(owner, request, signal);
  return session;
}

function terminalConfirmationPageState(): ConfirmationPageState {
  const content = {
    kind: "napier.browser-confirmation-page-state" as const,
    schemaVersion: 1 as const,
    sessionIdSha256: "a".repeat(64),
    sessionOperation: 1,
    activeTabId: "tab_1",
    tabCount: 1,
    tabSetSha256: sha256(canonicalJson(["tab_1"])),
    currentUrlSha256: "e".repeat(64),
    currentOriginSha256: "f".repeat(64),
    targetStateSha256: sha256("stable terminal target"),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function browserDetails(
  action: BrowserSessionDetails["action"],
  operation: number,
): BrowserSessionDetails {
  return {
    kind: "napier.browser-session-operation",
    schemaVersion: 2,
    action,
    sessionMode: "run_persistent",
    sessionReused: operation > 1,
    sessionOperation: operation,
    sessionIdSha256: "a".repeat(64),
    activeTabId: "tab_1",
    tabCount: 1,
    tabSetSha256: sha256(canonicalJson(["tab_1"])),
    browserExecutableSha256: "b".repeat(64),
    browserVersionSha256: "c".repeat(64),
    limitsSha256: "d".repeat(64),
    currentUrlSha256: "e".repeat(64),
    currentOriginSha256: "f".repeat(64),
    titleSha256: "1".repeat(64),
    pageDiagnosis: {
      status: "none",
      signalCount: 0,
      signalsSha256: sha256(canonicalJson([])),
      takeoverRecommended: false,
    },
    snapshotSha256: sha256("terminal browser snapshot"),
    snapshotChars: 25,
    snapshotTruncated: false,
    blockedRequestCount: 0,
    network: {
      requestCount: operation,
      connectCount: 1,
      rejectedCount: 0,
      transferredBytes: 100,
      destinationCount: 1,
      destinationsSha256: "2".repeat(64),
    },
    crossOriginAuthorized: false,
  };
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-terminal-browser-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot);
  return { root, workspaceRoot, dataRoot };
}

function ttyInput(): PassThrough {
  const input = new PassThrough();
  Object.defineProperty(input, "isTTY", { value: true });
  return input;
}

async function waitForFrame(
  output: TtyCapture,
  value: string,
  timeout = 10_000,
): Promise<void> {
  await vi.waitFor(() => expect(output.lastFrame()).toContain(value), {
    timeout,
  });
}

async function waitForRunStatus(
  output: TtyCapture,
  status: "completed" | "failed" | "cancelled",
): Promise<void> {
  await vi.waitFor(() => {
    expect(output.lastFrame()).toMatch(
      new RegExp(`Run run_[a-z0-9_-]+ ${status}`, "u"),
    );
  });
}

class RawTtyInput extends PassThrough {
  readonly isTTY = true;
  isRaw = false;

  setRawMode(enabled: boolean): void {
    this.isRaw = enabled;
  }
}

class CaptureWritable extends Writable {
  private readonly chunks: string[] = [];

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString("utf8"));
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}

class TtyCapture extends CaptureWritable {
  readonly isTTY = true;
  readonly columns = 100;
  readonly rows = 30;

  lastFrame(): string {
    return this.text().split("\u001b[H\u001b[2J").at(-1) ?? "";
  }
}
