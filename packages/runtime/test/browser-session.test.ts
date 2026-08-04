import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import type {
  Browser,
  BrowserContext,
  Download,
  LaunchOptions,
  Locator,
  Page,
  Request,
  Route,
} from "playwright-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_ACTIVE_BROWSER_SESSIONS,
  RunBrowserSessionManager,
  type BrowserNetworkProxy,
  type BrowserSessionOwner,
} from "../src/browser-session.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("RunBrowserSessionManager", () => {
  it("reuses one isolated Session and returns bounded snapshots and screenshots", async () => {
    const harness = await createHarness();
    const owner = { threadId: "thread_one", runId: "run_one" };

    const started = await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/",
    });
    const waited = await harness.manager.execute(owner, {
      action: "wait",
      durationMs: 5,
    });
    const snapshot = await harness.manager.execute(owner, {
      action: "snapshot",
    });
    const typed = await harness.manager.execute(owner, {
      action: "type",
      target: { ref: "e2" },
      text: "private input",
    });
    const screenshot = await harness.manager.execute(owner, {
      action: "screenshot",
    });
    const closed = await harness.manager.execute(owner, { action: "close" });

    expect([
      started.details.sessionOperation,
      waited.details.sessionOperation,
      snapshot.details.sessionOperation,
      typed.details.sessionOperation,
      screenshot.details.sessionOperation,
      closed.details.sessionOperation,
    ]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(started.details.sessionReused).toBe(false);
    expect(snapshot.details.sessionReused).toBe(true);
    expect(snapshot.details.sessionIdSha256).toBe(
      started.details.sessionIdSha256,
    );
    expect(snapshot.output).toContain("[ref=e2]");
    expect(waited.output).toContain("[ref=e2]");
    expect(screenshot.screenshot).toEqual({
      data: Buffer.from("fake png").toString("base64"),
      mimeType: "image/png",
    });
    expect(harness.pages[0]?.filled).toEqual([
      { selector: "aria-ref=e2", text: "private input" },
    ]);
    expect(harness.launchOptions).toHaveLength(1);
    expect(harness.launchOptions[0]).toEqual(
      expect.objectContaining({
        chromiumSandbox: true,
        headless: true,
        proxy: expect.objectContaining({
          server: "http://127.0.0.1:32100",
          bypass: "<-loopback>",
        }),
      }),
    );
    expect(harness.launchOptions[0]?.env?.["HOME"]).not.toBe(
      process.env["HOME"],
    );
    expect(harness.launchOptions[0]?.args).toContain(
      "--disable-crash-reporter",
    );
    expect(harness.proxies[0]?.outboundTransitions).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
    ]);
    expect(harness.proxies[0]?.closed).toBe(true);
    await expect(
      harness.manager.execute(owner, { action: "snapshot" }),
    ).rejects.toThrow("not active");
  });

  it("captures bounded normalized page text without reopening network access", async () => {
    const harness = await createHarness({
      sourceText:
        "  Research heading  \n\nEvidence\twith   spacing\u001b[31m\nFinal evidence",
      sourceTitle: "  Research\u001b  title  ",
    });
    const owner = { threadId: "thread_capture", runId: "run_capture" };
    await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/research",
    });

    const capture = await harness.manager.capturePage(owner, 12_000);

    expect(capture).toEqual(
      expect.objectContaining({
        url: "https://one.example/research",
        title: "Research title",
        lines: [
          "Research heading",
          "Evidence with spacing [31m",
          "Final evidence",
        ],
        textChars: 58,
        truncated: false,
        sessionOperation: 2,
      }),
    );
    expect(capture.capturedContentSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(harness.proxies[0]?.outboundTransitions).toEqual([true, false]);
    await harness.manager.cancelRun(owner);
  });

  it("closes an uncertain Session when the page URL drifts during capture", async () => {
    const harness = await createHarness({ sourceUrlDriftDuringCapture: true });
    const owner = {
      threadId: "thread_capture_drift",
      runId: "run_capture_drift",
    };
    await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/research",
    });

    await expect(harness.manager.capturePage(owner, 12_000)).rejects.toThrow(
      "page changed",
    );
    expect(harness.browsers[0]?.closed).toBe(true);
    await expect(
      harness.manager.execute(owner, { action: "snapshot" }),
    ).rejects.toThrow("not active");
  });

  it("denies cross-origin redirects unless the current action authorizes them", async () => {
    const redirects = new Map([
      ["https://one.example/redirect", "https://two.example/final"],
    ]);
    const denied = await createHarness({ redirects });
    const owner = { threadId: "thread_redirect", runId: "run_redirect" };

    await expect(
      denied.manager.execute(owner, {
        action: "start",
        url: "https://one.example/redirect",
      }),
    ).rejects.toThrow("Cross-origin navigation requires allowCrossOrigin");
    expect(denied.proxies[0]?.closed).toBe(true);

    const allowed = await createHarness({ redirects });
    const result = await allowed.manager.execute(owner, {
      action: "start",
      url: "https://one.example/redirect",
      allowCrossOrigin: true,
    });
    expect(result.output).toContain("https://two.example/final");
    expect(result.details.crossOriginAuthorized).toBe(true);
    await allowed.manager.cancelRun(owner);
  });

  it("rejects private DNS before creating a proxy or browser", async () => {
    const harness = await createHarness({
      lookup: async (hostname) =>
        hostname === "private.example"
          ? [{ address: "127.0.0.1", family: 4 }]
          : [{ address: "1.1.1.1", family: 4 }],
    });
    const owner = { threadId: "thread_private", runId: "run_private" };

    await expect(
      harness.manager.execute(owner, {
        action: "start",
        url: "https://private.example/",
      }),
    ).rejects.toThrow("private or reserved");
    expect(harness.proxies).toEqual([]);
    expect(harness.browsers).toEqual([]);
  });

  it("binds explicit uploads and downloads to workspace files", async () => {
    const harness = await createHarness({
      downloadBody: "downloaded content",
    });
    await writeFile(path.join(harness.workspace, "upload.txt"), "upload body");
    const owner = { threadId: "thread_files", runId: "run_files" };
    await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/",
    });

    const upload = await harness.manager.execute(owner, {
      action: "upload",
      target: { selector: "#upload" },
      path: "upload.txt",
    });
    expect(upload.details.file).toEqual(
      expect.objectContaining({ fileBytes: 11 }),
    );
    expect(harness.pages[0]?.uploaded).toEqual([
      {
        selector: "#upload",
        path: await realpath(path.join(harness.workspace, "upload.txt")),
      },
    ]);

    const download = await harness.manager.execute(owner, {
      action: "download",
      target: { ref: "e3" },
      path: "download.txt",
    });
    expect(download.details.file).toEqual(
      expect.objectContaining({ fileBytes: 18 }),
    );
    await expect(
      readFile(path.join(harness.workspace, "download.txt"), "utf8"),
    ).resolves.toBe("downloaded content");
    expect(harness.downloads[0]?.deleted).toBe(true);
    await harness.manager.cancelRun(owner);
  });

  it("rejects an unsafe download target before clicking the page", async () => {
    const harness = await createHarness();
    const owner = {
      threadId: "thread_download_preflight",
      runId: "run_download_preflight",
    };
    await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/",
    });

    await expect(
      harness.manager.execute(owner, {
        action: "download",
        target: { ref: "e3" },
        path: "../escape.txt",
      }),
    ).rejects.toThrow("escapes");
    expect(harness.pages[0]?.clicked).toEqual([]);
    expect(harness.browsers[0]?.closed).toBe(true);
  });

  it("executes navigate, select, click, and back through one Session", async () => {
    const harness = await createHarness();
    const owner = { threadId: "thread_actions", runId: "run_actions" };
    await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/root",
    });
    await harness.manager.execute(owner, {
      action: "navigate",
      url: "https://one.example/next",
    });
    await harness.manager.execute(owner, {
      action: "select",
      target: { selector: "#choice" },
      values: ["one", "two"],
    });
    await harness.manager.execute(owner, {
      action: "click",
      target: { ref: "e2" },
    });
    const back = await harness.manager.execute(owner, { action: "back" });

    expect(back.output).toContain("https://one.example/root");
    expect(harness.pages[0]?.selected).toEqual([
      { selector: "#choice", values: ["one", "two"] },
    ]);
    expect(harness.pages[0]?.clicked).toEqual(["aria-ref=e2"]);
    await harness.manager.execute(owner, { action: "close" });
  });

  it("closes the Session when its bounded operation budget is exhausted", async () => {
    const harness = await createHarness();
    const owner = { threadId: "thread_limit", runId: "run_limit" };
    await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/",
    });
    for (let operation = 2; operation <= 64; operation += 1) {
      const result = await harness.manager.execute(owner, {
        action: "snapshot",
      });
      expect(result.details.sessionOperation).toBe(operation);
    }
    await expect(
      harness.manager.execute(owner, { action: "snapshot" }),
    ).rejects.toThrow("operation limit");
    expect(harness.browsers[0]?.closed).toBe(true);
  });

  it("isolates Runs, enforces the active bound, and closes on cancellation", async () => {
    const harness = await createHarness();
    const owners = Array.from(
      { length: MAX_ACTIVE_BROWSER_SESSIONS + 1 },
      (_, index) => ({
        threadId: `thread_${String(index)}`,
        runId: `run_${String(index)}`,
      }),
    );
    const starts = await Promise.allSettled(
      owners.map((owner) =>
        harness.manager.execute(owner, {
          action: "start",
          url: "https://one.example/",
        }),
      ),
    );
    expect(starts.map((start) => start.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "rejected",
    ]);
    expect(
      starts[MAX_ACTIVE_BROWSER_SESSIONS]?.status === "rejected"
        ? starts[MAX_ACTIVE_BROWSER_SESSIONS].reason
        : undefined,
    ).toEqual(
      expect.objectContaining({
        message: "Browser active Session limit reached",
      }),
    );
    expect(
      new Set(
        (
          await Promise.all(
            owners
              .slice(0, MAX_ACTIVE_BROWSER_SESSIONS)
              .map((owner) =>
                harness.manager.execute(owner, { action: "snapshot" }),
              ),
          )
        ).map((result) => result.details.sessionIdSha256),
      ).size,
    ).toBe(MAX_ACTIVE_BROWSER_SESSIONS);
    const first = owners[0]!;
    for (const page of harness.pages) page.blockClicks = true;
    const controller = new AbortController();
    const operation = harness.manager.execute(
      first,
      { action: "click", target: { ref: "e2" } },
      controller.signal,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(operation).rejects.toThrow("cancelled");
    expect(harness.browsers.filter((browser) => browser.closed)).toHaveLength(
      1,
    );

    await Promise.all(
      owners
        .slice(1, MAX_ACTIVE_BROWSER_SESSIONS)
        .map((owner) => harness.manager.cancelRun(owner)),
    );
  });
});

