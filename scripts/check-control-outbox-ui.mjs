import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { startDecisionUiFixture } from "./operator-decision-ui-fixture.mjs";
import {
  createWebUiE2eRoot,
  removeWebUiE2eRoot,
  startWebUiBrowser,
} from "./web-ui-e2e-runtime.mjs";

const output = path.resolve(
  process.argv[2] ?? "/tmp/napier-control-outbox-ui.json",
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sources = [
  "apps/web/src/run-control-outbox-store.ts",
  "apps/web/src/run-control-outbox-actions.ts",
  "apps/web/src/run-control-outbox-copy.ts",
  "apps/web/src/use-run-control-outbox.ts",
  "apps/web/src/use-thread-submission.ts",
  "apps/web/src/ControlOutbox.tsx",
  "apps/web/src/control-outbox.css",
  "apps/web/src/use-workspace-view-model.ts",
  "apps/web/src/thread-run-api.ts",
  "apps/web/src/AppWorkspaceViews.tsx",
  "apps/web/src/Composer.tsx",
  "apps/web/src/ComposerInteractionBar.tsx",
  "scripts/check-control-outbox-ui.mjs",
];
async function digests() {
  return Promise.all(
    sources.map(async (file) => ({
      path: file,
      sha256: hash(await readFile(file)),
    })),
  );
}
async function builtDigest(root) {
  const files = (
    await readdir(root, { recursive: true, withFileTypes: true })
  ).filter((entry) => entry.isFile());
  const values = await Promise.all(
    files.map(async (entry) => {
      const file = path.join(entry.parentPath, entry.name);
      return [path.relative(root, file), hash(await readFile(file))];
    }),
  );
  return { files: files.length, sha256: hash(JSON.stringify(values.sort())) };
}
const before = await digests();
const builds = await Promise.all(
  ["apps/web/dist", "apps/server/dist", "packages/runtime/dist"].map(
    builtDigest,
  ),
);
const root = await createWebUiE2eRoot();
let fixture, browser, runDone;
const entered = Promise.withResolvers(),
  release = Promise.withResolvers();
const consumed = Promise.withResolvers(),
  finish = Promise.withResolvers();
try {
  fixture = await startDecisionUiFixture(root);
  const { store, provider, origin } = fixture;
  const agent = store.listAgents()[0];
  const a = await store.createThread({
    title: "Outbox source A",
    agentId: agent.id,
  });
  const b = await store.createThread({
    title: "Independent draft B",
    agentId: agent.id,
  });
  let observedFinalCount = 0;
  provider.setResponses([
    async () => {
      entered.resolve();
      await release.promise;
      return fauxAssistantMessage("Initial task reached its answer.");
    },
    async (context) => {
      const content = JSON.stringify(context.messages);
      assert.ok(content.includes("Replacement survives refresh"));
      assert.ok(!content.includes("Withdraw this original"));
      assert.ok(!content.includes("Response loss instruction"));
      observedFinalCount = context.messages.filter(
        (message) =>
          message.role === "user" &&
          JSON.stringify(message).includes("Replacement survives refresh"),
      ).length;
      assert.equal(observedFinalCount, 1);
      consumed.resolve();
      await finish.promise;
      return fauxAssistantMessage(
        "The fixture saw one replacement instruction.",
      );
    },
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  runDone = fetch(`${origin}/api/threads/${a.id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "Hold the initial task for intervention acceptance.",
      model: { provider: "faux-decision-ui", id: "faux-1" },
    }),
  }).then(async (response) => {
    assert.equal(response.ok, true);
    return response.text();
  });
  await entered.promise;
  const run = store.listRuns(a.id)[0];
  assert.ok(run);
  browser = await startWebUiBrowser(root);
  const context = browser.browser.contexts()[0];
  await context.addInitScript(() =>
    localStorage.setItem("napier.locale", "en"),
  );
  const external = [],
    errors = [],
    screenshots = [],
    observations = [];
  await context.route("**/*", async (route) => {
    if (!route.request().url().startsWith(origin)) {
      external.push(route.request().url());
      await route.abort();
    } else await route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  const input = page.locator(".composer textarea");
  const queueUrl = `${origin}/api/threads/${a.id}/runs/${run.id}/control-messages`;
  const row = (id) =>
    page.locator(`.control-outbox li[data-message-id="${id}"]`);
  async function state(id, text) {
    await row(id)
      .locator(".control-outbox-state")
      .filter({ hasText: text })
      .waitFor();
  }
  async function send(text, mode = "follow_up") {
    await input.fill(text);
    await page.locator(".composer-interaction-mode").selectOption(mode);
    await page.locator('.composer-run-actions button[type="submit"]').click();
  }
  async function stored() {
    return page.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith("napier.control-outbox.v1:"))
        .map((key) => JSON.parse(localStorage.getItem(key))),
    );
  }
  async function switchTo(thread) {
    const target = page
      .locator(".thread-row")
      .filter({ hasText: thread.title });
    if (!(await target.isVisible()))
      await page
        .getByRole("button", { name: "展开会话导航", exact: true })
        .click();
    await target.click();
    await page.waitForFunction(
      (id) => new URL(location.href).searchParams.get("thread") === id,
      thread.id,
    );
    await page.waitForFunction(
      () => !document.querySelector(".composer textarea").disabled,
    );
  }
  await page.goto(`${origin}/?thread=${a.id}`);
  await input.waitFor();
  // Commit on the real HTTP server, then lose the response and temporarily lose GET reconciliation.
  const offlineReconciliation = async (route) => {
    if (route.request().method() === "GET") await route.abort("failed");
    else await route.fallback();
  };
  await page.route(queueUrl, offlineReconciliation);
  let lostIdentity;
  await page.route(
    queueUrl,
    async (route) => {
      lostIdentity = route.request().postDataJSON().clientMessageId;
      const saved = (await stored()).find((item) => item.id === lostIdentity);
      assert.equal(saved.runId, run.id);
      assert.equal(saved.threadId, a.id);
      const response = await route.fetch();
      assert.equal(response.status(), 202);
      await route.abort("failed");
    },
    { times: 1 },
  );
  await send("Response loss instruction");
  await page.waitForFunction(() =>
    document
      .querySelector(".control-outbox")
      ?.textContent.includes("Delivery unconfirmed"),
  );
  await input.fill("Newer A input stays independent");
  // Retry is an actual second HTTP request with the original id; the ledger still has one queue event.
  await row(lostIdentity)
    .getByRole("button", { name: "Retry original message", exact: true })
    .click();
  await state(lostIdentity, "Queued");
  assert.equal(await input.inputValue(), "Newer A input stays independent");
  assert.equal((await store.listRunControlMessages(a.id)).length, 1);
  await page.unroute(queueUrl, offlineReconciliation);
  await page.reload();
  await input.waitFor();
  await state(lostIdentity, "Queued");
  const cancelUrl = `${queueUrl}/${(await store.listRunControlMessages(a.id))[0].id}/cancel`;
  await page.route(
    cancelUrl,
    async (route) => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort("failed");
    },
    { times: 1 },
  );
  await row(lostIdentity)
    .getByRole("button", { name: "Withdraw", exact: true })
    .click();
  await state(lostIdentity, "Cancelled");
  observations.push({
    scenario: "lost_queue_and_cancel_responses",
    queueEvents: 1,
    cancellationEvents: 1,
    stableIdentity: lostIdentity,
  });

  await send("Withdraw this original");
  await page.waitForFunction(
    () => document.querySelectorAll(".control-outbox li").length === 2,
  );
  const original = (await stored()).find(
    (item) => item.text === "Withdraw this original",
  );
  await state(original.id, "Queued");
  await row(original.id)
    .getByRole("button", { name: "Withdraw then edit", exact: true })
    .click();
  const editor = row(original.id).getByRole("textbox", {
    name: "Replacement text",
    exact: true,
  });
  await editor.fill("Replacement survives refresh");
  await page.reload();
  await input.waitFor();
  assert.equal(await editor.inputValue(), "Replacement survives refresh");
  // Keyboard activation after restoring the editor.
  await row(original.id)
    .getByRole("button", { name: "Send replacement", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  const replacementId =
    original.edit?.replacementId ??
    (await stored()).find((item) => item.id === original.id).edit.replacementId;
  await state(replacementId, "Queued");
  assert.equal(await input.inputValue(), "");
  observations.push({
    scenario: "withdraw_edit_refresh_replace",
    original: original.id,
    replacement: replacementId,
  });

  // Delayed failed A submission finishes while B is selected. Its intent stays only in A's outbox.
  const captured = Promise.withResolvers(),
    abort = Promise.withResolvers();
  let delayedId;
  await page.route(
    queueUrl,
    async (route) => {
      delayedId = route.request().postDataJSON().clientMessageId;
      captured.resolve();
      await abort.promise;
      await route.abort("failed");
    },
    { times: 1 },
  );
  await send("A delayed request must keep its original run");
  await captured.promise;
  await input.fill("Fresh A draft");
  await switchTo(b);
  await input.fill("B draft remains untouched");
  abort.resolve();
  await page.waitForFunction(
    (id) =>
      Object.keys(localStorage).some(
        (key) =>
          key.includes(id) &&
          JSON.parse(localStorage.getItem(key)).state === "uncertain",
      ),
    delayedId,
  );
  assert.equal(await input.inputValue(), "B draft remains untouched");
  assert.equal(await page.locator(".control-outbox").count(), 0);
  await switchTo(a);
  assert.equal(await input.inputValue(), "Fresh A draft");
  await page.reload();
  await input.waitFor();
  await state(delayedId, "Delivery unconfirmed");
  observations.push({
    scenario: "delayed_thread_failure_and_reload",
    originalRun: run.id,
    identity: delayedId,
  });

  // Let the real Runtime consume the replacement while cancellation is in flight.
  const receipt = (await store.listRunControlMessages(a.id)).find(
    (item) => item.clientMessageId === replacementId,
  );
  await page.route(
    `${queueUrl}/${receipt.id}/cancel`,
    async (route) => {
      release.resolve();
      await consumed.promise;
      await route.continue();
    },
    { times: 1 },
  );
  await row(replacementId)
    .getByRole("button", { name: "Withdraw then edit", exact: true })
    .click();
  await state(replacementId, "Consumed");
  assert.equal(
    await row(replacementId)
      .getByRole("button", { name: "Send replacement", exact: true })
      .count(),
    0,
  );
  finish.resolve();
  await runDone;
  assert.equal(store.listRuns(a.id)[0].status, "completed");
  observations.push({
    scenario: "runtime_consumption_wins_withdrawal",
    modelSawInstructionCount: observedFinalCount,
    replacementPrevented: true,
  });

  // A different current Run cannot attract an uncertain old request's retry.
  const nextRun = await store.createRun({ threadId: a.id, agentId: agent.id });
  await page.reload();
  await input.waitFor();
  await row(delayedId)
    .getByRole("button", { name: "Retry original message", exact: true })
    .click();
  await state(delayedId, "Send failed");
  assert.equal(
    (await store.listRunControlMessages(a.id)).filter(
      (item) => item.runId === nextRun.id,
    ).length,
    0,
  );
  observations.push({
    scenario: "retry_after_new_run_started",
    addressedRun: run.id,
    currentRun: nextRun.id,
    newRunQueueEvents: 0,
  });

  // Legacy queue entries can still be withdrawn from this surface.
  const legacy = await store.queueRunControlMessage({
    threadId: a.id,
    runId: nextRun.id,
    mode: "follow_up",
    text: "Legacy sender",
  });
  await page.reload();
  await input.waitFor();
  await state(legacy.id, "Queued");
  await row(legacy.id)
    .getByRole("button", { name: "Withdraw", exact: true })
    .click();
  await state(legacy.id, "Cancelled");
  observations.push({
    scenario: "legacy_queue_withdrawal",
    noInventedClientIdentity: true,
  });

  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("napier.control-outbox.v1:"))
        throw new DOMException("Quota", "QuotaExceededError");
      return set.call(this, key, value);
    };
  });
  await send("Storage failure must preserve this input");
  await page.locator('.control-outbox [role="alert"]').waitFor();
  assert.equal(
    await input.inputValue(),
    "Storage failure must preserve this input",
  );
  assert.equal((await store.listRunControlMessages(a.id)).length, 4);
  observations.push({
    scenario: "outbox_quota_failure",
    newRequests: 0,
    composerRetained: true,
  });

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
    const overlay = page.getByRole("dialog", {
      name: "Workspace evidence",
      exact: true,
    });
    if (await overlay.isVisible())
      await overlay
        .getByRole("button", { name: "Hide workspace", exact: true })
        .click();
    await row(delayedId)
      .getByRole("button", { name: "Retry original message", exact: true })
      .click({ trial: true });
    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    assert.ok(dimensions.document <= dimensions.viewport);
    const file = `${output}.screenshots/outbox-${width}-${height}.png`;
    await page.screenshot({ path: file });
    screenshots.push({
      path: path.basename(file),
      sha256: hash(await readFile(file)),
      ...dimensions,
    });
  }
  const events = await store.listEvents(a.id);
  const eventCounts = Object.fromEntries(
    [
      "run.control.queued",
      "run.control.cancelled",
      "run.control.delivered",
    ].map((type) => [
      type,
      events.filter((event) => event.type === type).length,
    ]),
  );
  assert.deepEqual(eventCounts, {
    "run.control.queued": 4,
    "run.control.cancelled": 3,
    "run.control.delivered": 1,
  });
  assert.equal(provider.state.callCount, 3);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.deepEqual(await digests(), before);
  await writeFile(
    output,
    JSON.stringify(
      {
        kind: "napier.control-outbox-ui-evidence",
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        sourceHead: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        evidenceClass:
          "real_chromium_http_runtime_sqlite_with_explicit_faux_model_and_transport_faults",
        modelCalls: provider.state.callCount,
        externalModelRequests: 0,
        observations,
        eventCounts,
        pageErrors: errors,
        sourceDigests: before,
        builtDigests: builds,
        screenshots,
        limitations: [
          "Faux model consumption verifies delivery, not instruction fulfillment or live-model quality.",
          "Workspace-generation isolation is exercised by Hook tests; browser evidence covers thread navigation.",
          "Viewport captures and keyboard activation are not a screen-reader user study or full G06-B usability acceptance.",
          "Build includes preserved pre-existing frontend worktree changes; this is not clean-release evidence.",
        ],
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(`Control outbox verified: ${output}`);
} finally {
  release.resolve();
  finish.resolve();
  await runDone?.catch(() => {});
  await browser?.close();
  await fixture?.close();
  await removeWebUiE2eRoot(root);
}
