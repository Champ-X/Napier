import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Route,
} from "playwright-core";

import type {
  BrowserPreparedUpload,
  BrowserWorkspaceFile,
} from "./browser-workspace-files.js";
import {
  type BrowserPageFileRequest,
  performBrowserPageFileOperation,
} from "./browser-page-file-operation.js";
import {
  isBrowserObservationRequest,
  performBrowserPageObservation,
} from "./browser-page-observation.js";
import { reserveBrowserOperation } from "./browser-operation-budget.js";
import { captureBrowserPageSource } from "./browser-source-capture.js";
import {
  BROWSER_ACTION_TIMEOUT_MS,
  BROWSER_LIMITS_SHA256,
  BROWSER_NAVIGATION_TIMEOUT_MS,
  MAX_BROWSER_WAIT_MS,
  type BrowserNetworkProxy,
  type BrowserPageSourceCapture,
  type BrowserRuntimeBinding,
  type BrowserSessionOperationResult,
  type BrowserSessionRequest,
  MAX_BROWSER_SCREENSHOT_BYTES,
  MAX_BROWSER_SESSION_OPERATIONS,
  MAX_BROWSER_SNAPSHOT_CHARS,
  type RunBrowserSessionManagerOptions,
} from "./browser-session-model.js";
import {
  createBrowserSessionDetails,
  type BrowserSessionPageState,
} from "./browser-session-details.js";
import { BrowserSessionNavigation } from "./browser-session-navigation.js";
import {
  isBrowserPageSpecialRequest,
  performBrowserPageSpecialOperation,
} from "./browser-page-tab-operation.js";
import { BrowserSessionTabs } from "./browser-session-tabs.js";
import {
  assertBrowserRuntimeCurrent,
  browserContextOptions,
  browserLaunchOptions,
  resolveBrowserRuntime,
} from "./browser-runtime.js";
import { createBrowserPageOperationResult } from "./browser-page-output.js";
import {
  captureBrowserPageMetadata,
  captureBrowserPageState,
} from "./browser-page-state.js";
import { captureBrowserPageConfirmationState } from "./browser-page-confirmation-state.js";
import type { BrowserConfirmedPageRequest } from "./browser-confirmed-action.js";
import { browserPageLocator } from "./browser-page-locator.js";
import { performBrowserPageUpload } from "./browser-page-upload.js";
import { sha256 } from "./ed25519.js";
import { FixedIpHttpProxy } from "./fixed-ip-http-proxy.js";
import type { BrowserSessionOwner } from "./browser-session-model.js";
import { BrowserAllowedUrls } from "./browser-allowed-url.js";

export class PersistentBrowserSession {
  readonly idSha256 = sha256(`browser-session:${randomUUID()}`);
  operationCount = 0;
  private readonly tabs: BrowserSessionTabs;
  private readonly navigation = new BrowserSessionNavigation();
  private blockedRequestCount = 0;
  private downloadAuthorized = false;
  private closing = false;
  private closed = false;
  private disconnected = false;

  get healthy(): boolean {
    return (
      !this.closing && !this.closed && !this.disconnected && this.tabs.healthy
    );
  }

  private constructor(
    private readonly workspaceRoot: string,
    private readonly urls: BrowserAllowedUrls,
    private readonly runtime: BrowserRuntimeBinding,
    private readonly proxy: BrowserNetworkProxy,
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    page: Page,
    private readonly browserVersionSha256: string,
    private readonly runtimeRoot: string,
  ) {
    this.tabs = new BrowserSessionTabs(context, page);
    this.configurePage(page);
  }

