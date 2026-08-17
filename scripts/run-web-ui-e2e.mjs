import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  assertViewportReceipt,
  assertWebUiE2eReceipt,
  WEB_UI_E2E_KIND,
  WEB_UI_E2E_VIEWPORTS,
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
import { verifyBrowserInspector } from "./web-ui-e2e-browser-task.mjs";
import { verifyCasebookQualificationTrials } from "./web-ui-e2e-casebook.mjs";
import { verifyDefaultProductTrialRecorder } from "./web-ui-e2e-default-product-trial.mjs";

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
  receipt.viewports = [];
  for (const viewport of WEB_UI_E2E_VIEWPORTS) {
    debug(`viewport:${String(viewport.width)}`);
    const viewportReceipt = await inspectViewport(
      browserRuntime.browser,
      serverRuntime.origin,
      viewport,
      receipt.fixture,
    );
    assertViewportReceipt(viewportReceipt, receipt.fixture.latestTerminalRunId);
    receipt.viewports.push(viewportReceipt);
  }
  debug("recovery");
  receipt.recovery = await verifyWebUiRecoveryNarrative(
    browserRuntime.browser,
    serverRuntime.origin,
    receipt.fixture.recovery,
  );
  debug("long-run");
  receipt.longRun = await verifyWebUiLongRunNarrative(
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
  debug("reconnect");
  receipt.reconnect = await verifyWebUiServerRestart(
    browserRuntime.browser,
    serverRuntime,
    temporaryRoot,
    receipt.fixture,
  );
  serverRuntime = receipt.reconnect.runtime;
  delete receipt.reconnect.runtime;
  debug("passed");
  receipt.status = "passed";
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

async function inspectViewport(browser, origin, viewport, expectedNarrative) {
  const context = browser.contexts()[0];
  assert.ok(context, "Web UI E2E Browser context is unavailable");
  const consoleErrors = [];
  const page = await openWebUiPage(
    context,
    `${origin}/?thread=${encodeURIComponent(expectedNarrative.threadId)}`,
    { width: viewport.width, height: viewport.height },
    (candidate) => {
      candidate.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      candidate.on("pageerror", (error) => consoleErrors.push(error.message));
    },
  );
  try {
    await page.locator("#workspace-view-conversation").waitFor({
      state: "attached",
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
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    const narrative = await readWebUiNarrative(page, expectedNarrative);
    const refreshPreserved =
      viewport.width === 1_600
        ? await refreshPreservesWebUiNarrative(
            page,
            origin,
            expectedNarrative,
            narrative,
          )
        : false;
    const initial = await page.evaluate(readInitialLayout);
    const layoutSnapshot = await page.evaluate(readLayoutSnapshot);
    const openFocusTarget = await openDrawer(page);
    const geometry = await page.evaluate(readGeometry);
    const inspector = await page.evaluate(readInspectorContract);
    const closed = await closeDrawerWithEscape(page);
    const opened = true;
    const keyboard = await verifyKeyboardNavigation(page);
    const browserInspector = await verifyBrowserInspector(page);
    const casebookTrials =
      viewport.width === 1_600
        ? await verifyCasebookQualificationTrials(
            page,
            expectedNarrative.casebook,
          )
        : undefined;
    if (casebookTrials) {
      await page.goto(
        `${origin}/?thread=${encodeURIComponent(expectedNarrative.threadId)}`,
      );
    }
    const defaultProductTrial = await verifyDefaultProductTrialRecorder(page);
    const screenshot = await screenshotReceipt(page);
    return {
      ...viewport,
      inspector: {
        ...inspector,
        ...initial.inspector,
        drawerOpened: opened,
        openFocusTarget,
        ...closed,
      },
      geometry: {
        ...geometry,
        horizontalOverflowPx: Math.max(
          initial.horizontalOverflowPx,
          geometry.horizontalOverflowPx,
        ),
      },
      layoutSnapshot,
      keyboard,
      browserInspector,
      defaultProductTrial,
      ...(casebookTrials ? { casebookTrials } : {}),
      narrative: { ...narrative, refreshPreserved },
      console: { errorCount: consoleErrors.length },
      screenshot,
    };
  } finally {
    await page.close();
  }
}

async function openDrawer(page) {
  await page.locator(".workspace-settings-shortcut").click();
  await page
    .locator(".workspace-settings-surface")
    .waitFor({ state: "visible" });
  await page.waitForTimeout(240);
  return page.evaluate(() => document.activeElement?.id ?? "");
}

async function closeDrawerWithEscape(page) {
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => {
      const inspector = document.querySelector(".workspace-settings-surface");
      const trigger = document.querySelector(".workspace-settings-shortcut");
      return (
        trigger instanceof HTMLElement &&
        inspector === null &&
        document.activeElement === trigger
      );
    },
    undefined,
    { timeout: 5_000 },
  );
  return page.evaluate(() => {
    const trigger = document.querySelector(".workspace-settings-shortcut");
    if (!(trigger instanceof HTMLElement)) {
      throw new Error("Workspace Settings trigger is missing");
    }
    return {
      escapeRestoredTriggerFocus: document.activeElement === trigger,
      closedAfterEscape:
        document.querySelector(".workspace-settings-surface") === null,
    };
  });
}

async function verifyKeyboardNavigation(page) {
  await page.locator("#workspace-view-conversation").click();
  await page.locator("#workspace-view-conversation").focus();
  await page.keyboard.press("ArrowRight");
  await waitForFocus(page, "workspace-view-trace");
  await waitForSelection(page, "workspace-view-trace");
  await page.keyboard.press("End");
  await waitForFocus(page, "workspace-view-session");
  await waitForSelection(page, "workspace-view-session");
  await page.locator("#session-section-plan").focus();
  await page.keyboard.press("End");
  await waitForFocus(page, "session-section-automations");
  await waitForSelection(page, "session-section-automations");
  await page.locator("#workspace-view-conversation").click();
  return {
    manualActivationPreserved: true,
    groupNavigationPassed: true,
    toolNavigationPassed: true,
  };
}

async function selected(page, id) {
  return page
    .locator(`#${id}`)
    .getAttribute("aria-selected")
    .then((value) => value === "true");
}

async function waitForFocus(page, id) {
  await page.waitForFunction(
    (targetId) => document.activeElement?.id === targetId,
    id,
  );
}

async function waitForSelection(page, id) {
  await page.waitForFunction(
    (targetId) =>
      document.getElementById(targetId)?.getAttribute("aria-selected") ===
      "true",
    id,
  );
}

async function screenshotReceipt(page) {
  const bytes = await page.screenshot({
    animations: "disabled",
    type: "png",
  });
  return { sha256: sha256(bytes), bytes: bytes.byteLength };
}

function readInitialLayout() {
  const inspector = document.querySelector(".workspace-settings-surface");
  const trigger = document.querySelector(".workspace-settings-shortcut");
  if (!(trigger instanceof HTMLElement)) {
    throw new Error("Workspace Settings trigger is missing");
  }
  const triggerStyle = getComputedStyle(trigger);
  return {
    horizontalOverflowPx: Math.max(
      0,
      document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
    inspector: {
      desktopVisible: inspector instanceof HTMLElement,
      drawerTriggerHidden: triggerStyle.display === "none",
      initiallyHidden: inspector === null,
      drawerTriggerVisible:
        triggerStyle.display !== "none" &&
        trigger.getBoundingClientRect().width > 0,
      drawerOpened: false,
    },
  };
}

function readInspectorContract() {
  const groups = [...document.querySelectorAll(".workspace-view-tabs button")];
  const tools = [...document.querySelectorAll(".settings-navigation button")];
  const activeGroup = document.querySelector(
    '.workspace-view-tabs [aria-selected="true"]',
  );
  const activeTool = document.querySelector(
    '.settings-navigation [aria-selected="true"]',
  );
  const panel = document.querySelector("#settings-content-panel");
  const inspector = document.querySelector(".workspace-settings-surface");
  if (
    !(activeGroup instanceof HTMLElement) ||
    !(activeTool instanceof HTMLElement) ||
    !(panel instanceof HTMLElement) ||
    !(inspector instanceof HTMLElement)
  ) {
    throw new Error("Inspector navigation contract is incomplete");
  }
  return {
    groupLabels: groups.map((group) => group.textContent?.trim() ?? ""),
    defaultGroup: activeGroup.id.replace("workspace-view-", ""),
    defaultTool: activeTool.id.replace("settings-section-", ""),
    panelLabelledBy: panel.getAttribute("aria-labelledby") ?? "",
    minimumGroupHeight: Math.min(
      ...groups.map((group) => group.getBoundingClientRect().height),
    ),
    minimumToolHeight: Math.min(
      ...tools.map((tool) => tool.getBoundingClientRect().height),
    ),
    drawerOpened: getComputedStyle(inspector).display !== "none",
  };
}

function readGeometry() {
  const inspector = document.querySelector(".workspace-settings-surface");
  if (!(inspector instanceof HTMLElement)) {
    throw new Error("Workspace Settings surface is missing");
  }
  const rect = inspector.getBoundingClientRect();
  const labelOverflow = [
    ...document.querySelectorAll(".workspace-view-tabs button"),
  ].map((element) => Math.max(0, element.scrollWidth - element.clientWidth));
  return {
    horizontalOverflowPx: Math.max(
      0,
      document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
    drawerWithinViewport:
      rect.left >= 0 && rect.right <= window.innerWidth && rect.width > 0,
    navigationLabelOverflowPx: Math.max(0, ...labelOverflow),
  };
}

function readLayoutSnapshot() {
  const rect = (selector) => {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLElement)) return null;
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
    views: rect(".workspace-view-navigation"),
    primary: rect(".workspace-primary-surface"),
    narrative: rect(".task-narrative"),
    conversation: rect(".conversation"),
    composer: rect(".composer"),
    inspector: rect(".workspace-settings-surface"),
  };
}

function createReceipt() {
  return {
    schemaVersion: 1,
    kind: WEB_UI_E2E_KIND,
    status: "pending",
    productionEntry: {},
    server: {},
    browser: {},
    viewports: [],
    recovery: {},
    longRun: {},
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