interface HarnessOptions {
  redirects?: Map<string, string>;
  lookup?: (
    hostname: string,
  ) => Promise<Array<{ address: string; family: 4 | 6 }>>;
  downloadBody?: string;
  sourceText?: string;
  sourceTitle?: string;
  sourceUrlDriftDuringCapture?: boolean;
}

async function createHarness(options: HarnessOptions = {}) {
  const workspace = await mkdtemp(
    path.join(tmpdir(), "napier-browser-session-test-"),
  );
  roots.push(workspace);
  const pages: FakePage[] = [];
  const browsers: FakeBrowser[] = [];
  const proxies: FakeProxy[] = [];
  const downloads: FakeDownload[] = [];
  const launchOptions: LaunchOptions[] = [];
  const manager = new RunBrowserSessionManager({
    workspaceRoot: workspace,
    lookup:
      options.lookup ??
      (async () => [{ address: "1.1.1.1", family: 4 as const }]),
    resolveRuntime: async () => ({
      executablePath: "/fake/chrome",
      executableSha256: "a".repeat(64),
    }),
    createProxy: () => {
      const proxy = new FakeProxy();
      proxies.push(proxy);
      return proxy;
    },
    launchBrowser: async (launch) => {
      launchOptions.push(launch);
      const page = new FakePage(
        options.redirects ?? new Map(),
        options.downloadBody ?? "download body",
        options.sourceText ?? "Default research source text",
        options.sourceTitle,
        options.sourceUrlDriftDuringCapture ?? false,
      );
      pages.push(page);
      downloads.push(page.download);
      const browser = new FakeBrowser(page);
      browsers.push(browser);
      return browser as unknown as Browser;
    },
  });
  return {
    workspace,
    manager,
    pages,
    browsers,
    proxies,
    downloads,
    launchOptions,
  };
}

