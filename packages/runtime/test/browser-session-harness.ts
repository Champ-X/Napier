import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { parseHTML } from "linkedom";

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

import {
  RunBrowserSessionManager,
  type BrowserNetworkProxy,
} from "../src/browser-session.js";
import { probeBrowserPageDiagnosis } from "../src/browser-page-diagnosis.js";
import { probeBrowserSensitiveTarget } from "../src/browser-sensitive-target.js";
import type { RunLocalServiceLeaseRegistry } from "../src/run-local-service-leases.js";

const roots: string[] = [];

interface HarnessOptions {
  redirects?: Map<string, string>;
  lookup?: (
    hostname: string,
  ) => Promise<Array<{ address: string; family: 4 | 6 }>>;
  downloadBody?: string;
  sourceText?: string;
  sourceTitle?: string;
  sourceUrlDriftDuringCapture?: boolean;
  pageHtml?: string;
  localServiceLeases?: RunLocalServiceLeaseRegistry;
}

export async function cleanupBrowserSessionHarnesses(): Promise<void> {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
}

export async function createBrowserSessionHarness(
  options: HarnessOptions = {},
) {
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
    ...(options.localServiceLeases
      ? { localServiceLeases: options.localServiceLeases }
      : {}),
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
      const createPage = () => {
        const page = new FakePage(
          options.redirects ?? new Map(),
          options.downloadBody ?? "download body",
          options.sourceText ?? "Default research source text",
          options.sourceTitle,
          options.sourceUrlDriftDuringCapture ?? false,
          options.pageHtml,
        );
        pages.push(page);
        downloads.push(page.download);
        return page;
      };
      const browser = new FakeBrowser(createPage);
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

export class FakeProxy implements BrowserNetworkProxy {
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

export class FakeBrowser {
  readonly context: FakeContext;
  closed = false;
  private disconnected: ((browser: Browser) => unknown) | undefined;

  constructor(createPage: () => FakePage) {
    this.context = new FakeContext(createPage);
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

export class FakeContext {
  private routeHandler:
    | ((route: Route) => Promise<unknown> | unknown)
    | undefined;
  private pageListener: ((page: Page) => unknown) | undefined;
  private readonly pages: FakePage[] = [];

  constructor(private readonly createPage: () => FakePage) {}

  setDefaultTimeout() {}
  setDefaultNavigationTimeout() {}

  async newPage() {
    const page = this.attach(this.createPage());
    this.pageListener?.(page as unknown as Page);
    return page as unknown as Page;
  }

  async route(
    _url: string,
    handler: (route: Route) => Promise<unknown> | unknown,
  ) {
    this.routeHandler = handler;
  }

  on(event: string, listener: (page: Page) => unknown) {
    if (event === "page") this.pageListener = listener;
    return this as unknown as BrowserContext;
  }

  async close() {
    await Promise.all(this.pages.map((page) => page.close()));
  }

  openUnsolicitedPage(): FakePage {
    const page = this.attach(this.createPage());
    this.pageListener?.(page as unknown as Page);
    return page;
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

  private attach(page: FakePage): FakePage {
    page.context = this;
    this.pages.push(page);
    return page;
  }
}

export class FakePage {
  context!: FakeContext;
  readonly frame = { page: () => this as unknown as Page };
  readonly clicked: string[] = [];
  readonly filled: Array<{ selector: string; text: string }> = [];
  readonly selected: Array<{ selector: string; values: string[] }> = [];
  readonly uploaded: Array<
    | { selector: string; path: string }
    | {
        selector: string;
        name: string;
        mimeType: string;
        buffer: Buffer;
      }
  > = [];
  readonly visualClicks: Array<{ x: number; y: number }> = [];
  readonly pressedKeys: string[] = [];
  readonly download: FakeDownload;
  blockClicks = false;
  closed = false;
  driftTitleOnNextRead = false;
  gotoFailure: Error | undefined;
  ariaSnapshotText: string | undefined;
  private currentUrl = "about:blank";
  private scrollY = 0;
  private readonly backHistory: string[] = [];
  private readonly forwardHistory: string[] = [];
  private closeListener: (() => unknown) | undefined;

  constructor(
    private readonly redirects: Map<string, string>,
    downloadBody: string,
    private readonly sourceText: string,
    private readonly sourceTitle: string | undefined,
    private readonly sourceUrlDriftDuringCapture: boolean,
    private readonly pageHtml: string | undefined,
  ) {
    this.download = new FakeDownload(downloadBody);
  }

  url() {
    return this.currentUrl;
  }

  async title() {
    if (this.driftTitleOnNextRead) {
      this.driftTitleOnNextRead = false;
      return "Drifted title";
    }
    return this.currentUrl === "about:blank"
      ? ""
      : `Page ${new URL(this.currentUrl).hostname}`;
  }

  mainFrame() {
    return this.frame;
  }

  async goto(url: string) {
    const failure = this.gotoFailure;
    this.gotoFailure = undefined;
    if (failure) throw failure;
    await this.context.dispatch(url, this);
    const redirect = this.redirects.get(url);
    if (redirect) await this.context.dispatch(redirect, this);
    if (this.currentUrl !== "about:blank") {
      this.backHistory.push(this.currentUrl);
    }
    this.forwardHistory.splice(0);
    this.currentUrl = redirect ?? url;
    return {};
  }

  async goBack() {
    const prior = this.backHistory.pop();
    if (!prior) return null;
    await this.context.dispatch(prior, this);
    this.forwardHistory.push(this.currentUrl);
    this.currentUrl = prior;
    return {};
  }

  async goForward() {
    const next = this.forwardHistory.pop();
    if (!next) return null;
    await this.context.dispatch(next, this);
    this.backHistory.push(this.currentUrl);
    this.currentUrl = next;
    return {};
  }

  locator(selector: string) {
    const page = this;
    return {
      async ariaSnapshot() {
        return (
          page.ariaSnapshotText ??
          [
            `- heading "Fake page" [ref=e1]`,
            `- textbox "Input" [ref=e2]`,
            `- link "Download" [ref=e3]`,
          ].join("\n")
        );
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
      async setInputFiles(
        file: string | { name: string; mimeType: string; buffer: Buffer },
      ) {
        page.uploaded.push(
          typeof file === "string"
            ? { selector, path: file }
            : { selector, ...file, buffer: Buffer.from(file.buffer) },
        );
      },
      async evaluate(
        _callback: unknown,
        request:
          | number
          | { kind: "diagnosis"; href: string }
          | { kind: "source"; href: string; limit: number }
          | { kind: "find"; limit: number }
          | { kind: "scroll"; deltaY: number; textLimit: number }
          | {
              action: "click" | "type" | "select" | "upload" | "download";
            },
        _options: unknown,
      ) {
        if (typeof request !== "number") {
          if ("action" in request) {
            const { document } = parseHTML(
              page.pageHtml ??
                `<html><body><button id="target">Ordinary target</button></body></html>`,
            );
            const target =
              document.querySelector<HTMLElement>("#target") ?? document.body;
            return probeBrowserSensitiveTarget(target, request);
          }
          if (request.kind === "diagnosis" || request.kind === "source") {
            const capturedUrl = page.currentUrl;
            const { document } = parseHTML(
              page.pageHtml ??
                `<html><head><title>${escapeHtml(
                  page.sourceTitle ??
                    (capturedUrl === "about:blank"
                      ? ""
                      : `Page ${new URL(capturedUrl).hostname}`),
                )}</title></head><body></body></html>`,
            );
            const probed = probeBrowserPageDiagnosis(document.documentElement, {
              kind: "source",
              href: capturedUrl,
              limit: request.kind === "source" ? request.limit : 1,
            });
            if (request.kind === "diagnosis") {
              return { signals: probed.signals };
            }
            const extracted = {
              signals: probed.signals,
              url: capturedUrl,
              title:
                page.sourceTitle ??
                (capturedUrl === "about:blank"
                  ? ""
                  : `Page ${new URL(capturedUrl).hostname}`),
              text: page.sourceText.slice(0, request.limit + 1),
              semanticControls: probed.semanticControls,
            };
            if (page.sourceUrlDriftDuringCapture) {
              page.currentUrl = "https://two.example/drifted";
            }
            return extracted;
          }
          if (request.kind === "find") {
            return {
              text: page.sourceText.slice(0, request.limit),
              truncated: page.sourceText.length > request.limit,
            };
          }
          const before = page.scrollY;
          page.scrollY = Math.max(
            0,
            Math.min(2_100, page.scrollY + request.deltaY),
          );
          const text = `Viewport evidence at ${String(page.scrollY)}`;
          return {
            deltaY: page.scrollY - before,
            positionY: page.scrollY,
            viewportHeight: 900,
            documentHeight: 3_000,
            atStart: page.scrollY === 0,
            atEnd: page.scrollY === 2_100,
            text: text.slice(0, request.textLimit),
            textTruncated: text.length > request.textLimit,
          };
        }
        const capturedUrl = page.currentUrl;
        const extracted = {
          url: capturedUrl,
          title:
            page.sourceTitle ??
            (capturedUrl === "about:blank"
              ? ""
              : `Page ${new URL(capturedUrl).hostname}`),
          text: page.sourceText.slice(0, request + 1),
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

  readonly mouse = {
    click: async (x: number, y: number) => {
      this.visualClicks.push({ x, y });
    },
  };

  readonly keyboard = {
    press: async (key: string) => {
      this.pressedKeys.push(key);
    },
  };

  async waitForTimeout(durationMs: number) {
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(durationMs, 1)),
    );
  }

  async waitForEvent(event: string) {
    if (event !== "download") throw new Error(`Unexpected event: ${event}`);
    return this.download as unknown as Download;
  }

  on(event: string, listener: () => unknown) {
    if (event === "close") this.closeListener = listener;
    return this as unknown as Page;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.closeListener?.();
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export class FakeDownload {
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
