import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { createApp, createServices } from "../apps/server/dist/app.js";
import { createGoal } from "../packages/runtime/dist/goals.js";
import {
  createWebUiE2eRoot,
  removeWebUiE2eRoot,
  startWebUiBrowser,
} from "./web-ui-e2e-runtime.mjs";

const output = path.resolve(
  process.argv[2] ?? "/tmp/napier-recovery-operations-ui.json",
);
const screenshotRoot = path.resolve("benchmark-results/recovery-operations-ui", path.basename(output));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sources = [
  "packages/contracts/src/manual-run-recovery.ts",
  "packages/contracts/src/thread-execution.ts",
  "packages/contracts/src/workspace-bootstrap-v1.ts",
  "packages/runtime/src/run-recovery-checkpoint.ts",
  "packages/runtime/src/thread-detail.ts",
  "packages/runtime/src/agent-run-recovery.ts",
  "packages/runtime/src/agent-runtime.ts",
  "packages/runtime/src/agent-runtime-options.ts",
  "packages/runtime/src/agent-run-lifecycle-events.ts",
  "packages/runtime/src/internal-research-recovery-authorization.ts",
  "packages/runtime/src/store.ts",
  "packages/runtime/src/run-execution-tool-surface.ts",
  "packages/runtime/src/run-patch-recovery-evidence.ts",
  "packages/runtime/src/workspace-patch-reconciled-evidence.ts",
  "packages/runtime/src/workspace-patch-uncommitted-evidence.ts",
  "apps/server/src/thread-execution-http.ts",
  "apps/server/src/thread-execution-http-validation.ts",
  "apps/server/src/thread-execution-http-response.ts",
  "apps/web/src/RecoveryBanner.tsx",
  "apps/web/src/RecoveryOperations.tsx",
  "apps/web/src/recovery-operations-copy.ts",
  "apps/web/src/recovery-operations.css",
  "apps/web/src/WorkbenchNotices.tsx",
  "apps/web/src/WorkbenchDeferredPanels.tsx",
  "apps/web/src/AppWorkspaceViews.tsx",
  "apps/web/src/use-workspace-view-model.ts",
  "apps/web/src/use-thread-recovery.ts",
  "apps/web/src/use-thread-submission.ts",
  "apps/web/src/thread-run-api.ts",
  "apps/web/src/stream-run-response-contract.ts",
  "packages/runtime/test/read-only-recovery.test.ts",
  "packages/runtime/test/run-recovery-checkpoint.test.ts",
  "scripts/check-recovery-operations-ui.mjs",
];
const digests = () =>
  Promise.all(
    sources.map(async (file) => ({
      path: file,
      sha256: hash(await readFile(file)),
    })),
  );
