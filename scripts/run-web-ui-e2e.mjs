import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  assertViewportReceipt,
  assertWebUiE2eReceipt,
  WEB_UI_E2E_KIND,
  WEB_UI_E2E_VIEWPORTS,
  WEB_UI_UX_SCENARIOS,
} from "./web-ui-e2e-contract.mjs";
import { seedWebUiNarrativeFixture } from "./web-ui-e2e-fixture.mjs";
import {
  createWebUiE2eRoot,
  productionEntryReceipt,
  removeWebUiE2eRoot,
  sha256,
  startProductionWebServer,
  startWebUiBrowser,
  WEB_UI_START_TIMEOUT_MS,
} from "./web-ui-e2e-runtime.mjs";
import {
  openWebUiPage,
  readWebUiNarrative,
  readThinkingSummary,
  refreshPreservesWebUiNarrative,
  verifyWebUiArtifactNavigation,
  verifyWebUiLongRunNarrative,
  verifyWebUiRecoveryNarrative,
  verifyWebUiServerRestart,
} from "./web-ui-e2e-narrative.mjs";
import {
  defaultWebUiLayoutBaselinePath,
  verifyWebUiLayoutBaseline,
  writeWebUiLayoutBaseline,
} from "./web-ui-layout-baseline.mjs";

const options = parseArguments(process.argv.slice(2));
const temporaryRoot = await createWebUiE2eRoot();
const receipt = createReceipt();
let browserRuntime;
let serverRuntime;
let operationError;
const cleanupErrors = [];

try {
  debug("seed");
  receipt.productionEntry = await productionEntryReceipt();
  receipt.fixture = await seedWebUiNarrativeFixture(temporaryRoot);
  debug("server");
  serverRuntime = await startProductionWebServer(temporaryRoot);
  receipt.server = serverRuntime.receipt;
  debug("browser");
  browserRuntime = await startWebUiBrowser(temporaryRoot);
  receipt.browser = browserRuntime.receipt;
  await configureBrowserLocale(browserRuntime.browser, "en");

  debug("active-runtime");
  receipt.runtime = await verifyRuntimeScenario(
    browserRuntime.browser,
    serverRuntime.origin,
    receipt.fixture.running,
  );

  debug("desktop-viewports");
  receipt.viewports = [];
  for (const viewport of WEB_UI_E2E_VIEWPORTS) {
    debug(`viewport:${String(viewport.width)}`);
    const viewportReceipt = await inspectViewport(
      browserRuntime.browser,
      serverRuntime.origin,
      viewport,
      receipt.fixture,
    );
    assertViewportReceipt(viewportReceipt);
    receipt.viewports.push(viewportReceipt);
  }

  debug("empty-conversation");
  receipt.empty = await verifyEmptyScenario(
    browserRuntime.browser,
    serverRuntime.origin,
    receipt.fixture.empty,
  );
  debug("recovery");
  receipt.recovery = await verifyWebUiRecoveryNarrative(
    browserRuntime.browser,
    serverRuntime.origin,
    receipt.fixture.recovery,
  );
  debug("long-conversation");
  receipt.longRun = await verifyWebUiLongRunNarrative(
    browserRuntime.browser,
    serverRuntime.origin,
    receipt.fixture.longRun,
  );
  debug("dense-trajectory");
  receipt.trajectory = await verifyTrajectoryScenario(
    browserRuntime.browser,
    serverRuntime.origin,
    receipt.fixture.longRun,
  );
  debug("artifact-navigation");
  receipt.artifactNavigation = await verifyWebUiArtifactNavigation(
    browserRuntime.browser,
    serverRuntime.origin,
    receipt.fixture.artifactNavigation,
  );
  debug("settings-administration");
  receipt.settings = await verifySettingsScenario(
    browserRuntime.browser,
    serverRuntime.origin,
    receipt.fixture,
  );
  debug("chinese-core-locale");
  receipt.locale = await verifyChineseCoreLocale(
    browserRuntime.browser,
    serverRuntime.origin,
    receipt.fixture,
  );
  debug("reconnect");
  receipt.reconnect = await verifyWebUiServerRestart(
    browserRuntime.browser,
    serverRuntime,
    temporaryRoot,
    receipt.fixture,
  );
  serverRuntime = receipt.reconnect.runtime;
  delete receipt.reconnect.runtime;

  receipt.scenarios = createScenarioReceipts(receipt);
  receipt.status = "passed";
  debug("passed");
} catch (error) {
  operationError = error;
} finally {
  await cleanup("browser", async () => {
    if (browserRuntime) await browserRuntime.close();
    receipt.cleanup.browserClosed = true;
  });
  await cleanup("server", async () => {
    if (serverRuntime) await serverRuntime.close();
    receipt.cleanup.serverClosed = true;
  });
  await cleanup("temporary root", async () => {
    await removeWebUiE2eRoot(temporaryRoot);
    receipt.cleanup.temporaryRootRemoved = true;
  });
}

if (operationError || cleanupErrors.length > 0) {
  const errors = operationError
    ? [operationError, ...cleanupErrors]
    : cleanupErrors;
  throw errors.length === 1
    ? errors[0]
    : new AggregateError(errors, "Web UI E2E and cleanup failed");
}

assertWebUiE2eReceipt(receipt);
receipt.layoutBaseline = options.writeLayoutBaseline
  ? await writeWebUiLayoutBaseline(receipt, options.layoutBaselinePath)
  : await verifyWebUiLayoutBaseline(receipt, options.layoutBaselinePath);