  static async start(
    options: RunBrowserSessionManagerOptions,
    owner: BrowserSessionOwner,
  ): Promise<PersistentBrowserSession> {
    const runtime = await (options.resolveRuntime
      ? options.resolveRuntime()
      : resolveBrowserRuntime(options.executablePath));
    const proxy =
      options.createProxy?.() ??
      new FixedIpHttpProxy({
        ...(options.lookup ? { lookup: options.lookup } : {}),
      });
    const runtimeRoot = await mkdtemp(
      path.join(tmpdir(), "napier-browser-session-"),
    );
    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    try {
      const binding = await proxy.start();
      await assertBrowserRuntimeCurrent(runtime);
      browser = await (
        options.launchBrowser ?? ((launch) => chromium.launch(launch))
      )(browserLaunchOptions(runtime, binding, runtimeRoot));
      await assertBrowserRuntimeCurrent(runtime);
      context = await browser.newContext(browserContextOptions());
      context.setDefaultTimeout(BROWSER_ACTION_TIMEOUT_MS);
      context.setDefaultNavigationTimeout(BROWSER_NAVIGATION_TIMEOUT_MS);
      const page = await context.newPage();
      const session = new PersistentBrowserSession(
        options.workspaceRoot,
        new BrowserAllowedUrls(
          owner,
          options.localServiceLeases,
          options.lookup,
        ),
        runtime,
        proxy,
        browser,
        context,
        page,
        sha256(browser.version()),
        runtimeRoot,
      );
      browser.on("disconnected", () => {
        session.disconnected = true;
      });
      await context.route("**/*", (route) => session.handleRoute(route));
      context.on("page", (candidate) => {
        session.tabs.rejectUnmanaged(candidate);
      });
      return session;
    } catch (error) {
      await Promise.allSettled([
        ...(context ? [context.close()] : []),
        ...(browser ? [browser.close()] : []),
        proxy.close(),
      ]);
      await rm(runtimeRoot, { recursive: true, force: true });
      throw error;
    }
  }
  async execute(
    request: BrowserSessionRequest,
    reused: boolean,
    signal?: AbortSignal,
    countOperation = true,
    preparedUpload?: BrowserPreparedUpload,
  ): Promise<BrowserSessionOperationResult> {
    if (!this.healthy) throw new Error("Browser Session is unavailable");
    this.operationCount = reserveBrowserOperation(
      this.operationCount,
      countOperation,
    );
    const operation = this.perform(request, reused, signal, preparedUpload);
    return abortable(operation, signal, async () => this.close());
  }
  async capturePage(
    maxChars: number,
    signal?: AbortSignal,
  ): Promise<BrowserPageSourceCapture> {
    if (!this.healthy) throw new Error("Browser Session is unavailable");
    if (
      !Number.isSafeInteger(maxChars) ||
      maxChars < 1_000 ||
      maxChars > MAX_BROWSER_SNAPSHOT_CHARS
    ) {
      throw new Error("Browser source capture character limit is invalid");
    }
    if (this.operationCount >= MAX_BROWSER_SESSION_OPERATIONS)
      throw new Error("Browser Session operation limit reached");
    this.operationCount += 1;
    return abortable(
      this.captureCurrentPage(maxChars, signal),
      signal,
      async () => this.close(),
    );
  }
  async captureConfirmationPageState(
    request: BrowserConfirmedPageRequest,
    signal?: AbortSignal,
  ) {
    return await captureBrowserPageConfirmationState({
      page: this.tabs.activePage,
      target: request.target,
      action: request.action,
      locator: browserPageLocator,
      sessionOperation: this.operationCount,
      sessionIdSha256: this.idSha256,
      tabs: this.tabs.evidence(),
      ...(signal ? { signal } : {}),
    });
  }
  async close(): Promise<void> {
    if (this.closed || this.closing) return;
    this.closing = true;
    await Promise.allSettled([
      this.context.close(),
      this.browser.close(),
      this.proxy.close(),
    ]);
    await rm(this.runtimeRoot, { recursive: true, force: true }).catch(
      () => undefined,
    );
    this.closed = true;
    this.closing = false;
  }