class FakeProxy implements BrowserNetworkProxy {
  closed = false;
  outboundEnabled = false;
  readonly outboundTransitions: boolean[] = [];

  async start() {
    return {
      server: "http://127.0.0.1:32100",
      username: "napier",
      password: "test-password",
    };
  }

  snapshot() {
    return {
      requestCount: 1,
      connectCount: 1,
      rejectedCount: 0,
      transferredBytes: 128,
      destinationCount: 1,
      destinationsSha256: "b".repeat(64),
    };
  }

  setOutboundEnabled(enabled: boolean) {
    this.outboundEnabled = enabled;
    this.outboundTransitions.push(enabled);
  }

  async close() {
    this.closed = true;
  }
}

class FakeBrowser {
  readonly context: FakeContext;
  closed = false;
  private disconnected: ((browser: Browser) => unknown) | undefined;

  constructor(page: FakePage) {
    this.context = new FakeContext(page);
  }

  version() {
    return "Fake Chrome 1";
  }

  async newContext() {
    return this.context as unknown as BrowserContext;
  }

  on(event: string, listener: (browser: Browser) => unknown) {
    if (event === "disconnected") this.disconnected = listener;
    return this as unknown as Browser;
  }

  async close() {
    this.closed = true;
  }
}

class FakeContext {
  private routeHandler:
    | ((route: Route) => Promise<unknown> | unknown)
    | undefined;

