import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { startDecisionUiFixture } from "./operator-decision-ui-fixture.mjs";
import {
  createWebUiE2eRoot,
  removeWebUiE2eRoot,
  startWebUiBrowser,
} from "./web-ui-e2e-runtime.mjs";

const output = path.resolve(process.argv[2] ?? "/tmp/napier-decision-ui.json");
const screenshotRoot = `${output}.screenshots`;
const sourceFiles = [
  "apps/web/src/OperatorDecisionPanel.tsx",
  "apps/web/src/RunDecisionDockets.tsx",
  "apps/web/src/use-operator-decision-actions.ts",
  "apps/web/src/use-thread-decision-actions.ts",
  "apps/web/src/use-workspace-view-model.ts",
  "apps/web/src/thread-run-api.ts",
  "apps/web/src/operator-decision-copy.ts",
  "apps/web/src/operator-decision-panel.css",
  "scripts/operator-decision-ui-fixture.mjs",
  "scripts/check-operator-decision-ui.mjs",
];
const hash = (data) => createHash("sha256").update(data).digest("hex");
async function digests(files) {
  return Promise.all(
    files.map(async (file) => ({
      path: file,
      sha256: hash(await readFile(file)),
    })),
  );
}
async function treeFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? treeFiles(path.join(root, entry.name))
          : [path.join(root, entry.name)],
      ),
    )
  )
    .flat()
    .sort();
}
const boundFiles = [
  ...sourceFiles,
  ...(await treeFiles("apps/web/dist")),
  ...(await treeFiles("apps/server/dist")),
  ...(await treeFiles("packages/runtime/dist")),
  ...(await treeFiles("packages/contracts/dist")),
];
const before = await digests(boundFiles);
const root = await createWebUiE2eRoot();
let fixture, browser;
const observations = [],
  screenshots = [],
  pageErrors = [],
  externalRequests = [];