const before = await digests();
const root = await createWebUiE2eRoot();
let services, server, browser;
try {
  try {
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "packages/runtime/test/fixtures/patch-recovery-crash.ts",
        root,
        "after-file",
        "create",
        "verified_patches",
      ],
      { stdio: "pipe", timeout: 30000 },
    );
    assert.fail("Crash fixture did not stop");
  } catch (error) {
    assert.equal(error.status, 73);
  }
  services = await createServices({
    workspaceRoot: path.join(root, "workspace"),
    dataRoot: path.join(root, "data"),
    env: { NAPIER_E2E_MODEL_KEY: "fixture-only-never-sent" },
    startAutomation: false,
  });
  const provider = fauxProvider({ provider: "faux-patch-recovery" });
  services.models.registerProvider(provider.provider);
  await services.store.createCredentialReference({
    providerId: "openai",
    label: "Fixture readiness",
    source: { type: "environment", variable: "NAPIER_E2E_MODEL_KEY" },
  });
  const store = services.store;
  const thread = store
    .listThreads()
    .find((t) => t.title === "Retain settled patch");
  const original = store.listRuns(thread.id)[0];
  const goal = createGoal("Finish the original task including pending writes");
  await store.setGoal(thread.id, goal);
  const target = path.join(root, "workspace/retained.txt");
  const originalStat = await stat(target);
  const detail = await store.getDetail(thread.id);
  assert.equal(
    detail.recoveryCheckpoint.operations[0].reason,
    "patch_reconciled",
  );
  let readOnlySchemaVerified = false;
  provider.setResponses([
    (context) => {
      assert.ok(!context.tools.some((tool) => tool.name === "apply_patch"));
      readOnlySchemaVerified = true;
      return fauxAssistantMessage(
        fauxToolCall("apply_patch", {
          operation: "create",
          path: "forbidden.txt",
          expectedSha256: null,
          content: "never write",
        }),
        { stopReason: "toolUse" },
      );
    },
    fauxAssistantMessage(
      "Inspection finished. The original work remains pending.",
    ),
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  const app = createApp(services);
  app.use("/*", serveStatic({ root: path.resolve("apps/web/dist") }));
  app.get("*", async (c) =>
    c.html(await readFile("apps/web/dist/index.html", "utf8")),
  );
  const ready = Promise.withResolvers();
  server = serve(
    { fetch: app.fetch, hostname: "127.0.0.1", port: 0 },
    (address) => ready.resolve(`http://127.0.0.1:${address.port}`),
  );
  const origin = await ready.promise;
  browser = await startWebUiBrowser(root);
  const context = browser.browser.contexts()[0];
  await context.addInitScript(() =>
    localStorage.setItem("napier.locale", "en"),
  );
  const errors = [],
    external = [],
    requests = [],
    screenshots = [],
    layouts = [];
  await context.route("**/*", async (route) => {
    if (!route.request().url().startsWith(origin)) {
      external.push(route.request().url());
      await route.abort();
    } else await route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().endsWith("/resume"))
      requests.push(request.postDataJSON());
  });
  await page.goto(`${origin}/?thread=${thread.id}`);
  const region = page.getByRole("region", {
    name: "Continue from preserved work",
  });
  await region.waitFor();
  const disclosure = region.locator(".recovery-operations > summary");
  await disclosure.focus();
  await page.keyboard.press("Enter");
  await region
    .getByText("Target commit was independently reconciled.", { exact: false })
    .waitFor();
  assert.equal(
    await page.evaluate(() => document.activeElement?.tagName),
    "SUMMARY",
  );
  await mkdir(screenshotRoot, { recursive: true });
  for (const [width, height] of [
    [1440, 900],
    [1920, 1080],
    [1280, 900],
    [1280, 720],
    [720, 900],
    [390, 844],
    [320, 900],
  ]) {
    await page.setViewportSize({ width, height });
    if (width < 1252) {
      const hide = page
        .getByRole("dialog", { name: "Workspace evidence", exact: true })
        .getByRole("button", { name: "Hide workspace", exact: true });
      if (await hide.isVisible()) await hide.click();
    }
    const action = region.getByRole("button", {
      name: "Inspect read-only",
      exact: true,
    });
    await action.scrollIntoViewIfNeeded();
    await action.click({ trial: true });
    const box = await action.boundingBox();
    assert.ok(
      box &&
        box.width > 0 &&
        box.x >= 0 &&
        box.x + box.width <= width + 1 &&
        box.y >= 0 &&
        box.y + box.height <= height + 1,
      `action not reachable: ${width}`,
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    assert.equal(overflow, false, `page overflow: ${width}`);
    layouts.push({
      width,
      height,
      horizontalOverflow: overflow,
      actionReachable: true,
    });
    if (width === 1440 || width === 320) {
      const file = `${screenshotRoot}/recovery-${width}.png`;
      await page.screenshot({ path: file });
      screenshots.push({ path: file, sha256: hash(await readFile(file)) });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await region.getByRole("button", { name: "Open trajectory" }).click();
  await page.locator("#workspace-panel-trajectory").waitFor();
  await page.getByRole("tab", { name: "Conversation", exact: true }).click();
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/resume"),
  );
  await region
    .getByRole("button", { name: "Inspect read-only", exact: true })
    .click();
  const response = await responsePromise;
  assert.equal(response.headers()["x-napier-resume-read-only"], "true");
  await response.finished();
  await page.reload();
  await region.waitFor();
  const runs = store.listRuns(thread.id);
  assert.equal(runs.length, 2);
  assert.equal(runs[1].configuration.executionMode, "safe_read_only_recovery");
  assert.equal(runs[1].outcome, "partial");
  assert.deepEqual(store.getThread(thread.id).goal, goal);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].readOnly, true);
  assert.equal(requests[0].runId, original.id);
  assert.ok(readOnlySchemaVerified);
  await assert.rejects(stat(path.join(root, "workspace/forbidden.txt")), {
    code: "ENOENT",
  });
  const finalStat = await stat(target);
  assert.equal(finalStat.ino, originalStat.ino);
  assert.equal(finalStat.mtimeMs, originalStat.mtimeMs);
  const finalDetail = await store.getDetail(thread.id);
  assert.equal(finalDetail.recoveryCheckpoint.sourceRunId, original.id);
  assert.equal(
    finalDetail.recoveryCheckpoint.operations[0].reason,
    "patch_reconciled",
  );
  assert.equal(finalDetail.taskNarrative.phase === "completed", false);
  const retry = await fetch(`${origin}/api/threads/${thread.id}/resume`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requests[0]),
  });
  assert.ok((await retry.text()).includes("run_failed"));
  assert.equal(store.listRuns(thread.id).length, 2);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    await digests(),
    before,
    "Source changed during browser verification",
  );
  await writeFile(
    output,
    JSON.stringify(
      {
        schemaVersion: 1,
        recordedAt: new Date().toISOString(),
        sourceHead: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        sources: before,
        externalModelRequests: 0,
        fixtureModelCalls: provider.state.callCount,
        realProcessCrash: "after-file",
        requestBound: true,
        enforcedReadOnly: true,
        originalFileUnchanged: true,
        inspectionRemainsPartial: true,
        originalGoalUnchanged: true,
        retainedCheckpointPreserved: true,
        staleRetryCreatedRuns: 0,
        layouts,
        screenshots,
        pageErrors: errors,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      receipt: output,
      layouts: layouts.length,
      fixtureModelCalls: provider.state.callCount,
    }),
  );
} finally {
  if (browser) await browser.close();
  if (server)
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  if (services) await services.shutdownLocalRuntime();
  await removeWebUiE2eRoot(root);
}
