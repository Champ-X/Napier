import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { seedWebUiNarrativeFixture } from "./web-ui-e2e-fixture.mjs";
import { createWebUiE2eRoot, removeWebUiE2eRoot, startProductionWebServer, startWebUiBrowser } from "./web-ui-e2e-runtime.mjs";

const output = path.resolve(process.argv[2] ?? "/tmp/napier-workspace-overlay-ui.json");
const screenshots = path.resolve("benchmark-results/workspace-overlay", path.basename(output));
await mkdir(screenshots, { recursive: true });
const root = await createWebUiE2eRoot();
const before = await bindings();
const receipt = {
  kind: "napier.workspace-overlay-coordination", schemaVersion: 1,
  sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  externalModelRequests: 0, externalBrowserRequests: [], pageErrors: [],
  scenarios: [], screenshots: [],
};
let server, browser, page, success = false;
try {
  const fixture = await seedWebUiNarrativeFixture(root);
  server = await startProductionWebServer(root);
  receipt.production = server.receipt;
  browser = await startWebUiBrowser(root);
  receipt.browser = browser.receipt;
  const context = browser.browser.contexts()[0];
  await context.addInitScript(() => { if (window === window.top) localStorage.setItem("napier.locale", "en"); });
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== server.origin) {
      receipt.externalBrowserRequests.push(route.request().url()); await route.abort();
    } else await route.continue();
  });
  for (const name of ["Settings", "Developer Workbench"]) {
    page = await context.newPage(); page.setDefaultTimeout(15_000);
    page.on("pageerror", (error) => receipt.pageErrors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${server.origin}/?thread=${fixture.artifactNavigation.threadId}`);
    await page.locator(".composer textarea").fill(`Keep ${name} composer draft`);
    await page.locator("#workspace-evidence-rail").waitFor();
    await openShell(name);
    if (name === "Settings") {
      await page.locator("#settings-section-extensions").click();
      await shell(name).getByPlaceholder("https://example.com/mcp", { exact: true }).fill("https://unsent.invalid/resize-draft");
    }
    await assertShell(name, `${name}-wide-evidence`);
    await page.setViewportSize({ width: 320, height: 900 });
    await assertShell(name, `${name}-narrow-evidence`);
    if (name === "Settings") assert.equal(await shell(name).getByPlaceholder("https://example.com/mcp", { exact: true }).inputValue(), "https://unsent.invalid/resize-draft");
    await verifyTabs(name);
    await page.keyboard.press("Escape");
    await shell(name).waitFor({ state: "hidden" });
    await page.locator("#workspace-evidence-rail").waitFor();
    await assertFocusWithin("#workspace-evidence-rail");
    assert.equal(await page.locator(".composer textarea").inputValue(), `Keep ${name} composer draft`);
    await capture(`${name}-evidence-restored`);
    await page.keyboard.press("Escape");
    await page.locator("#workspace-evidence-rail").waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.id === "workspace-rail-toggle");
    receipt.scenarios.push({ name: `${name}: resize with evidence open`, topOnlyEscape: true, underlyingRailPreserved: true, focusRestoredToRail: true, secondEscapeClosesRail: true, composerPreserved: true, ...(name === "Settings" ? { settingsInputPreservedAcrossResize: true } : {}) });

    // Stateful formal artifact inspection survives suspension and both viewport changes.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator("#workspace-rail-toggle").click();
    await page.locator(".workspace-evidence-output-list button").first().click();
    const inspector = page.locator(".artifact-inspector");
    await inspector.waitFor();
    await inspector.getByRole("button", { name: "Raw source", exact: true }).click();
    await inspector.locator(".artifact-source-preview").waitFor();
    await inspector.evaluate((element) => { element.dataset.overlayStateToken = "retained-artifact"; });
    await openShell(name);
    await assertShell(name, `${name}-artifact-wide`);
    await page.setViewportSize({ width: 320, height: 900 });
    await assertShell(name, `${name}-artifact-narrow`);
    await page.keyboard.press("Escape");
    await shell(name).waitFor({ state: "hidden" });
    await inspector.waitFor();
    await assertFocusWithin(".artifact-inspector");
    assert.equal(await inspector.getAttribute("data-overlay-state-token"), "retained-artifact");
    assert.equal(await inspector.getByRole("button", { name: "Raw source", exact: true }).getAttribute("aria-pressed"), "true");
    await inspector.locator(".artifact-source-preview").waitFor();
    await capture(`${name}-artifact-restored-320`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await inspector.getByRole("button", { name: "Preview", exact: true }).click();
    const frame = page.frameLocator(".artifact-inspector iframe");
    await frame.getByRole("heading", { name: "Interactive output report", exact: true }).waitFor();
    await frame.getByRole("button", { name: "Advance preview", exact: true }).evaluate((button) => button.click());
    assert.equal(await frame.locator("#stage").textContent(), "Step 2");
    await openShell(name);
    await assertShell(name, `${name}-live-preview`);
    await page.keyboard.press("Escape");
    await shell(name).waitFor({ state: "hidden" });
    await inspector.waitFor();
    assert.equal(await frame.locator("#stage").textContent(), "Step 2");
    assert.equal(await inspector.getAttribute("data-overlay-state-token"), "retained-artifact");
    receipt.scenarios.push({ name: `${name}: artifact suspension`, mountedNodePreserved: true, sourceViewPreserved: true, iframeStatePreserved: true, focusRestored: true });
    await page.close(); page = undefined;
  }

  page = await context.newPage(); page.setDefaultTimeout(15_000);
  page.on("pageerror", (error) => receipt.pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${server.origin}/?thread=${fixture.artifactNavigation.threadId}`);
  await page.locator(".composer textarea").fill("Keep keyboard draft");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.locator("#workspace-evidence-rail").waitFor();
  await assertFocusWithin("#workspace-evidence-rail");
  await page.keyboard.press("Meta+,");
  await assertShell("Settings", "keyboard-over-evidence");
  await page.keyboard.press("Escape");
  await shell("Settings").waitFor({ state: "hidden" });
  await page.locator("#workspace-evidence-rail").waitFor();
  await assertFocusWithin("#workspace-evidence-rail");
  await page.keyboard.press("Escape");
  await page.locator("#workspace-evidence-rail").waitFor({ state: "hidden" });
  await page.locator(".ledger-collapse-button").click();
  const search = page.locator('.ledger-search input[type="search"]');
  await search.fill("Preserve search");
  await page.keyboard.press("Meta+,");
  await assertShell("Settings", "keyboard-over-navigation");
  await page.locator("#settings-section-extensions").click();
  const endpoint = shell("Settings").getByPlaceholder("https://example.com/mcp", { exact: true });
  await endpoint.fill("https://unsent.invalid/review-draft");
  assert.equal(await endpoint.inputValue(), "https://unsent.invalid/review-draft");
  await page.keyboard.press("Escape");
  await shell("Settings").waitFor({ state: "hidden" });
  await search.waitFor();
  await page.waitForFunction(() => document.activeElement?.matches('.ledger-search input[type="search"]'));
  assert.equal(await search.inputValue(), "Preserve search");
  assert.equal(await page.locator(".composer textarea").inputValue(), "Keep keyboard draft");
  await capture("navigation-restored");
  await page.keyboard.press("Escape");
  await page.locator(".ledger-nav.is-mobile-open").waitFor({ state: "hidden" });
  receipt.scenarios.push({ name: "Keyboard settings above rail and navigation", underlyingRailPreserved: true, navigationPreservedUntilSecondEscape: true, searchAndComposerDraftsPreserved: true });

  const resources = await fetch(`${server.origin}/api/workspace/resources`).then((response) => response.json());
  assert.equal(resources.budgetInvocations, 0); assert.equal(resources.activeInvocations, 0);
  receipt.modelResources = resources;
  assert.deepEqual(receipt.pageErrors, []); assert.deepEqual(receipt.externalBrowserRequests, []);
  assert.deepEqual(await bindings(), before, "Source or consumed build changed during verification");
  receipt.bindings = before;
  receipt.limitations = [
    "Production browser/HTTP with deterministic existing artifact fixtures and zero new model dispatches; retained historical fixture events are not live model runs.",
    "Actual Settings/Developer and formal artifact/rail/navigation flows; browser takeover and skill-resource state also require their component-level tests, not claimed as live-backend browser acceptance here.",
    "Interactive artifact content uses the existing fixture's DOM button click; no physical iframe-pointer claim.",
    "Preserved user frontend changes are included in the bound worktree build; this is not a clean release receipt or complete G06-B acceptance.",
  ];
  await writeFile(output, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  success = true;
  console.log(JSON.stringify({ output, scenarios: receipt.scenarios.length, screenshots: receipt.screenshots.length, modelInvocations: 0 }));
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(screenshots, "failure.png"), fullPage: true }).catch(() => undefined);
  await writeFile(path.join(screenshots, "failure.json"), JSON.stringify({ receipt, error: String(error), stack: error.stack, fixture: root, bindingsBefore: before }, null, 2));
  console.error(`Failed overlay fixture retained: ${root}`); throw error;
} finally {
  await browser?.close(); await server?.close();
  if (success) await removeWebUiE2eRoot(root);
}