const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
if (options.receiptPath) {
  await writeFile(options.receiptPath, serialized, {
    encoding: "utf8",
    mode: 0o600,
  });
}
process.stdout.write(serialized);

async function inspectViewport(browser, origin, viewport, expected) {
  const context = browserContext(browser);
  const consoleErrors = [];
  const page = await openWebUiPage(
    context,
    threadUrl(origin, expected.threadId),
    { width: viewport.width, height: viewport.height },
    (candidate) => {
      candidate.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      candidate.on("pageerror", (error) => consoleErrors.push(error.message));
    },
  );
  try {
    await waitForWorkbench(page);
    const narrative = await readWebUiNarrative(page, expected);
    const refreshPreserved =
      viewport.width === 1_440
        ? await refreshPreservesWebUiNarrative(
            page,
            origin,
            expected,
            narrative,
          )
        : false;
    await settleVisuals(page);

    const initial = await page.evaluate(readInitialContract);
    const layoutSnapshot = await page.evaluate(readLayoutSnapshot);
    const readingAxis = await page.evaluate(readReadingAxis);
    const keyboard = await verifyKeyboardNavigation(page);
    const task = await readTaskContract(page);
    const settings = await readSettingsContract(page, initial.settingsHidden);
    const geometry = await page.evaluate(readPageGeometry);
    const screenshot = await screenshotReceipt(page);
    const thinking = await readThinkingSummary(page);
    const tool = await readCompleteToolContent(page);
    const chrome = await readWorkbenchChrome(page);

    return {
      ...viewport,
      workspaceNavigation: initial.workspaceNavigation,
      conversation: { ...initial.conversation, thinking, tool },
      chrome,
      task,
      settings,
      geometry: {
        ...geometry,
        drawerWithinViewport: settings.drawerWithinViewport,
        horizontalOverflowPx: Math.max(
          initial.horizontalOverflowPx,
          geometry.horizontalOverflowPx,
        ),
      },
      readingAxis,
      layoutSnapshot,
      keyboard,
      narrative: { ...narrative, refreshPreserved },
      console: { errorCount: consoleErrors.length },
      screenshot,
    };
  } finally {
    await page.close();
  }
}

async function verifyEmptyScenario(browser, origin, expected) {
  const page = await openWebUiPage(
    browserContext(browser),
    threadUrl(origin, expected.threadId),
    { width: 1_440, height: 900 },
  );
  try {
    await waitForWorkbench(page);
    await page.locator(".welcome-panel").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    return page.evaluate((title) => {
      const isVisible = (selector) => {
        const element = document.querySelector(selector);
        return (
          element instanceof HTMLElement && element.getClientRects().length > 0
        );
      };
      return {
        title: document
          .querySelector(".thread-heading h1")
          ?.textContent?.trim(),
        welcomeVisible:
          document.querySelector(".welcome-panel") instanceof HTMLElement,
        composerVisible: isVisible(".composer"),
        internalTrialControlsVisible: Boolean(
          document.querySelector(
            ".default-product-trial, .release-product-trial",
          ),
        ),
        titleMatched:
          document.querySelector(".thread-heading h1")?.textContent?.trim() ===
          title,
      };
    }, expected.title);
  } finally {
    await page.close();
  }
}

async function verifyRuntimeScenario(browser, origin, expected) {
  const page = await openWebUiPage(
    browserContext(browser),
    threadUrl(origin, expected.threadId),
    { width: 1_440, height: 900 },
  );
  try {
    await waitForWorkbench(page);
    await page.locator(".task-narrative.phase-working").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    await page.locator(".workbench-browser-rail").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    const inlineArtifact = page.locator(
      `.conversation-artifact[data-artifact-path="${expected.artifactPath}"]`,
    );
    await inlineArtifact.locator(".artifact-inline-preview.is-ready").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    const runningArtifactPreview = await inlineArtifact.evaluate((element) => {
      const frame = element.querySelector(".artifact-inline-preview iframe");
      return {
        visible: frame instanceof HTMLIFrameElement,
        sandbox: frame?.getAttribute("sandbox") ?? null,
        path: element.getAttribute("data-artifact-path"),
      };
    });
    await inlineArtifact.getByRole("button", { name: "Open preview" }).click();
    await page.locator(".artifact-inspector").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    const runningArtifactInspector =
      (
        await page
          .locator(".artifact-inspector-meta span")
          .first()
          .textContent()
      )?.trim() === expected.artifactPath;
    await page.getByRole("button", { name: "Close preview" }).click();
    const browserRail = await page.evaluate(readBrowserRailGeometry);
    const runningComposer = await page.evaluate(() => {
      const composer = document.querySelector(".composer");
      return {
        composerHeight:
          composer instanceof HTMLElement
            ? composer.getBoundingClientRect().height
            : 0,
        fallbackWarningVisible:
          document.querySelector(".composer-readiness-warning") instanceof
          HTMLElement,
      };
    });
    await page.locator("#workspace-view-task").click();
    await page.locator("#task-section-environment").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    const sectionCount = await page
      .locator(".task-section-navigation button")
      .count();
    await page.locator("#task-section-environment").click();
    await page.locator(".task-runtime").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".task-runtime-card h3")].some(
          (heading) => heading.textContent?.trim() === "Browser",
        ),
      undefined,
      { timeout: WEB_UI_START_TIMEOUT_MS },
    );
    return page.evaluate(
      ({
        count,
        runningArtifactInspector,
        runningArtifactPreview,
        runningComposer,
        browserRail,
      }) => {
        const isVisible = (selector) => {
          const element = document.querySelector(selector);
          return (
            element instanceof HTMLElement &&
            element.getClientRects().length > 0
          );
        };
        return {
          ...runningComposer,
          browserRail,
          runningArtifactPreview,
          runningArtifactInspector,
          runningIndicatorVisible: isVisible(
            ".task-narrative.phase-working [aria-live='polite']",
          ),
          runtimeSectionVisible: isVisible("#task-section-environment"),
          sectionCount: count,
          browserSurfaceVisible: [
            ...document.querySelectorAll(".task-runtime-card h3"),
          ].some((heading) => heading.textContent?.trim() === "Browser"),
        };
      },
      {
        count: sectionCount,
        runningArtifactInspector,
        runningArtifactPreview,
        runningComposer,
        browserRail,
      },
    );
  } finally {
    await page.close();
  }
}