  private async perform(
    request: BrowserSessionRequest,
    reused: boolean,
    signal?: AbortSignal,
    preparedUpload?: BrowserPreparedUpload,
  ): Promise<BrowserSessionOperationResult> {
    const page = this.tabs.activePage;
    if (isBrowserObservationRequest(request)) {
      return performBrowserPageObservation({
        page,
        request,
        reused,
        operation: this.operationCount,
        sessionIdSha256: this.idSha256,
        executableSha256: this.runtime.executableSha256,
        browserVersionSha256: this.browserVersionSha256,
        tabs: this.tabs.evidence(),
        blockedRequestCount: this.blockedRequestCount,
        network: this.proxy.snapshot(),
        ...(signal ? { signal } : {}),
      });
    }
    let state: BrowserSessionPageState;
    let file: BrowserWorkspaceFile | undefined;
    let suggestedFilenameSha256: string | undefined;
    let screenshot: Buffer | undefined;
    let listedTabs:
      | Awaited<ReturnType<BrowserSessionTabs["descriptors"]>>
      | undefined;
    const crossOriginAuthorized =
      "allowCrossOrigin" in request && request.allowCrossOrigin === true;

    if (isBrowserPageSpecialRequest(request)) {
      const tabResult = await performBrowserPageSpecialOperation({
        request,
        tabs: this.tabs,
        navigation: this.navigation,
        preflightNavigation: (targetPage, value, allowed) =>
          this.preflightNavigation(targetPage, value, allowed),
        withNetwork: (operation) => this.withNetwork(operation),
        configurePage: (targetPage) => this.configurePage(targetPage),
        pageState: (targetPage, targetSignal) =>
          captureBrowserPageState(targetPage, targetSignal),
        performFileOperation: (
          targetPage,
          fileRequest: BrowserPageFileRequest,
          targetSignal,
        ) =>
          performBrowserPageFileOperation({
            page: targetPage,
            request: fileRequest,
            workspaceRoot: this.workspaceRoot,
            navigation: this.navigation,
            locator: browserPageLocator,
            preflightNavigation: (navigationPage, value, allowed) =>
              this.preflightNavigation(navigationPage, value, allowed),
            withNetwork: (operation) => this.withNetwork(operation),
            setDownloadAuthorized: (authorized) => {
              this.downloadAuthorized = authorized;
            },
            ...(targetSignal ? { signal: targetSignal } : {}),
          }),
        ...(signal ? { signal } : {}),
      });
      state = tabResult.state;
      listedTabs = tabResult.listedTabs;
      file = tabResult.file;
      suggestedFilenameSha256 = tabResult.suggestedFilenameSha256;
    } else
      switch (request.action) {
        case "start":
        case "navigate": {
          const url = await this.preflightNavigation(
            page,
            request.url,
            request.allowCrossOrigin === true,
          );
          await this.withNetwork(() =>
            this.navigation.run(page, request.allowCrossOrigin === true, () =>
              page.goto(url.href, {
                waitUntil: "domcontentloaded",
                timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
              }),
            ),
          );
          state = await captureBrowserPageState(page, signal);
          break;
        }
        case "back":
          await this.withNetwork(() =>
            this.navigation.run(
              page,
              request.allowCrossOrigin === true,
              async () => {
                const response = await page.goBack({
                  waitUntil: "domcontentloaded",
                  timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
                });
                if (!response) {
                  throw new Error("Browser Session has no back entry");
                }
              },
            ),
          );
          state = await captureBrowserPageState(page, signal);
          break;
        case "forward":
          await this.withNetwork(() =>
            this.navigation.run(
              page,
              request.allowCrossOrigin === true,
              async () => {
                const response = await page.goForward({
                  waitUntil: "domcontentloaded",
                  timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
                });
                if (!response) {
                  throw new Error("Browser Session has no forward entry");
                }
              },
            ),
          );
          state = await captureBrowserPageState(page, signal);
          break;
        case "wait":
          await this.withNetwork(() =>
            page.waitForTimeout(
              Math.min(request.durationMs ?? 1_000, MAX_BROWSER_WAIT_MS),
            ),
          );
          state = await captureBrowserPageState(page, signal);
          break;
        case "snapshot":
          state = await captureBrowserPageState(page, signal);
          break;
        case "click":
          await this.withNetwork(() =>
            this.navigation.run(page, request.allowCrossOrigin === true, () =>
              browserPageLocator(page, request.target).click({
                timeout: BROWSER_ACTION_TIMEOUT_MS,
              }),
            ),
          );
          state = await captureBrowserPageState(page, signal);
          break;
        case "type":
          await this.withNetwork(() =>
            browserPageLocator(page, request.target).fill(request.text, {
              timeout: BROWSER_ACTION_TIMEOUT_MS,
            }),
          );
          state = await captureBrowserPageState(page, signal);
          break;
        case "select":
          await this.withNetwork(() =>
            browserPageLocator(page, request.target).selectOption(
              request.values,
              {
                timeout: BROWSER_ACTION_TIMEOUT_MS,
              },
            ),
          );
          state = await captureBrowserPageState(page, signal);
          break;
        case "upload":
          file = await performBrowserPageUpload({
            page,
            target: request.target,
            path: request.path,
            workspaceRoot: this.workspaceRoot,
            ...(preparedUpload ? { prepared: preparedUpload } : {}),
            locator: browserPageLocator,
            withNetwork: (operation) => this.withNetwork(operation),
          });
          state = await captureBrowserPageState(page, signal);
          break;
        case "screenshot":
          screenshot = await page.screenshot({
            type: "png",
            fullPage: false,
            animations: "disabled",
            timeout: BROWSER_ACTION_TIMEOUT_MS,
          });
          if (screenshot.byteLength > MAX_BROWSER_SCREENSHOT_BYTES) {
            throw new Error("Browser screenshot exceeds the output limit");
          }
          state = await captureBrowserPageMetadata(page, signal);
          break;
        case "close":
          state = await captureBrowserPageMetadata(page, signal);
          break;
      }

    const details = createBrowserSessionDetails({
      action: request.action,
      reused,
      operation: this.operationCount,
      sessionIdSha256: this.idSha256,
      executableSha256: this.runtime.executableSha256,
      browserVersionSha256: this.browserVersionSha256,
      tabs: this.tabs.evidence(),
      state,
      crossOriginAuthorized,
      blockedRequestCount: this.blockedRequestCount,
      network: this.proxy.snapshot(),
      ...(file ? { file } : {}),
      ...(suggestedFilenameSha256 ? { suggestedFilenameSha256 } : {}),
      ...(screenshot && request.action === "screenshot" ? { screenshot } : {}),
    });
    return createBrowserPageOperationResult({
      request,
      state,
      details,
      file,
      tabs: listedTabs,
      screenshot: request.action === "screenshot" ? screenshot : undefined,
    });
  }

