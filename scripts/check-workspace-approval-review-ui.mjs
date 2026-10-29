import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createWebUiE2eRoot, removeWebUiE2eRoot, startProductionWebServer, startWebUiBrowser,
} from "./web-ui-e2e-runtime.mjs";
import {
  assertCompletedOnce, assertWaiting, observeWorkspace,
  recoveryResource, rejectAbsentIds, scopedJson,
} from "./workspace-approval-review-checks.mjs";

const output = path.resolve(process.argv[2] ?? "/tmp/napier-workspace-approval-review-ui.json");
const screenshotRoot = path.resolve("benchmark-results/workspace-approval-review", path.basename(output));
await mkdir(screenshotRoot, { recursive: true });
const root = await createWebUiE2eRoot();
const before = await bindings();
let production, browser, page, success = false;
const allowedOrigins = new Set();
const receipt = {
  kind: "workspace-approval-extension-trust-review-isolation", schemaVersion: 1,
  sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  externalModelRequests: 0, externalBrowserRequests: [], pageErrors: [], workspaceResponseMismatches: [],
  uiMutations: [], layouts: [], screenshots: [], productionStarts: [],
};
try {
  execFileSync(process.execPath, ["--import", "tsx", "apps/server/test/workspace-approval-review-fixture.ts", root], {
    encoding: "utf8", stdio: "pipe", timeout: 30_000,
  });
  const fixture = JSON.parse(await readFile(path.join(root, "approval-review-fixture.json"), "utf8"));
  receipt.copiedIds = { ...fixture.request, answer: undefined, extensionId: fixture.extension.id };
  receipt.absentIds = fixture.absent;
  const launch = async () => {
    production = await startProductionWebServer(root);
    allowedOrigins.add(production.origin);
    receipt.productionStarts.push(production.receipt);
    return production.origin;
  };
  let origin = await launch();
  console.log("Production host ready; checking absent and copied IDs.");
  await assertWaiting(origin, fixture.a, fixture);
  await assertWaiting(origin, fixture.b, fixture);
  receipt.wrongWorkspaceNegatives = await rejectAbsentIds(origin, fixture);
  browser = await startWebUiBrowser(root);
  receipt.browser = browser.receipt;
  const context = browser.browser.contexts()[0];
  await context.addInitScript(() => localStorage.setItem("napier.locale", "en"));
  await context.route("**/*", async (route) => {
    if (!allowedOrigins.has(new URL(route.request().url()).origin)) {
      receipt.externalBrowserRequests.push(route.request().url());
      await route.abort();
    } else await route.continue();
  });
  const newPage = async () => {
    page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    page.on("pageerror", (error) => receipt.pageErrors.push(error.message));
    page.on("request", (request) => {
      if (request.method() === "POST") receipt.uiMutations.push({ url: request.url(), body: request.postDataJSON() });
    });
    page.on("response", async (response) => {
      const match = new URL(response.url()).pathname.match(/^\/api\/workspaces\/(workspace_[a-f0-9]{64})\//u);
      if (match && response.ok() && (await response.headerValue("x-napier-workspace-id")) !== match[1]) {
        receipt.workspaceResponseMismatches.push(response.url());
      }
    });
  };
  await newPage();
  await page.goto(`${origin}/?workspace=${fixture.a.workspaceId}&thread=${fixture.request.threadId}`);
  await openWorkflow();
  await workflow().getByRole("button", { name: "Review decision", exact: true }).waitFor();
  await reviewCard(fixture.extension.name);
  await checkLayouts("a-pending-trust", card(fixture.extension.name).getByRole("button", { name: "Approve source", exact: true }));
  await closeSettings();
  await openWorkflow();
  await checkLayouts("a-pending-approval", workflow().getByRole("button", { name: "Review decision", exact: true }));
  await page.setViewportSize({ width: 1440, height: 900 });
  // Actual sidebar selection changes the workspace binding while IDs stay equal.
  const project = page.locator(`.workspace-tree-project[title="${fixture.b.root}"]`);
  if (!(await project.isVisible())) await page.locator(".ledger-collapse-button").click();
  await project.click();
  await page.waitForURL((url) => url.searchParams.get("workspace") === fixture.b.workspaceId);
  const bCheckpoint = await completeThroughUi(origin, fixture.b, fixture, 1440);
  receipt.bBeforeRestart = await assertCompletedOnce(origin, fixture.b, fixture, bCheckpoint);
  await assertWaiting(origin, fixture.a, fixture);
  receipt.aStayedWaitingAfterB = true;
  await page.close(); page = undefined;
  await production.close(); production = undefined;
  console.log("B completed alone; restarting production index with persisted custom roots.");
  origin = await launch();
  await assertWaiting(origin, fixture.a, fixture);
  assert.deepEqual(await assertCompletedOnce(origin, fixture.b, fixture, bCheckpoint), receipt.bBeforeRestart);
  receipt.aWaitingAndBCompletedAfterRestart = true;
  await newPage();
  await page.goto(`${origin}/?workspace=${fixture.a.workspaceId}&thread=${fixture.request.threadId}`);
  await openWorkflow();
  await workflow().getByRole("button", { name: "Review decision", exact: true }).waitFor();
  const aCheckpoint = await completeThroughUi(origin, fixture.a, fixture, 320);
  receipt.aAfterRestart = await assertCompletedOnce(origin, fixture.a, fixture, aCheckpoint);
  assert.deepEqual(await assertCompletedOnce(origin, fixture.b, fixture, bCheckpoint), receipt.bBeforeRestart);
  await page.close(); page = undefined;
  await production.close(); production = undefined;
  origin = await launch();
  receipt.aFinal = await assertCompletedOnce(origin, fixture.a, fixture, aCheckpoint);
  receipt.bFinal = await assertCompletedOnce(origin, fixture.b, fixture, bCheckpoint);
  assert.deepEqual(receipt.aFinal, receipt.aAfterRestart);
  assert.deepEqual(receipt.bFinal, receipt.bBeforeRestart);
  const aOnlyCheckpoint = await scopedJson(origin, fixture.a, recoveryResource(fixture.absent));
  assert.equal(aOnlyCheckpoint.status, "waiting_answer");
  const aExtensions = await scopedJson(origin, fixture.a, "extensions");
  assert.equal(aExtensions.find((item) => item.id === fixture.absent.extensionId).trustStatus, "pending");
  receipt.aOnlyRecordsRemainPending = true;
  receipt.modelResources = [];
  for (const workspace of [fixture.a, fixture.b]) {
    const resources = await scopedJson(origin, workspace, "workspace/resources");
    assert.equal(resources.budgetInvocations, 0);
    assert.equal(resources.activeInvocations, 0);
    assert.equal(resources.chargedTokens, 0);
    receipt.modelResources.push({ workspaceId: workspace.workspaceId, resources });
  }
  assert.deepEqual(receipt.externalBrowserRequests, []);
  assert.deepEqual(receipt.pageErrors, []);
  assert.deepEqual(receipt.workspaceResponseMismatches, []);
  for (const workspace of [fixture.a, fixture.b]) {
    for (const suffix of [
      `extensions/${fixture.extension.id}/review`,
      `threads/${fixture.request.threadId}/operator-decisions/${fixture.request.decisionId}/answer`,
      recoveryResource(fixture.request),
    ]) {
      assert.equal(receipt.uiMutations.filter((request) => request.url.includes(`/api/workspaces/${workspace.workspaceId}/${suffix}`)).length, 1);
    }
  }
  assert.equal(receipt.uiMutations.some((request) => /\/(connect|enabled|messages)$/u.test(request.url)), false);
  receipt.boundaries = [
    "Three actual production index process launches; clean shutdown and restart, not process-crash recovery.",
    "Waiting Workflow approval followed by deterministic apply_patch; no model invocation, paid provider call, or extension connection.",
    "Extension trust review isolation only; approving the same source repeatedly is not claimed idempotent.",
    "Exactly-once evidence is one durable answer, one decision continuation, one tool completion, one workflow completion, and an unchanged file after stale replay.",
    "Fresh browser context with external browser requests blocked; host-direct test configuration does not establish OS sandbox isolation.",
    "Fixture seeds use source workflow helpers; actual UI/HTTP actions and all restarts use the recorded production builds.",
  ];
  receipt.bindings = before;
  assert.deepEqual(await bindings(), before, "Source or build changed during acceptance");
  await writeFile(output, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  success = true;
  console.log(JSON.stringify({ output, productionStarts: 3, layouts: receipt.layouts.length, uiMutations: receipt.uiMutations.length, externalModelRequests: 0 }));

  async function completeThroughUi(currentOrigin, workspace, item, actionWidth) {
    await reviewCard(item.extension.name);
    await checkLayouts(`${workspace.workspaceId === item.a.workspaceId ? "a" : "b"}-trust`, card(item.extension.name).getByRole("button", { name: "Approve source", exact: true }));
    await page.setViewportSize({ width: actionWidth, height: 900 });
    await card(item.extension.name).getByRole("button", { name: "Approve source", exact: true }).click();
    await card(item.extension.name).getByRole("button", { name: "Connect & discover", exact: true }).waitFor();
    await closeSettings();
    await openWorkflow();
    await workflow().getByRole("button", { name: "Review decision", exact: true }).click();
    await closeEvidenceOverlay();
    const panel = page.locator(".operator-decision");
    await panel.locator('input[value="option_1"]').check();
    await panel.locator(".operator-decision-custom summary").click();
    await panel.getByRole("textbox", { name: "Other direction", exact: true }).fill(item.request.answer.customText);
    await panel.getByRole("button", { name: "Save answer only", exact: true }).click();
    await panel.getByText("Answer saved. Resume this workflow from its controls.", { exact: true }).waitFor();
    await openWorkflow();
    const checkpoint = await scopedJson(currentOrigin, workspace, recoveryResource(item.request));
    assert.equal(checkpoint.status, "ready");
    await checkLayouts(`${workspace.workspaceId === item.a.workspaceId ? "a" : "b"}-continue`, workflow().getByRole("button", { name: "Continue Workflow", exact: true }));
    await page.setViewportSize({ width: actionWidth, height: 900 });
    await workflow().getByRole("button", { name: "Continue Workflow", exact: true }).click();
    await workflow().getByRole("button", { name: "Workflow steps finished", exact: true }).waitFor();
    assert.equal((await observeWorkspace(currentOrigin, workspace, item)).checkpoint.status, "completed");
    return checkpoint;
  }
} catch (error) {
  const failureBase = path.join(screenshotRoot, `failure-${Date.now()}`);
  if (page && !page.isClosed()) await page.screenshot({ path: `${failureBase}.png`, fullPage: true }).catch(() => undefined);
  await writeFile(`${failureBase}.json`, JSON.stringify({ error: String(error), root, receipt, bindings: before }, null, 2) + "\n").catch(() => undefined);
  console.error(`Failed fixture retained at ${root}`);
  throw error;
} finally {
  await browser?.close();
  await production?.close();
  if (success) await removeWebUiE2eRoot(root);
}

function workflow() { return page.getByRole("region", { name: "Continue Workflow", exact: true }); }
function card(name) { return page.locator(".extension-card").filter({ has: page.getByText(name, { exact: true }) }); }
async function openWorkflow() {
  await page.locator("#workspace-view-task").click();
  await workflow().waitFor();
}
async function reviewCard(name) {
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  if (!(await settings.isVisible())) await page.locator(".ledger-collapse-button").click();
  await settings.click();
  await page.locator("#settings-section-extensions").click();
  await card(name).waitFor();
}
async function closeSettings() {
  await page.getByRole("dialog").filter({ has: page.locator("#settings-section-extensions") }).getByRole("button", { name: "Close settings", exact: true }).click();
}
async function checkLayouts(label, action) {
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (!(await page.locator(".workspace-settings-surface").isVisible())) await closeEvidenceOverlay();
    await action.scrollIntoViewIfNeeded();
    await action.click({ trial: true });
    const box = await action.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= 901);
    const overflowPx = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth));
    assert.equal(overflowPx, 0);
    receipt.layouts.push({ label, width, height: 900, actionReachable: true, overflowPx });
    const file = path.join(screenshotRoot, `${label}-${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    receipt.screenshots.push({ path: file, sha256: digest(await readFile(file)) });
  }
}
async function closeEvidenceOverlay() {
  const hide = page.getByRole("dialog", { name: "Workspace evidence", exact: true }).getByRole("button", { name: "Hide workspace", exact: true });
  if (await hide.isVisible()) await hide.click();
}
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
async function bindings() {
  const roots = ["apps/server/src", "packages/contracts/src", "packages/runtime/src", "apps/web/src", "apps/server/dist", "packages/contracts/dist", "packages/runtime/dist", "apps/web/dist"];
  const files = [
    "scripts/check-workspace-approval-review-ui.mjs", "scripts/workspace-approval-review-checks.mjs",
    "scripts/web-ui-e2e-runtime.mjs", "scripts/production-server-test-environment.mjs",
    "apps/server/test/workspace-approval-review-fixture.ts", "apps/server/test/workspace-approval-review-isolation.test.mjs",
    "packages/runtime/test/fixtures/workflow-approval-recovery-setup.ts", "package-lock.json",
  ];
  const trees = [];
  for (const root of roots) {
    const records = [];
    for (const file of await walk(root)) records.push({ path: file, sha256: digest(await readFile(file)) });
    trees.push({ root, fileCount: records.length, sha256: digest(JSON.stringify(records)) });
  }
  return { trees, files: await Promise.all(files.map(async (file) => ({ path: file, sha256: digest(await readFile(file)) }))) };
}
async function walk(root) {
  const result = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await walk(file));
    else if (entry.isFile()) result.push(file);
    else throw new Error(`Unsupported source/build entry: ${file}`);
  }
  return result;
}
