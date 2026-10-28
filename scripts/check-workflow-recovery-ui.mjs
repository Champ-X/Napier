import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, stat, rm } from "node:fs/promises";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp, createServices } from "../apps/server/dist/app.js";
import {
  createWebUiE2eRoot,
  removeWebUiE2eRoot,
  startWebUiBrowser,
} from "./web-ui-e2e-runtime.mjs";

const output = path.resolve(
  process.argv[2] ?? "/tmp/napier-workflow-recovery-ui.json",
);
const screenshotRoot = path.resolve(
  "benchmark-results/workflow-recovery-ui",
  path.basename(output),
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sources = [
  "packages/contracts/src/workflow-recovery.ts",
  "packages/contracts/src/run-event-domain-definitions-v1.ts",
  "packages/contracts/package.json",
  "packages/runtime/src/workflow-manifest-store.ts",
  "packages/runtime/src/workflow-recovery-checkpoint.ts",
  "packages/runtime/src/workflow-context-factory.ts",
  "packages/runtime/src/workflow-runtime.ts",
  "packages/runtime/src/workflow-execution-lock.ts",
  "packages/runtime/src/workflow-breakpoints.ts",
  "packages/runtime/src/workflow-approval-node.ts",
  "apps/server/src/workflow-recovery-http.ts",
  "apps/server/src/thread-workflow-http.ts",
  "apps/web/src/workflow-recovery-api.ts",
  "apps/web/src/use-workflow-recovery.ts",
  "apps/web/src/WorkflowRecoveryPanel.tsx",
  "apps/web/src/workflow-recovery-copy.ts",
  "apps/web/src/workflow-recovery.css",
  "apps/web/src/workflow-result-web-protocol.ts",
  "apps/web/src/TaskWorkspace.tsx",
  "apps/web/src/TaskOverviewPanel.tsx",
  "apps/web/src/task-overview-view-model.ts",
  "packages/runtime/test/workflow-recovery-checkpoint.test.ts",
  "packages/runtime/test/fixtures/workflow-checkpoint-crash.ts",
  "packages/runtime/test/fixtures/workflow-checkpoint-ui-setup.ts",
  "packages/runtime/test/fixtures/workflow-approval-recovery-setup.ts",
  "apps/server/test/workflow-recovery.test.ts",
  "apps/web/test/workflow-recovery.test.tsx",
  "scripts/check-workflow-recovery-ui.mjs",
  "scripts/generate-management-openapi.mjs",
  "scripts/generate-management-openapi.test.mjs",
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
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "packages/runtime/test/fixtures/workflow-checkpoint-ui-setup.ts",
      root,
    ],
    { stdio: "pipe", timeout: 30000 },
  );
  const fixture = JSON.parse(
    await readFile(path.join(root, "workflow-ui-fixture.json"), "utf8"),
  );
  services = await createServices({
    workspaceRoot: path.join(root, "workspace"),
    dataRoot: path.join(root, "data"),
    startAutomation: false,
  });
  const app = createApp(services);
  app.use("/*", serveStatic({ root: path.resolve("apps/web/dist") }));
  app.get("*", async (context) =>
    context.html(await readFile("apps/web/dist/index.html", "utf8")),
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
  const external = [],
    errors = [],
    requests = [],
    layouts = [],
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
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/recovery"))
      requests.push({ url: request.url(), body: request.postDataJSON() });
  });
  const region = page.getByRole("region", {
    name: "Continue Workflow",
    exact: true,
  });
  async function open(item) {
    await page.goto(`${origin}/?thread=${item.threadId}`);
    await page.locator("#workspace-view-task").click();
    await region.waitFor();
    await region.getByRole("button", { name: "Refresh checkpoint" }).waitFor();
  }
  async function saveAnswer(text) {
    const panel = page.locator(".operator-decision");
    await panel.locator('input[value="option_1"]').check();
    await panel.locator(".operator-decision-custom summary").click();
    await panel.getByRole("textbox", { name: "Other direction" }).fill(text);
    await panel
      .getByRole("button", { name: "Save answer only", exact: true })
      .click();
    await panel
      .getByText("Answer saved. Resume this workflow from its controls.", {
        exact: true,
      })
      .waitFor();
    await page.locator("#workspace-view-task").click();
    await region
      .getByRole("button", { name: "Continue Workflow", exact: true })
      .waitFor();
  }
  await open(fixture.approval);
  await region
    .getByRole("button", { name: "Review decision", exact: true })
    .click();
  await saveAnswer("Browser approval retained across response loss.");
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
    const hide = page
      .getByRole("dialog", { name: "Workspace evidence", exact: true })
      .getByRole("button", { name: "Hide workspace", exact: true });
    if (await hide.isVisible()) await hide.click();
    const button = region.getByRole("button", {
      name: "Continue Workflow",
      exact: true,
    });
    await button.scrollIntoViewIfNeeded();
    await button.click({ trial: true });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    const box = await button.boundingBox();
    assert.ok(
      box &&
        box.x >= 0 &&
        box.x + box.width <= width + 1 &&
        box.y >= 0 &&
        box.y + box.height <= height + 1,
    );
    layouts.push({
      width,
      height,
      actionReachable: true,
      horizontalOverflow: false,
    });
    if (width === 1440 || width === 320) {
      const file = path.join(screenshotRoot, `workflow-${width}.png`);
      await page.screenshot({ path: file });
      screenshots.push({ path: file, sha256: hash(await readFile(file)) });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await region.locator("summary").focus();
  await page.keyboard.press("Enter");
  assert.equal(await region.locator("details").getAttribute("open"), "");
  let lost = false;
  const recoveryUrl = `${origin}/api/threads/${fixture.approval.threadId}/workflows/${fixture.approval.planId}/recovery`;
  await page.route(recoveryUrl, async (route) => {
    if (route.request().method() === "POST" && !lost) {
      lost = true;
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort("failed");
    } else await route.continue();
  });
  await region
    .getByRole("button", { name: "Continue Workflow", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await region
    .getByRole("button", { name: "Workflow steps finished", exact: true })
    .waitFor();
  await region.getByRole("alert").waitFor();
  assert.ok(lost);
  const target = path.join(root, "workspace/approved.txt");
  assert.equal(
    await readFile(target, "utf8"),
    "Browser approval retained across response loss.",
  );
  const fileBefore = await stat(target);
  const old = requests[0];
  assert.equal(
    (
      await fetch(old.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(old.body),
      })
    ).status,
    409,
  );
  const fileAfter = await stat(target);
  assert.deepEqual(
    [fileAfter.ino, fileAfter.mtimeMs],
    [fileBefore.ino, fileBefore.mtimeMs],
  );
  observations.push({
    scenario: "saved-approval-response-loss",
    browserSavedAnswer: true,
    responseDroppedAfterHttpCommit: true,
    staleRetryStatus: 409,
    unchangedFileIdentity: true,
  });

  await open(fixture.breakpoint);
  await region
    .getByRole("button", { name: "Continue past this breakpoint", exact: true })
    .click();
  await region
    .getByRole("button", { name: "Review decision", exact: true })
    .click();
  await saveAnswer("Second breakpoint releases exactly one write.");
  await region
    .getByRole("button", { name: "Continue Workflow", exact: true })
    .click();
  await region
    .getByRole("button", { name: "Continue past this breakpoint", exact: true })
    .waitFor();
  const firstBreakpoint = requests.find((request) =>
    request.url.includes(fixture.breakpoint.threadId),
  );
  assert.equal(
    (
      await fetch(firstBreakpoint.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(firstBreakpoint.body),
      })
    ).status,
    409,
  );
  await assert.rejects(stat(path.join(root, "workspace/breakpoint.txt")), {
    code: "ENOENT",
  });
  await region
    .getByRole("button", { name: "Continue past this breakpoint", exact: true })
    .click();
  await region
    .getByRole("button", { name: "Workflow steps finished", exact: true })
    .waitFor();
  assert.equal(
    await readFile(path.join(root, "workspace/breakpoint.txt"), "utf8"),
    "Second breakpoint releases exactly one write.",
  );
  const events = await services.store.listEvents(fixture.breakpoint.threadId);
  assert.equal(
    events.filter((event) => event.type === "tool.started").length,
    1,
  );
  observations.push({
    scenario: "two-breakpoints",
    staleRequestDidNotReleaseLaterBreakpoint: true,
    writeStarts: 1,
  });

  await rm(
    path.join(
      root,
      "data/workflow-manifests",
      `${fixture.breakpoint.manifestSha256}.json`,
    ),
  );
  await region.getByRole("button", { name: "Refresh checkpoint" }).click();
  await region
    .getByText("The original definition is missing", { exact: false })
    .waitFor();
  assert.equal(await region.locator(".workflow-recovery-primary").count(), 0);
  observations.push({
    scenario: "missing-definition",
    recoveryActionRemoved: true,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.deepEqual(
    await digests(),
    before,
    "Source changed during verification",
  );
  await writeFile(
    output,
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: "napier.workflow-recovery-ui-evidence",
        recordedAt: new Date().toISOString(),
        sourceHead: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        sources: before,
        externalModelRequests: 0,
        fixtureModelCalls: 0,
        observations,
        layouts,
        screenshots,
        pageErrors: errors,
        responseLossMechanism:
          "Browser abort after an actual HTTP response completed; not a TCP packet-loss injection.",
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      receipt: output,
      scenarios: observations.length,
      layouts: layouts.length,
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