const waitFor = async (predicate, message) => {
  const deadline = Date.now() + 20000;
  while (!(await predicate())) {
    assert.ok(Date.now() < deadline, message);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
try {
  await mkdir(screenshotRoot, { recursive: true });
  fixture = await startDecisionUiFixture(root);
  const names = [
    "normal",
    "save-failure",
    "save-response-loss",
    "continue-failure",
    "continue-response-loss",
    "save-only",
    "switch-a",
    "switch-b",
  ];
  const items = {};
  for (const name of names) items[name] = await fixture.seed(name);
  browser = await startWebUiBrowser(root);
  const context = browser.browser.contexts()[0];
  await context.addInitScript(() =>
    localStorage.setItem("napier.locale", "en"),
  );
  await context.route("**/*", async (route) => {
    if (!route.request().url().startsWith(fixture.origin)) {
      externalRequests.push(route.request().url());
      await route.abort();
    } else await route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.setDefaultTimeout(15000);
  const panel = page.locator(".operator-decision");
  const primary = () =>
    panel.getByRole("button", { name: "Answer and continue", exact: true });
  const retry = () =>
    panel.getByRole("button", { name: "Continue run", exact: true });
  async function open(item) {
    await page.goto(`${fixture.origin}/?thread=${item.thread.id}`);
    await panel.getByText(item.decision.question, { exact: true }).waitFor();
  }
  async function fill(text) {
    await panel.locator('input[value="option_1"]').check();
    await panel.locator(".operator-decision-custom summary").click();
    await panel.getByRole("textbox", { name: "Other direction" }).fill(text);
  }
  async function completed(item, answer) {
    await waitFor(
      async () =>
        (await fixture.store.listOperatorDecisions(item.thread.id))[0]
          ?.status === "continued" &&
        fixture.store
          .listRuns(item.thread.id)
          .every((run) => run.status === "completed"),
      `${item.name} did not complete`,
    );
    await panel.waitFor({ state: "hidden" });
    observations.push(await fixture.inspect(item, 2, answer));
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(items.normal);
  await primary().click();
  assert.match(await panel.getByRole("alert").innerText(), /Choose an option/);
  assert.equal(
    await panel
      .locator("input")
      .first()
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await fill("Keyboard answer");
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
    const evidenceOverlay = page.getByRole("dialog", {
      name: "Workspace evidence",
      exact: true,
    });
    if (await evidenceOverlay.isVisible())
      await evidenceOverlay
        .getByRole("button", { name: "Hide workspace", exact: true })
        .click();
    await primary().click({ trial: true });
    await panel.scrollIntoViewIfNeeded();
    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    assert.ok(
      dimensions.document <= dimensions.viewport,
      `Overflow at ${width}`,
    );
    const file = path.join(screenshotRoot, `question-${width}-${height}.png`);
    await panel.screenshot({ path: file });
    screenshots.push({
      path: path.basename(file),
      sha256: hash(await readFile(file)),
      width,
      height,
      ...dimensions,
    });
  }
  fixture.prepare(items.normal, "Keyboard answer");
  await primary().focus();
  await page.keyboard.press("Enter");
  await completed(items.normal, "Keyboard answer");
  await page.setViewportSize({ width: 1440, height: 900 });

  const failures = [
    ["save-failure", "answer", false],
    ["save-response-loss", "answer", true],
    ["continue-failure", "continue", false],
    ["continue-response-loss", "continue", true],
  ];
  for (const [name, endpoint, responseLost] of failures) {
    const item = items[name],
      answer = `Retain ${name}`;
    await open(item);
    await fill(answer);
    fixture.prepare(item, answer);
    let faultInjected = false;
    const url = `${fixture.origin}${item.base}/${endpoint}`;
    await page.route(
      url,
      async (route) => {
        if (responseLost) assert.ok((await route.fetch()).ok());
        faultInjected = true;
        await route.abort("failed");
      },
      { times: 1 },
    );
    await primary().click();
    await waitFor(() => faultInjected, `Fault not reached for ${name}`);
    if (name === "continue-response-loss") {
      await completed(item, answer);
      assert.equal(
        await page
          .getByText(/Your answer is saved. Continuing could not be confirmed/)
          .count(),
        0,
      );
      // Independently repeat the real HTTP identity after a lost stream response.
      const result = await context.request.post(
        `${fixture.origin}${item.base}/continue`,
        { data: {} },
      );
      assert.ok(result.ok());
      assert.ok((await result.text()).includes('"status":"completed"'));
      await fixture.inspect(item, 2, answer);
    } else {
      await panel.getByRole("alert").waitFor();
      await waitFor(
        () =>
          panel.getAttribute("aria-busy").then((value) => value === "false"),
        "Question remains busy",
      );
      assert.equal(
        await panel
          .getByRole("textbox", { name: "Other direction" })
          .inputValue(),
        answer,
      );
      if (name === "save-response-loss")
        assert.match(
          await panel.getByRole("alert").innerText(),
          /Your answer was saved/,
        );
      if (name === "save-failure") await primary().click();
      else await retry().click();
      await completed(item, answer);
    }
  }
  await open(items["save-only"]);
  await fill("Save without execution");
  const callsBefore = fixture.provider.state.callCount;
  await panel
    .getByRole("button", { name: "Save answer only", exact: true })
    .click();
  await retry().waitFor();
  observations.push(await fixture.inspect(items["save-only"], 1));
  assert.equal(fixture.provider.state.callCount, callsBefore);

  const a = items["switch-a"],
    b = items["switch-b"];
  await open(a);
  await fill("A continues in background");
  fixture.prepare(a, "A continues in background");
  const captured = Promise.withResolvers(),
    release = Promise.withResolvers();
  await page.route(
    `${fixture.origin}${a.base}/answer`,
    async (route) => {
      captured.resolve();
      await release.promise;
      await route.continue();
    },
    { times: 1 },
  );
  await primary().click();
  await captured.promise;
  const row = page.locator(".thread-row").filter({ hasText: b.name });
  if (!(await row.isVisible()))
    await page
      .getByRole("button", { name: "展开会话导航", exact: true })
      .click();
  await row.click();
  await panel.getByText(b.decision.question, { exact: true }).waitFor();
  assert.equal(await primary().isEnabled(), true);
  await fill("B draft remains here");
  release.resolve();
  await waitFor(
    () =>
      fixture.store.listRuns(a.thread.id).length === 2 &&
      fixture.store
        .listRuns(a.thread.id)
        .every((run) => run.status === "completed"),
    "A did not finish in background",
  );
  observations.push(await fixture.inspect(a, 2, "A continues in background"));
  assert.equal(
    await panel.getByRole("textbox", { name: "Other direction" }).inputValue(),
    "B draft remains here",
  );
  assert.equal(await primary().isEnabled(), true);
  assert.equal(await panel.getByRole("alert").count(), 0);
  assert.equal(fixture.store.listRuns(b.thread.id).length, 1);
  observations.push({
    scenario: "thread-switch",
    otherThreadEditable: true,
    draftPreserved: true,
    errorDidNotLeak: true,
    noAutomaticSelection: true,
  });
  assert.equal(fixture.provider.state.callCount, 18);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(
    await digests(boundFiles),
    before,
    "Bound files changed during verification",
  );
  const build = before.filter((item) => item.path.includes("/dist/"));
  await writeFile(
    output,
    JSON.stringify(
      {
        kind: "napier.operator-decision-ui-evidence",
        schemaVersion: 1,
        evidenceClass: "deterministic_browser_http_runtime_integration",
        capturedAt: new Date().toISOString(),
        sourceHead: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        sourceState:
          "dirty worktree; source and full served build bound by digests",
        modelProvider: "explicit faux provider",
        externalModelRequests: 0,
        modelCalls: fixture.provider.state.callCount,
        observations,
        screenshots,
        keyboardSubmission: true,
        keyboardSubmissionViewport: 320,
        emptyValidationFocus: true,
        pageErrors,
        externalRequests,
        sourceDigests: before.filter((item) => !item.path.includes("/dist/")),
        buildFileCount: build.length,
        buildManifestSha256: hash(JSON.stringify(build)),
        browser: browser.receipt,
        limitations: [
          "Scripted model proves UI, persistence and continuation behavior, not live-model quality or user-study completion time.",
          "Question drafts survive mounted thread switches; browser refresh persistence and the general intervention outbox remain G06-A work.",
          "No Workflow approval, browser confirmation, unified recovery area or full G06 acceptance claim.",
        ],
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    `Verified ${observations.length} observations; evidence: ${output}`,
  );
} finally {
  await browser?.close();
  await fixture?.close();
  await removeWebUiE2eRoot(root);
}
