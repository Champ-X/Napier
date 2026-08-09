import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  assertViewportReceipt,
  assertWebUiE2eReceipt,
  WEB_UI_E2E_KIND,
  WEB_UI_E2E_VIEWPORTS,
} from "./web-ui-e2e-contract.mjs";
import {
  createWebUiE2eRoot,
  productionEntryReceipt,
  removeWebUiE2eRoot,
  sha256,
  startProductionWebServer,
  startWebUiCdpBrowser,
  WEB_UI_START_TIMEOUT_MS,
} from "./web-ui-e2e-runtime.mjs";

const receiptPath = parseArguments(process.argv.slice(2));
const temporaryRoot = await createWebUiE2eRoot();
const receipt = createReceipt();
let browserRuntime;
let serverRuntime;
let operationError;
const cleanupErrors = [];

try {
  receipt.productionEntry = await productionEntryReceipt();
  serverRuntime = await startProductionWebServer(temporaryRoot);
  receipt.server = serverRuntime.receipt;
  browserRuntime = await startWebUiCdpBrowser(temporaryRoot);
  receipt.browser = browserRuntime.receipt;
  receipt.viewports = [];
  for (const viewport of WEB_UI_E2E_VIEWPORTS) {
    const viewportReceipt = await inspectViewport(
      browserRuntime.browser,
      serverRuntime.origin,
      viewport,
    );
    assertViewportReceipt(viewportReceipt);
    receipt.viewports.push(viewportReceipt);
  }
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
const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
if (receiptPath) {
  await writeFile(receiptPath, serialized, { encoding: "utf8", mode: 0o600 });
}
process.stdout.write(serialized);

async function inspectViewport(browser, origin, viewport) {
  const context = browser.contexts()[0];
  assert.ok(context, "Web UI E2E Browser context is unavailable");
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  try {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto(origin, {
      waitUntil: "domcontentloaded",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    await page.locator("#inspector-group-activity").waitFor({
      state: "attached",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    const initial = await page.evaluate(readInitialLayout);
    const openFocusTarget =
      viewport.layout === "drawer" ? await openDrawer(page) : "";
    const geometry = await page.evaluate(readGeometry);
    const opened = viewport.layout === "drawer";
    const keyboard = await verifyKeyboardNavigation(page);
    const screenshot = await screenshotReceipt(page);
    const closed =
      viewport.layout === "drawer"
        ? await closeDrawerWithEscape(page)
        : {
            escapeRestoredTriggerFocus: false,
            closedAfterEscape: false,
          };
    const inspector = await page.evaluate(readInspectorContract);
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
      keyboard,
      console: { errorCount: consoleErrors.length },
      screenshot,
    };
  } finally {
    await page.close();
  }
}

async function openDrawer(page) {
  await page.locator(".inspector-drawer-trigger").click();
  await page.locator(".inspector.is-drawer-open").waitFor({ state: "visible" });
  await page.waitForTimeout(240);
  return page.evaluate(() => document.activeElement?.id ?? "");
}

async function closeDrawerWithEscape(page) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(240);
  return page.evaluate(() => {
    const inspector = document.querySelector(".inspector");
    const trigger = document.querySelector(".inspector-drawer-trigger");
    if (
      !(inspector instanceof HTMLElement) ||
      !(trigger instanceof HTMLElement)
    ) {
      throw new Error("Responsive Inspector elements are missing");
    }
    const style = getComputedStyle(inspector);
    return {
      escapeRestoredTriggerFocus: document.activeElement === trigger,
      closedAfterEscape:
        style.visibility === "hidden" && style.pointerEvents === "none",
    };
  });
}

async function verifyKeyboardNavigation(page) {
  await page.locator("#inspector-group-activity").click();
  await page.locator("#inspector-group-activity").focus();
  await page.keyboard.press("ArrowRight");
  await waitForFocus(page, "inspector-group-files");
  const groupSelectionPreserved = await selected(
    page,
    "inspector-group-activity",
  );
  await page.keyboard.press("Enter");
  await waitForSelection(page, "inspector-group-files");
  await page.locator("#inspector-group-activity").click();
  await page.locator("#inspector-tab-plan").focus();
  await page.keyboard.press("End");
  await waitForFocus(page, "inspector-tab-goal");
  const toolSelectionPreserved = await selected(page, "inspector-tab-plan");
  await page.keyboard.press("Enter");
  await waitForSelection(page, "inspector-tab-goal");
  await page.locator("#inspector-tab-plan").click();
  return {
    manualActivationPreserved:
      groupSelectionPreserved && toolSelectionPreserved,
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
  const inspector = document.querySelector(".inspector");
  const trigger = document.querySelector(".inspector-drawer-trigger");
  if (
    !(inspector instanceof HTMLElement) ||
    !(trigger instanceof HTMLElement)
  ) {
    throw new Error("Responsive Inspector elements are missing");
  }
  const inspectorStyle = getComputedStyle(inspector);
  const triggerStyle = getComputedStyle(trigger);
  return {
    horizontalOverflowPx: Math.max(
      0,
      document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
    inspector: {
      desktopVisible:
        inspectorStyle.visibility === "visible" &&
        inspectorStyle.pointerEvents !== "none",
      drawerTriggerHidden: triggerStyle.display === "none",
      initiallyHidden:
        inspectorStyle.visibility === "hidden" &&
        inspectorStyle.pointerEvents === "none",
      drawerTriggerVisible:
        triggerStyle.display !== "none" &&
        trigger.getBoundingClientRect().width > 0,
      drawerOpened: false,
    },
  };
}

function readInspectorContract() {
  const groups = [...document.querySelectorAll(".inspector-groups button")];
  const tools = [...document.querySelectorAll(".inspector-tabs button")];
  const activeGroup = document.querySelector(
    '.inspector-groups [aria-selected="true"]',
  );
  const activeTool = document.querySelector(
    '.inspector-tabs [aria-selected="true"]',
  );
  const panel = document.querySelector("#inspector-active-panel");
  const inspector = document.querySelector(".inspector");
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
    defaultGroup: activeGroup.id.replace("inspector-group-", ""),
    defaultTool: activeTool.id.replace("inspector-tab-", ""),
    panelLabelledBy: panel.getAttribute("aria-labelledby") ?? "",
    minimumGroupHeight: Math.min(
      ...groups.map((group) => group.getBoundingClientRect().height),
    ),
    minimumToolHeight: Math.min(
      ...tools.map((tool) => tool.getBoundingClientRect().height),
    ),
    drawerOpened: inspector.classList.contains("is-drawer-open"),
  };
}

function readGeometry() {
  const inspector = document.querySelector(".inspector");
  if (!(inspector instanceof HTMLElement)) {
    throw new Error("Responsive Inspector is missing");
  }
  const rect = inspector.getBoundingClientRect();
  const labelOverflow = [
    ...document.querySelectorAll(".inspector-groups button"),
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

function createReceipt() {
  return {
    schemaVersion: 1,
    kind: WEB_UI_E2E_KIND,
    status: "pending",
    productionEntry: {},
    server: {},
    browser: {},
    viewports: [],
    cleanup: {
      browserClosed: false,
      serverClosed: false,
      temporaryRootRemoved: false,
    },
  };
}

function parseArguments(args) {
  if (args.length === 0) return undefined;
  if (args.length === 2 && args[0] === "--receipt") {
    return path.resolve(args[1]);
  }
  throw new Error("Usage: node scripts/run-web-ui-e2e.mjs [--receipt <path>]");
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