  private async handleRoute(route: Route): Promise<void> {
    if (this.closing || this.closed) {
      await route.abort("blockedbyclient").catch(() => undefined);
      return;
    }
    const request = route.request();
    const page = this.tabs.pageForRequest(request);
    if (!page || !this.tabs.isActive(page)) {
      this.blockedRequestCount += 1;
      await route.abort("blockedbyclient").catch(() => undefined);
      return;
    }
    let url: URL;
    try {
      url = await this.urls.resolve(request.url());
    } catch {
      this.blockedRequestCount += 1;
      await route.abort("blockedbyclient").catch(() => undefined);
      return;
    }
    if (!this.navigation.authorize(request, page, url.origin)) {
      this.blockedRequestCount += 1;
      await route.abort("blockedbyclient").catch(() => undefined);
      return;
    }
    await route.continue();
  }

  private async preflightNavigation(
    page: Page,
    value: string,
    allowCrossOrigin: boolean,
  ): Promise<URL> {
    const url = await this.urls.resolve(value);
    await this.navigation.preflight(page, url, allowCrossOrigin);
    return url;
  }

  private async withNetwork<T>(operation: () => Promise<T>): Promise<T> {
    this.proxy.setOutboundEnabled(true);
    try {
      return await operation();
    } finally {
      this.proxy.setOutboundEnabled(false);
    }
  }

  private async captureCurrentPage(
    maxChars: number,
    signal?: AbortSignal,
  ): Promise<BrowserPageSourceCapture> {
    return captureBrowserPageSource({
      page: this.tabs.activePage,
      maxChars,
      ...(signal ? { signal } : {}),
      sessionOperation: this.operationCount,
      sessionIdSha256: this.idSha256,
      tabs: this.tabs.evidence(),
      browserExecutableSha256: this.runtime.executableSha256,
      browserVersionSha256: this.browserVersionSha256,
      limitsSha256: BROWSER_LIMITS_SHA256,
      network: this.proxy.snapshot(),
    });
  }

  private configurePage(page: Page): void {
    page.on("dialog", (dialog) => {
      void dialog.dismiss().catch(() => undefined);
    });
    page.on("download", (download) => {
      if (!this.downloadAuthorized || !this.tabs.isActive(page)) {
        void download.cancel().catch(() => undefined);
      }
    });
  }
}

async function abortable<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  onAbort: () => Promise<void>,
): Promise<T> {
  if (!signal) return operation;
  assertNotAborted(signal);
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => {
      void onAbort().finally(() =>
        reject(new Error("Browser Session operation was cancelled")),
      );
    };
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([operation, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
    void operation.catch(() => undefined);
  }
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted)
    throw new Error("Browser Session operation was cancelled");
}