async function verifyTrajectoryScenario(browser, origin, expected) {
  const page = await openWebUiPage(
    browserContext(browser),
    threadUrl(origin, expected.threadId),
    { width: 1_440, height: 900 },
  );
  try {
    await waitForWorkbench(page);
    await page.locator("#workspace-view-trajectory").click();
    await page.locator("#trajectory-title").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    await page.locator(".trace-evidence-stack > summary").click();
    await page.locator("#model-harness-title").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    await page.locator("#tool-result-context-pruning-title").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    await page
      .locator(".trace-view-tabs button")
      .filter({ hasText: /^All/u })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".trace-turn li").length > 0 &&
        document.querySelectorAll(".trace-run").length >= 2,
      undefined,
      { timeout: WEB_UI_START_TIMEOUT_MS },
    );
    return page.evaluate(() => {
      const allCount = document.querySelector(
        ".trace-view-tabs button:nth-child(2) span",
      )?.textContent;
      const virtualTables = [
        ...document.querySelectorAll(".trace-run-turns[role='table']"),
      ];
      const semanticRowCount = virtualTables.reduce(
        (total, table) =>
          total + Number(table.getAttribute("aria-rowcount") ?? 0),
        0,
      );
      const mountedRowCount = virtualTables.reduce(
        (total, table) =>
          total + Number(table.getAttribute("data-mounted-row-count") ?? 0),
        0,
      );
      return {
        title:
          document.querySelector("#trajectory-title")?.textContent?.trim() ??
          "",
        eventCount: Number(allCount ?? 0),
        mountedEventRows: document.querySelectorAll(".trace-turn li").length,
        runCount: document.querySelectorAll(".trace-run").length,
        keyVisible: [
          ...document.querySelectorAll(".trace-view-tabs button"),
        ].some((button) => button.textContent?.trim().startsWith("Key")),
        virtualizedTimelineVisible:
          virtualTables.length > 0 &&
          virtualTables.every((table) =>
            table.querySelector(".trace-virtual-viewport"),
          ),
        semanticRowCount,
        virtualMountedRowCount: mountedRowCount,
        harnessVisible:
          document.querySelector("#model-harness-title") instanceof HTMLElement,
        harnessFocused: [
          ...document.querySelectorAll(
            ".model-context-envelope-card header span",
          ),
        ].some((element) => element.textContent?.includes("generic · focused")),
        contextPruningVisible:
          document.querySelector(
            "#tool-result-context-pruning-title",
          ) instanceof HTMLElement,
        contextPruningSaved: [
          ...document.querySelectorAll(".model-context-envelope-card dl div"),
        ].some((element) =>
          element.textContent?.includes("Text saved35.2 KiB"),
        ),
        contextContinuityVisible:
          document.querySelector(
            "#context-checkpoint-continuity-title",
          ) instanceof HTMLElement,
        contextContinuityBound: [
          ...document.querySelectorAll(
            ".model-context-envelope-card header span",
          ),
        ].some((element) =>
          element.textContent?.includes("Execution state bound"),
        ),
      };
    });
  } finally {
    await page.close();
  }
}

