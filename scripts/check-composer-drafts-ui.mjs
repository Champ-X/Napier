import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { startDecisionUiFixture } from "./operator-decision-ui-fixture.mjs";
import {
  createWebUiE2eRoot,
  removeWebUiE2eRoot,
  startWebUiBrowser,
} from "./web-ui-e2e-runtime.mjs";

const output = path.resolve(
  process.argv[2] ?? "/tmp/napier-composer-drafts-ui.json",
);
const files = [
  "apps/web/src/thread-composer-drafts.ts",
  "apps/web/src/use-thread-composer.ts",
  "apps/web/src/use-next-run-options.ts",
  "apps/web/src/use-workspace-view-model.ts",
  "apps/web/src/ComposerDraftNotices.tsx",
  "apps/web/src/composer-draft-copy.ts",
  "apps/web/src/composer-draft-notices.css",
  "apps/web/src/AppWorkspaceViews.tsx",
  "apps/web/src/thread-detail-view-state.ts",
  "apps/web/src/workspace-shell.css",
  "scripts/check-composer-drafts-ui.mjs",
  "apps/web/dist/index.html",
];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sources = () =>
  Promise.all(
    files.map(async (file) => ({
      path: file,
      sha256: hash(await readFile(file)),
    })),
  );
const before = await sources();
const root = await createWebUiE2eRoot();
let fixture, browser;
try {
  fixture = await startDecisionUiFixture(root);
  const store = fixture.store,
    agent = store.listAgents()[0];
  const a = await store.createThread({
    title: "Draft source A",
    agentId: agent.id,
  });
  const b = await store.createThread({
    title: "Draft destination B",
    agentId: agent.id,
  });
  const run = await store.createRun({ threadId: a.id, agentId: agent.id });
  await store.appendEvent({
    threadId: a.id,
    runId: run.id,
    type: "message.user",
    category: "message",
    visibility: "user",
    payload: {
      role: "user",
      text: "Work on this task while I prepare follow-up.",
    },
  });
  browser = await startWebUiBrowser(root);
  const context = browser.browser.contexts()[0];
  await context.addInitScript(() =>
    localStorage.setItem("napier.locale", "en"),
  );
  const external = [],
    errors = [],
    screenshots = [];
  await context.route("**/*", async (route) => {
    if (!route.request().url().startsWith(fixture.origin)) {
      external.push(route.request().url());
      await route.abort();
    } else await route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  const input = page.locator(".composer textarea");
  async function switchTo(thread) {
    const row = page.locator(".thread-row").filter({ hasText: thread.title });
    if (!(await row.isVisible()))
      await page
        .getByRole("button", { name: "展开会话导航", exact: true })
        .click();
    await row.click();
    await page.waitForFunction(
      (id) => new URL(location.href).searchParams.get("thread") === id,
      thread.id,
    );
    await input.waitFor();
    await page.waitForFunction(
      () => !document.querySelector(".composer textarea").disabled,
    );
  }
  await page.goto(`${fixture.origin}/?thread=${a.id}`);
  await input.fill("原会话未发送的草稿\n保留多行文本。");
  await page.locator(".composer-interaction-mode").selectOption("follow_up");
  await page.reload();
  await input.waitFor();
  assert.equal(await input.inputValue(), "原会话未发送的草稿\n保留多行文本。");
  assert.equal(
    await page.locator(".composer-interaction-mode").inputValue(),
    "follow_up",
  );
  await switchTo(b);
  assert.equal(await input.inputValue(), "");
  await input.fill("B draft stays independent");
  await switchTo(a);
  assert.equal(await input.inputValue(), "原会话未发送的草稿\n保留多行文本。");
  // Running interventions now stay in the durable outbox. Exercise ordinary
  // prompt failure here so draft recovery remains independently covered.
  await store.finishRun(run.id, "completed");
  await page.reload();
  await input.waitFor();
  const captured = Promise.withResolvers(),
    release = Promise.withResolvers();
  await page.route(
    `${fixture.origin}/api/threads/${a.id}/messages`,
    async (route) => {
      captured.resolve();
      await release.promise;
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page.locator('.composer button[type="submit"]').click();
  await captured.promise;
  await input.fill("A newer draft must survive");
  await switchTo(b);
  release.resolve();
  await page.waitForFunction(() =>
    Object.keys(localStorage).some(
      (key) =>
        key.startsWith("napier.thread-composer.v1:") &&
        JSON.parse(localStorage.getItem(key)).recovered.length === 1,
    ),
  );
  assert.equal(await input.inputValue(), "B draft stays independent");
  assert.equal(await page.locator(".composer-draft-notices").count(), 0);
  await switchTo(a);
  assert.equal(await input.inputValue(), "A newer draft must survive");
  await page
    .getByRole("button", { name: "Restore to composer", exact: true })
    .click();
  assert.equal(await input.inputValue(), "原会话未发送的草稿\n保留多行文本。");
  assert.match(
    await page.locator(".composer-draft-notices").innerText(),
    /A newer draft must survive/,
  );
  await page.reload();
  await input.waitFor();
  assert.equal(await input.inputValue(), "原会话未发送的草稿\n保留多行文本。");
  await page
    .getByRole("button", { name: "Restore to composer", exact: true })
    .waitFor();
  assert.match(
    await page.locator(".composer-draft-notices").innerText(),
    /A newer draft must survive/,
  );
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("napier.thread-composer.v1:"))
        throw new DOMException("Storage quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await input.fill("Only in this window after quota failure");
  await page.locator('.composer-draft-notices [role="alert"]').waitFor();
  assert.equal(
    await input.inputValue(),
    "Only in this window after quota failure",
  );
  await mkdir(`${output}.screenshots`, { recursive: true });
  for (const [width, height] of [
    [1280, 900],
    [1440, 900],
    [1920, 1080],
    [1280, 720],
    [720, 900],
    [390, 844],
    [320, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const overlay = page.getByRole("dialog", {
      name: "Workspace evidence",
      exact: true,
    });
    if (await overlay.isVisible())
      await overlay
        .getByRole("button", { name: "Hide workspace", exact: true })
        .click();
    await page
      .getByRole("button", { name: "Restore to composer", exact: true })
      .click({ trial: true });
    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    assert.ok(dimensions.document <= dimensions.viewport);
    const file = `${output}.screenshots/drafts-${width}-${height}.png`;
    await page.screenshot({ path: file });
    screenshots.push({
      path: path.basename(file),
      sha256: hash(await readFile(file)),
      ...dimensions,
    });
  }
  assert.deepEqual(await store.listRunControlMessages(a.id), []);
  assert.equal(fixture.provider.state.callCount, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.deepEqual(await sources(), before);
  await writeFile(
    output,
    JSON.stringify(
      {
        kind: "napier.composer-drafts-ui-evidence",
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        sourceHead: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        evidenceClass: "browser_and_real_service_with_prompt_transport_fault",
        textAndModeSurviveReload: true,
        threadDraftsIndependent: true,
        delayedFailureRetainsBothDrafts: true,
        recoverySurvivesReload: true,
        quotaFailurePreservesInputAndExplainsPersistence: true,
        modelCalls: 0,
        externalModelRequests: 0,
        pageErrors: errors,
        sourceDigests: before,
        screenshots,
        limitations: [
          "Intervention identity, retry and cancellation are verified by check-control-outbox-ui.mjs; this checker exercises ordinary prompt draft recovery.",
          "Workspace-key and late-image isolation are covered by Hook tests; this browser run verifies thread navigation and reload.",
          "Screenshots are viewport captures; no full accessibility audit or user-study measurement is claimed.",
        ],
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(`Composer persistence and failure ownership verified: ${output}`);
} finally {
  await browser?.close();
  await fixture?.close();
  await removeWebUiE2eRoot(root);
}