  constructor(readonly page: FakePage) {
    page.context = this;
  }

  setDefaultTimeout() {}
  setDefaultNavigationTimeout() {}

  async newPage() {
    return this.page as unknown as Page;
  }

  async route(
    _url: string,
    handler: (route: Route) => Promise<unknown> | unknown,
  ) {
    this.routeHandler = handler;
  }

  on() {
    return this as unknown as BrowserContext;
  }

  async close() {
    this.page.closed = true;
  }

  async dispatch(url: string, page: FakePage): Promise<void> {
    if (!this.routeHandler) throw new Error("route handler is unavailable");
    let continued = false;
    let aborted = false;
    const request = {
      url: () => url,
      isNavigationRequest: () => true,
      frame: () => page.frame,
    } as unknown as Request;
    const route = {
      request: () => request,
      continue: async () => {
        continued = true;
      },
      abort: async () => {
        aborted = true;
      },
    } as unknown as Route;
    await this.routeHandler(route);
    if (aborted || !continued) throw new Error("navigation aborted");
  }
}

class FakePage {
  context!: FakeContext;
  readonly frame = {};
  readonly clicked: string[] = [];
  readonly filled: Array<{ selector: string; text: string }> = [];
  readonly selected: Array<{ selector: string; values: string[] }> = [];
  readonly uploaded: Array<{ selector: string; path: string }> = [];
  readonly download: FakeDownload;
  blockClicks = false;
  closed = false;
  private currentUrl = "about:blank";
  private readonly history: string[] = [];

  constructor(
    private readonly redirects: Map<string, string>,
    downloadBody: string,
    private readonly sourceText: string,
    private readonly sourceTitle: string | undefined,
    private readonly sourceUrlDriftDuringCapture: boolean,
  ) {
    this.download = new FakeDownload(downloadBody);
  }

  url() {
    return this.currentUrl;
  }

  async title() {
    return this.currentUrl === "about:blank"
      ? ""
      : `Page ${new URL(this.currentUrl).hostname}`;
  }

  mainFrame() {
    return this.frame;
  }

  async goto(url: string) {
    await this.context.dispatch(url, this);
    const redirect = this.redirects.get(url);
    if (redirect) await this.context.dispatch(redirect, this);
    if (this.currentUrl !== "about:blank") this.history.push(this.currentUrl);
    this.currentUrl = redirect ?? url;
    return {};
  }

  async goBack() {
    const prior = this.history.pop();
    if (!prior) return null;
    await this.context.dispatch(prior, this);
    this.currentUrl = prior;
    return {};
  }

  locator(selector: string) {
    const page = this;
    return {
      async ariaSnapshot() {
        return [
          `- heading "Fake page" [ref=e1]`,
          `- textbox "Input" [ref=e2]`,
          `- link "Download" [ref=e3]`,
        ].join("\n");
      },
      async click() {
        page.clicked.push(selector);
        if (page.blockClicks) {
          await new Promise<void>(() => undefined);
        }
      },
      async fill(text: string) {
        page.filled.push({ selector, text });
      },
      async selectOption(values: string[]) {
        page.selected.push({ selector, values: [...values] });
        return [];
      },
      async setInputFiles(filePath: string) {
        page.uploaded.push({ selector, path: filePath });
      },
      async evaluate(_callback: unknown, limit: number, _options: unknown) {
        const capturedUrl = page.currentUrl;
        const extracted = {
          url: capturedUrl,
          title:
            page.sourceTitle ??
            (capturedUrl === "about:blank"
              ? ""
              : `Page ${new URL(capturedUrl).hostname}`),
          text: page.sourceText.slice(0, limit + 1),
        };
        if (page.sourceUrlDriftDuringCapture) {
          page.currentUrl = "https://two.example/drifted";
        }
        return extracted;
      },
    } as unknown as Locator;
  }

  async screenshot() {
    return Buffer.from("fake png");
  }

  async waitForTimeout(durationMs: number) {
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(durationMs, 1)),
    );
  }

  async waitForEvent(event: string) {
    if (event !== "download") throw new Error(`Unexpected event: ${event}`);
    return this.download as unknown as Download;
  }

  on() {
    return this as unknown as Page;
  }

  async close() {
    this.closed = true;
  }
}

class FakeDownload {
  deleted = false;

  constructor(private readonly body: string) {}

  suggestedFilename() {
    return "download.txt";
  }

  async createReadStream() {
    return Readable.from([this.body]);
  }

  async delete() {
    this.deleted = true;
  }
}