function shell(name) { return page.getByRole("dialog", { name, exact: true }); }
async function openShell(name) { await page.getByRole("button", { name, exact: true }).click(); await shell(name).waitFor(); }
async function assertFocusWithin(selector) {
  await page.waitForFunction((target) => {
    const element = document.querySelector(target); return element && element.contains(document.activeElement) && !element.closest("[inert]");
  }, selector);
}
async function assertShell(name, label) {
  await shell(name).waitFor();
  await shell(name).evaluate(async (element) => {
    const finite = element.getAnimations({ subtree: true }).filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime));
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
  });
  await page.waitForFunction(() => !document.querySelector("#workspace-evidence-rail")?.getClientRects().length);
  const visibleInspectors = await page.locator(".artifact-inspector:visible, .workbench-browser-rail:visible, .workspace-evidence-backdrop:visible").count();
  assert.equal(visibleInspectors, 0, "Background evidence must be suspended");
  const dialogs = await page.getByRole("dialog").all();
  assert.equal(dialogs.length, 1, "Only the foreground dialog is accessible");
  await shell(name).getByRole("button", { name: new RegExp("^Close ", "u") }).first().click({ trial: true });
  await capture(label);
}
async function verifyTabs(name) {
  const close = shell(name).getByRole("button", { name: new RegExp("^Close ", "u") }).first();
  await close.focus(); await page.keyboard.press("Shift+Tab");
  assert.equal(await shell(name).evaluate((element) => element.contains(document.activeElement)), true);
  await page.keyboard.press("Tab");
  assert.equal(await close.evaluate((element) => element === document.activeElement), true);
}
async function capture(label) {
  const width = page.viewportSize().width;
  const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth));
  assert.equal(overflow, 0);
  const file = path.join(screenshots, `${label.replaceAll(" ", "-")}-${width}.png`);
  await page.screenshot({ path: file, fullPage: true });
  receipt.screenshots.push({ path: file, width, overflowPx: overflow, sha256: digest(await readFile(file)) });
}
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
async function bindings() {
  const roots = ["apps/server/src", "packages/contracts/src", "packages/runtime/src", "apps/web/src", "apps/server/dist", "packages/contracts/dist", "packages/runtime/dist", "apps/web/dist", "scripts"];
  const trees = [];
  for (const root of roots) {
    const records = [];
    for (const file of await walk(root)) records.push({ path: file, sha256: digest(await readFile(file)) });
    trees.push({ root, fileCount: records.length, sha256: digest(JSON.stringify(records)) });
  }
  return { trees, packageLock: digest(await readFile("package-lock.json")) };
}
async function walk(root) {
  const result = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await walk(file)); else if (entry.isFile()) result.push(file);
    else throw new Error(`Unsupported source/build entry: ${file}`);
  }
  return result;
}