async function verifySettingsScenario(browser, origin, expected) {
  const page = await openWebUiPage(
    browserContext(browser),
    threadUrl(origin, expected.threadId),
    { width: 1_440, height: 900 },
  );
  try {
    await waitForWorkbench(page);
    const defaultProductTrialHidden = await page.evaluate(
      () =>
        document.querySelector(
          ".default-product-trial, .release-product-trial",
        ) === null,
    );
    await page.locator(".workbench-settings:not(.workbench-developer)").click();
    await page.locator(".workspace-settings-surface").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    await settleVisuals(page);

    await page.locator(".agent-history-register").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    await page.waitForFunction(
      () => {
        const selectors = [
          ".agent-history-register button",
          ".credential-register .credential-add, .credential-register .credential-card footer button, .credential-register .context-field input, .credential-register .context-field select, .credential-register .credential-vault-check",
        ];
        return selectors.every((selector) => {
          const controls = [...document.querySelectorAll(selector)].filter(
            (control) =>
              control instanceof HTMLElement && control.offsetParent !== null,
          );
          return (
            controls.length > 0 &&
            controls.every(
              (control) => control.getBoundingClientRect().height >= 44,
            )
          );
        });
      },
      undefined,
      { timeout: WEB_UI_START_TIMEOUT_MS },
    );
    const revisionHistory = await page.evaluate(() => {
      const register = document.querySelector(".agent-history-register");
      if (!(register instanceof HTMLElement)) {
        throw new Error("Agent revision history is missing");
      }
      const visibleTextElements = [...register.querySelectorAll("*")].filter(
        (element) =>
          element instanceof HTMLElement &&
          element.offsetParent !== null &&
          (element.childNodes.length === 0 ||
            [...element.childNodes].some(
              (node) =>
                node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
            )),
      );
      const buttons = [...register.querySelectorAll("button")].filter(
        (button) => button.offsetParent !== null,
      );
      return {
        visible: true,
        minimumFontPx: Math.min(
          ...visibleTextElements.map((element) =>
            Number.parseFloat(getComputedStyle(element).fontSize),
          ),
        ),
        minimumButtonHeight: Math.min(
          ...buttons.map((button) => button.getBoundingClientRect().height),
        ),
      };
    });
    const ordinaryGovernanceHidden = await page.evaluate(() =>
      [
        ".extension-package-desk",
        ".skill-package-desk",
        ".prompt-package-desk",
        ".developer-tools",
        ".design-showcase",
        ".automation-panel",
        ".receipt-trust-workbench",
      ].every((selector) => document.querySelector(selector) === null),
    );
    const credentialRegister = await page.evaluate(() => {
      const register = document.querySelector(".credential-register");
      if (!(register instanceof HTMLElement)) {
        throw new Error("Credential register is missing");
      }
      const visibleTextElements = [...register.querySelectorAll("*")].filter(
        (element) =>
          element instanceof HTMLElement &&
          element.offsetParent !== null &&
          (element.childNodes.length === 0 ||
            [...element.childNodes].some(
              (node) =>
                node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
            )),
      );
      const controls = [
        ...register.querySelectorAll(
          ".credential-add, .credential-card footer button, .context-field input, .context-field select, .credential-vault-check",
        ),
      ].filter(
        (control) =>
          control instanceof HTMLElement && control.offsetParent !== null,
      );
      return {
        visible: true,
        minimumFontPx: Math.min(
          ...visibleTextElements.map((element) =>
            Number.parseFloat(getComputedStyle(element).fontSize),
          ),
        ),
        minimumControlHeight: Math.min(
          ...controls.map((control) => control.getBoundingClientRect().height),
        ),
      };
    });

    await focusBoundary(page, "first");
    await page.keyboard.press("Shift+Tab");
    const focusTrappedBackward = await boundaryFocused(page, "last");
    await focusBoundary(page, "last");
    await page.keyboard.press("Tab");
    const focusTrappedForward = await boundaryFocused(page, "first");

    const modal = await page
      .locator(".workspace-settings-surface")
      .getAttribute("aria-modal")
      .then((value) => value === "true");
    const dialog = await page
      .locator(".workspace-settings-surface")
      .getAttribute("role")
      .then((value) => value === "dialog");

    await page.keyboard.press("Escape");
    await waitForSettingsClosed(page);
    const escapeRestoredTriggerFocus = await page.evaluate(
      () =>
        document.activeElement?.classList.contains("workbench-settings") ??
        false,
    );

    await page.locator(".workbench-developer").click();
    await page.locator(".developer-workbench-surface").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    await page.locator(".developer-tools").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    const developerProductTrialAvailable = await page
      .locator(".developer-tool > summary")
      .filter({ hasText: /Product trial/iu })
      .count()
      .then((count) => count === 1);
    await page.locator(".receipt-trust-workbench").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    const receiptTrustAvailable = true;
    const developerLabels = await page
      .locator(".developer-workbench-surface .settings-navigation strong")
      .allTextContents();
    const developerModal = await page
      .locator(".developer-workbench-surface")
      .getAttribute("aria-modal")
      .then((value) => value === "true");
    const developerDialog = await page
      .locator(".developer-workbench-surface")
      .getAttribute("role")
      .then((value) => value === "dialog");
    await page.locator("#developer-section-publishing").click();
    await page.locator(".extension-package-desk").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    const packageManagement = await page.evaluate(() => {
      const desks = [
        ...document.querySelectorAll(
          ".extension-package-desk, .skill-package-desk, .prompt-package-desk",
        ),
      ].filter(
        (desk) => desk instanceof HTMLElement && desk.offsetParent !== null,
      );
      const visibleTextElements = desks.flatMap((desk) =>
        [...desk.querySelectorAll("*")].filter(
          (element) =>
            element instanceof HTMLElement &&
            element.offsetParent !== null &&
            (element.childNodes.length === 0 ||
              [...element.childNodes].some(
                (node) =>
                  node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
              )),
        ),
      );
      const actions = desks
        .flatMap((desk) => [
          ...desk.querySelectorAll(
            ".package-actions button, .package-file-action",
          ),
        ])
        .filter(
          (action) =>
            action instanceof HTMLElement && action.offsetParent !== null,
        );
      return {
        count: desks.length,
        minimumFontPx: Math.min(
          ...visibleTextElements.map((element) =>
            Number.parseFloat(getComputedStyle(element).fontSize),
          ),
        ),
        minimumActionHeight: Math.min(
          ...actions.map((action) => action.getBoundingClientRect().height),
        ),
      };
    });

    await page.keyboard.press("Escape");
    await waitForDeveloperWorkbenchClosed(page);
    const developerEscapeRestoredTriggerFocus = await page.evaluate(
      () =>
        document.activeElement?.classList.contains("workbench-developer") ??
        false,
    );
    return {
      dialog,
      modal,
      focusTrappedForward,
      focusTrappedBackward,
      escapeRestoredTriggerFocus,
      defaultProductTrialHidden,
      ordinaryGovernanceHidden,
      developerDialog,
      developerModal,
      developerLabels: developerLabels.map((label) => label.trim()),
      developerProductTrialAvailable,
      receiptTrustAvailable,
      developerEscapeRestoredTriggerFocus,
      revisionHistoryVisible: revisionHistory.visible,
      revisionHistoryMinimumFontPx: revisionHistory.minimumFontPx,
      revisionHistoryMinimumButtonHeight: revisionHistory.minimumButtonHeight,
      publishingSurfaceCount: packageManagement.count,
      packageManagementMinimumFontPx: packageManagement.minimumFontPx,
      packageManagementMinimumActionHeight:
        packageManagement.minimumActionHeight,
      credentialRegisterVisible: credentialRegister.visible,
      credentialRegisterMinimumFontPx: credentialRegister.minimumFontPx,
      credentialRegisterMinimumControlHeight:
        credentialRegister.minimumControlHeight,
    };
  } finally {
    await page.close();
  }
}

async function verifyChineseCoreLocale(browser, origin, expected) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.localStorage.setItem("napier.locale", "zh");
  });
  const page = await openWebUiPage(
    context,
    threadUrl(origin, expected.threadId),
    { width: 1_440, height: 900 },
  );
  try {
    await waitForWorkbench(page);
    const workspaceLabels = await page
      .locator(".workspace-view-tabs strong")
      .allTextContents();
    const composerPlaceholder =
      (await page.locator(".composer textarea").getAttribute("placeholder")) ??
      "";
    await page.locator("#workspace-view-task").click();
    await page.locator("#task-section-overview").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    const taskSections = await page
      .locator(".task-section-navigation button")
      .allTextContents();

    await page.locator("#workspace-view-trajectory").click();
    await page.locator("#trajectory-title").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    const trajectoryTitles = await page.evaluate(() => ({
      page: document.querySelector("#trace-title")?.textContent?.trim() ?? "",
      map:
        document.querySelector("#trajectory-title")?.textContent?.trim() ?? "",
    }));

    await page.locator("#workspace-view-conversation").click();
    await page.locator(".workbench-settings:not(.workbench-developer)").click();
    await page.locator(".workspace-settings-surface").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    const settingsLabels = await page
      .locator(".settings-navigation strong")
      .allTextContents();
    await page.locator("#context-title").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    await page.locator("#credential-register-title").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    const contextTitles = await page.evaluate(() => ({
      page: document.querySelector("#context-title")?.textContent?.trim() ?? "",
      model:
        document.querySelector("#runtime-model-title")?.textContent?.trim() ??
        "",
      credentials:
        document
          .querySelector("#credential-register-title")
          ?.textContent?.trim() ?? "",
    }));

    await page.keyboard.press("Escape");
    await waitForSettingsClosed(page);
    await page.locator(".workbench-developer").click();
    await page.locator("#developer-section-lab").click();
    const workflowStudio = page
      .locator(".developer-tool")
      .filter({ hasText: "工作流工作室" });
    await workflowStudio.locator("summary").click();
    await page.locator(".plan-studio-heading h2").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    await page.locator("#plan-blueprint-library-title").waitFor({
      state: "visible",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    const planTitles = await page.evaluate(() => ({
      studio:
        document
          .querySelector(".plan-studio-heading h2")
          ?.textContent?.trim() ?? "",
      library:
        document
          .querySelector("#plan-blueprint-library-title")
          ?.textContent?.trim() ?? "",
      refresh:
        [...document.querySelectorAll(".plan-blueprint-library-card button")]
          .find((button) => button.textContent?.includes("刷新模板库"))
          ?.textContent?.trim() ?? "",
    }));
    const lang = await page.locator("html").getAttribute("lang");
    const developerLabels = await page
      .locator(".developer-workbench-surface .settings-navigation strong")
      .allTextContents();
    await page.keyboard.press("Escape");
    await waitForDeveloperWorkbenchClosed(page);
    return {
      lang,
      workspaceLabels: workspaceLabels.map((label) => label.trim()),
      taskSections: taskSections.map((label) => label.trim()),
      settingsLabels: settingsLabels.map((label) => label.trim()),
      developerLabels: developerLabels.map((label) => label.trim()),
      composerPlaceholder,
      trajectoryTitles,
      contextTitles,
      planTitles,
    };
  } finally {
    await page.close();
    await context.close();
  }
}

async function verifyKeyboardNavigation(page) {
  await page.locator("#workspace-view-conversation").click();
  await page.locator("#workspace-view-conversation").focus();
  await page.keyboard.press("ArrowRight");
  await waitForFocusAndSelection(page, "workspace-view-task");
  await page.keyboard.press("End");
  await waitForFocusAndSelection(page, "workspace-view-trajectory");
  await page.keyboard.press("Home");
  await waitForFocusAndSelection(page, "workspace-view-conversation");

  await page.locator("#workspace-view-task").click();
  await page.locator("#task-section-overview").waitFor({
    state: "visible",
    timeout: WEB_UI_START_TIMEOUT_MS,
  });
  await page.locator("#task-section-overview").focus();
  await page.keyboard.press("End");
  await waitForFocusAndSelection(page, "task-section-validation");
  await page.keyboard.press("Home");
  await waitForFocusAndSelection(page, "task-section-overview");
  await page.locator("#workspace-view-conversation").click();
  await page
    .locator(".conversation-workspace-view")
    .waitFor({ state: "visible" });
  return {
    workspaceNavigationPassed: true,
    taskNavigationPassed: true,
  };
}

async function readTaskContract(page) {
  await page.locator("#workspace-view-task").click();
  await page.locator(".task-section-navigation").waitFor({
    state: "visible",
    timeout: WEB_UI_START_TIMEOUT_MS,
  });
  const contract = await page.evaluate(() => {
    const sections = [
      ...document.querySelectorAll(".task-section-navigation button"),
    ];
    const selected = sections.find(
      (section) => section.getAttribute("aria-selected") === "true",
    );
    return {
      sections: sections.map((section) => section.textContent?.trim() ?? ""),
      sectionCount: sections.length,
      defaultSection: selected?.id.replace("task-section-", "") ?? "",
      internalTrialControlsVisible: Boolean(
        document.querySelector(
          ".default-product-trial, .release-product-trial",
        ),
      ),
    };
  });
  await page.locator("#workspace-view-conversation").click();
  return contract;
}

async function readSettingsContract(page, initiallyHidden) {
  await page.locator(".workbench-settings:not(.workbench-developer)").click();
  await page.locator(".workspace-settings-surface").waitFor({
    state: "visible",
    timeout: WEB_UI_START_TIMEOUT_MS,
  });
  await settleVisuals(page);
  const contract = await page.evaluate((hidden) => {
    const surface = document.querySelector(".workspace-settings-surface");
    const sections = [
      ...document.querySelectorAll(".settings-navigation button"),
    ];
    if (!(surface instanceof HTMLElement)) {
      throw new Error("Settings dialog is missing");
    }
    const bounds = surface.getBoundingClientRect();
    return {
      initiallyHidden: hidden,
      dialog: surface.getAttribute("role") === "dialog",
      modal: surface.getAttribute("aria-modal") === "true",
      labels: sections.map(
        (section) => section.querySelector("strong")?.textContent?.trim() ?? "",
      ),
      minimumSectionHeight: Math.min(
        ...sections.map((section) => section.getBoundingClientRect().height),
      ),
      drawerWithinViewport:
        bounds.left >= 0 &&
        bounds.top >= 0 &&
        bounds.right <= window.innerWidth &&
        bounds.bottom <= window.innerHeight,
    };
  }, initiallyHidden);
  await page.keyboard.press("Escape");
  await waitForSettingsClosed(page);
  return {
    ...contract,
    escapeRestoredTriggerFocus: await page.evaluate(
      () =>
        document.activeElement?.classList.contains("workbench-settings") ??
        false,
    ),
    closedAfterEscape: true,
  };
}

async function waitForWorkbench(page) {
  await page.locator("#workspace-view-conversation").waitFor({
    state: "visible",
    timeout: WEB_UI_START_TIMEOUT_MS,
  });
  await page.waitForFunction(
    () => {
      const composer = document.querySelector(".agent-capability-composer");
      return (
        composer &&
        !composer.classList.contains("state-loading") &&
        document
          .querySelector(".composer")
          ?.getAttribute("data-run-readiness") !== "checking" &&
        ![...document.querySelectorAll(".composer-readiness-item")].some(
          (item) => item.textContent?.includes("Checking"),
        )
      );
    },
    undefined,
    { timeout: WEB_UI_START_TIMEOUT_MS },
  );
  await settleVisuals(page);
}

async function settleVisuals(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(220);
}

async function waitForSettingsClosed(page) {
  await page.waitForFunction(
    () =>
      document.querySelector(".workspace-settings-surface") === null &&
      document.activeElement?.classList.contains("workbench-settings") === true,
    undefined,
    { timeout: 5_000 },
  );
}

async function waitForDeveloperWorkbenchClosed(page) {
  await page.waitForFunction(
    () =>
      document.querySelector(".developer-workbench-surface") === null &&
      document.activeElement?.classList.contains("workbench-developer") ===
        true,
    undefined,
    { timeout: 5_000 },
  );
}

async function waitForFocusAndSelection(page, id) {
  await page.waitForFunction(
    (targetId) => {
      const target = document.getElementById(targetId);
      return (
        document.activeElement === target &&
        target?.getAttribute("aria-selected") === "true"
      );
    },
    id,
    { timeout: 5_000 },
  );
}

async function focusBoundary(page, boundary) {
  await page.evaluate((targetBoundary) => {
    const surface = document.querySelector(".workspace-settings-surface");
    if (!(surface instanceof HTMLElement)) return;
    const elements = [
      ...surface.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), details > summary, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter(
      (element) =>
        element instanceof HTMLElement && element.getClientRects().length > 0,
    );
    const target = targetBoundary === "first" ? elements[0] : elements.at(-1);
    if (target instanceof HTMLElement) target.focus();
  }, boundary);
}

async function boundaryFocused(page, boundary) {
  return page.evaluate((targetBoundary) => {
    const surface = document.querySelector(".workspace-settings-surface");
    if (!(surface instanceof HTMLElement)) return false;
    const elements = [
      ...surface.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), details > summary, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter(
      (element) =>
        element instanceof HTMLElement && element.getClientRects().length > 0,
    );
    const target = targetBoundary === "first" ? elements[0] : elements.at(-1);
    return document.activeElement === target;
  }, boundary);
}

function readInitialContract() {
  const isVisible = (selector) => {
    const element = document.querySelector(selector);
    return (
      element instanceof HTMLElement && element.getClientRects().length > 0
    );
  };
  const workspaceButtons = [
    ...document.querySelectorAll(".workspace-view-tabs button"),
  ];
  const selected = workspaceButtons.find(
    (button) => button.getAttribute("aria-selected") === "true",
  );
  return {
    horizontalOverflowPx: Math.max(
      0,
      document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
    settingsHidden:
      document.querySelector(".workspace-settings-surface") === null,
    workspaceNavigation: {
      labels: workspaceButtons.map(
        (button) => button.querySelector("strong")?.textContent?.trim() ?? "",
      ),
      selected: selected?.id.replace("workspace-view-", "") ?? "",
      minimumHeight: Math.min(
        ...workspaceButtons.map(
          (button) => button.getBoundingClientRect().height,
        ),
      ),
    },
    conversation: {
      messageCount: document.querySelectorAll(".message-card").length,
      waitingApprovalVisible: isVisible(
        ".conversation-approval.status-pending",
      ),
      internalTrialControlsVisible: Boolean(
        document.querySelector(
          ".default-product-trial, .release-product-trial",
        ),
      ),
    },
  };
}

async function readCompleteToolContent(page) {
  const tool = page.locator(".conversation-tool-activity").first();
  await tool.waitFor({ state: "visible", timeout: WEB_UI_START_TIMEOUT_MS });
  const initiallyOpen = (await tool.getAttribute("open")) !== null;
  if (!initiallyOpen) await tool.locator(":scope > summary").click();
  const receipt = await tool.evaluate((root) => {
    const sections = [
      ...root.querySelectorAll(".conversation-tool-content > section"),
    ];
    const content = new Map(
      sections.map((section) => [
        section.querySelector(":scope > span")?.textContent?.trim() ?? "",
        section.querySelector("pre")?.textContent ?? "",
      ]),
    );
    return {
      visible: root.getClientRects().length > 0,
      input: content.get("Diff") ?? "",
      output: content.get("Result") ?? "",
      inputLabel: content.has("Diff") ? "Diff" : "",
      outputLabel: content.has("Result") ? "Result" : "",
      horizontalOverflowPx: Math.max(
        0,
        document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    };
  });
  if (!initiallyOpen) await tool.locator(":scope > summary").click();
  return receipt;
}

async function readWorkbenchChrome(page) {
  return page.evaluate(() => {
    const header = document.querySelector(".workbench-header");
    const textarea = document.querySelector(".composer textarea");
    const composer = document.querySelector(".composer");
    if (
      !(header instanceof HTMLElement) ||
      !(textarea instanceof HTMLTextAreaElement) ||
      !(composer instanceof HTMLElement)
    ) {
      throw new Error("Workbench chrome is incomplete");
    }
    textarea.focus();
    const textareaStyle = getComputedStyle(textarea);
    const composerStyle = getComputedStyle(composer);
    const headerBounds = header.getBoundingClientRect();
    const compactModelTrigger = header.querySelector(
      ".model-picker.is-compact .model-picker-trigger",
    );
    const compactModelCopy =
      compactModelTrigger?.querySelector(".model-chip-copy");
    const regions = [
      header.querySelector(".thread-heading"),
      header.querySelector(".workspace-view-navigation"),
      header.querySelector(".run-meta"),
    ]
      .filter(
        (element) =>
          element instanceof HTMLElement && element.getClientRects().length > 0,
      )
      .map((element) => element.getBoundingClientRect())
      .sort((left, right) => left.left - right.left);
    const receipt = {
      headerNoOverlap: regions.every(
        (region, index) =>
          index === 0 || region.left >= regions[index - 1].right - 1,
      ),
      headerContentWithinBounds: regions.every(
        (region) =>
          region.left >= headerBounds.left - 1 &&
          region.right <= headerBounds.right + 1 &&
          region.top >= headerBounds.top - 1 &&
          region.bottom <= headerBounds.bottom + 1,
      ),
      compactModelContentContained:
        compactModelTrigger instanceof HTMLElement &&
        compactModelCopy instanceof HTMLElement &&
        getComputedStyle(compactModelTrigger).overflowX !== "visible" &&
        getComputedStyle(compactModelCopy).overflowX !== "visible" &&
        compactModelCopy.getBoundingClientRect().right <=
          compactModelTrigger.getBoundingClientRect().right + 1,
      textareaOutlineAbsent:
        textareaStyle.outlineStyle === "none" ||
        Number.parseFloat(textareaStyle.outlineWidth) === 0,
      textareaBoxShadowAbsent: textareaStyle.boxShadow === "none",
      composerFocusVisible:
        composerStyle.boxShadow !== "none" ||
        composerStyle.borderColor === composerStyle.outlineColor,
    };
    textarea.blur();
    return receipt;
  });
}

function readBrowserRailGeometry() {
  const workspace = document.querySelector(".workspace-primary-surface");
  const conversation = document.querySelector(".conversation-workspace-view");
  const rail = document.querySelector(".workbench-browser-rail");
  if (
    !(workspace instanceof HTMLElement) ||
    !(conversation instanceof HTMLElement) ||
    !(rail instanceof HTMLElement)
  ) {
    throw new Error("Browser right rail is missing");
  }
  const workspaceBounds = workspace.getBoundingClientRect();
  const conversationBounds = conversation.getBoundingClientRect();
  const railBounds = rail.getBoundingClientRect();
  return {
    visible: rail.getClientRects().length > 0,
    rightOfConversation: railBounds.left >= conversationBounds.right - 1,
    alignedToWorkspaceRight:
      Math.abs(railBounds.right - workspaceBounds.right) <= 1,
    withinWorkspaceHeight:
      railBounds.top >= workspaceBounds.top - 1 &&
      railBounds.bottom <= workspaceBounds.bottom + 1,
    horizontalOverflowPx: Math.max(
      0,
      document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  };
}

function readReadingAxis() {
  const required = (selector) => {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLElement)) {
      throw new Error(`Required reading-axis region is missing: ${selector}`);
    }
    return element.getBoundingClientRect();
  };
  const conversation = required(".message-ledger");
  const composer = required(".composer");
  const commandBar = required(".workbench-header");
  const navigation = required(".workspace-view-navigation");
  const status = required(".task-narrative");
  const model = required(".model-chip");
  const centers = [conversation, composer].map(
    (rect) => rect.left + rect.width / 2,
  );
  const message = document.querySelector(".message-text");
  if (!(message instanceof HTMLElement)) {
    throw new Error("Conversation message typography is missing");
  }
  return {
    statusWidth: Math.round(status.width),
    statusHeight: Math.round(status.height),
    statusWithinCommandBar:
      status.top >= commandBar.top &&
      status.bottom <= commandBar.bottom &&
      status.left >= commandBar.left &&
      status.right <= commandBar.right,
    navigationToStatusGapPx: Math.round(status.left - navigation.right),
    statusToModelGapPx: Math.round(model.left - status.right),
    conversationWidth: Math.round(conversation.width),
    composerWidth: Math.round(composer.width),
    maximumCenterDeltaPx: Math.round(
      Math.max(...centers) - Math.min(...centers),
    ),
    messageFontPx: Number.parseFloat(getComputedStyle(message).fontSize),
  };
}

function readPageGeometry() {
  const surface = document.querySelector(".workspace-settings-surface");
  return {
    horizontalOverflowPx: Math.max(
      0,
      document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
    drawerWithinViewport: surface === null,
  };
}

function readLayoutSnapshot() {
  const rect = (selector) => {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLElement)) {
      throw new Error(`Required layout region is missing: ${selector}`);
    }
    const value = element.getBoundingClientRect();
    return {
      x: Math.round(value.x),
      y: Math.round(value.y),
      width: Math.round(value.width),
      height: Math.round(value.height),
    };
  };
  return {
    workbench: rect(".workbench"),
    header: rect(".workbench-header"),
    status: rect(".task-narrative"),
    conversation: rect(".conversation"),
    composer: rect(".composer"),
    views: rect(".workspace-view-navigation"),
    primary: rect(".workspace-primary-surface"),
  };
}

async function screenshotReceipt(page) {
  const bytes = await page.screenshot({
    animations: "disabled",
    type: "png",
  });
  return { sha256: sha256(bytes), bytes: bytes.byteLength };
}

function createScenarioReceipts(current) {
  const evidence = {
    "empty-conversation": current.empty,
    "normal-conversation": current.viewports.map((item) => item.conversation),
    "long-conversation": current.longRun,
    "running-task": current.runtime,
    "waiting-approval": current.viewports.map(
      (item) => item.conversation.waitingApprovalVisible,
    ),
    "completed-task": current.artifactNavigation,
    "failed-recovery": current.recovery,
    "active-runtime": current.runtime,
    "dense-trajectory": current.trajectory,
    "environment-degradation": current.longRun,
    "settings-administration": current.settings,
  };
  return WEB_UI_UX_SCENARIOS.map((id) => ({
    id,
    passed: true,
    evidence: evidence[id],
  }));
}

function threadUrl(origin, threadId) {
  return `${origin}/?thread=${encodeURIComponent(threadId)}`;
}

function browserContext(browser) {
  const context = browser.contexts()[0];
  assert.ok(context, "Web UI E2E Browser context is unavailable");
  return context;
}

async function configureBrowserLocale(browser, locale) {
  const context = browserContext(browser);
  await context.addInitScript((value) => {
    if (window === window.top) {
      window.localStorage.setItem("napier.locale", value);
    }
  }, locale);
}

function createReceipt() {
  return {
    schemaVersion: 2,
    kind: WEB_UI_E2E_KIND,
    status: "pending",
    productionEntry: {},
    server: {},
    browser: {},
    fixture: {},
    viewports: [],
    scenarios: [],
    empty: {},
    recovery: {},
    longRun: {},
    runtime: {},
    trajectory: {},
    settings: {},
    locale: {},
    artifactNavigation: {},
    reconnect: {},
    cleanup: {
      browserClosed: false,
      serverClosed: false,
      temporaryRootRemoved: false,
    },
  };
}

function parseArguments(args) {
  const options = {
    layoutBaselinePath: defaultWebUiLayoutBaselinePath(),
    receiptPath: undefined,
    writeLayoutBaseline: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--write-layout-baseline") {
      options.writeLayoutBaseline = true;
      continue;
    }
    if (argument === "--receipt" || argument === "--layout-baseline") {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a path`);
      if (argument === "--receipt") options.receiptPath = path.resolve(value);
      else options.layoutBaselinePath = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(
      "Usage: node scripts/run-web-ui-e2e.mjs [--receipt <path>] [--layout-baseline <path>] [--write-layout-baseline]",
    );
  }
  return options;
}

async function cleanup(label, action) {
  try {
    await action();
  } catch (error) {
    cleanupErrors.push(
      new Error(`Failed to clean up Web UI E2E ${label}`, { cause: error }),
    );
  }
}

function debug(stage) {
  if (process.env["NAPIER_WEB_E2E_DEBUG"] === "1") {
    process.stderr.write(`[web-ui-e2e] ${stage}\n`);
  }
}
