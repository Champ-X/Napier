import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { LocalStore } from "../packages/runtime/dist/store.js";
import { seedWebUiNarrativeFixture } from "./web-ui-e2e-fixture.mjs";
import {
  createWebUiE2eRoot,
  removeWebUiE2eRoot,
  startProductionWebServer,
  startWebUiBrowser,
  productionEntryReceipt,
} from "./web-ui-e2e-runtime.mjs";

const candidateOnly = process.argv[3] === "candidate";
const output = path.resolve(process.argv[2] ?? "/tmp/napier-task-outcome-ui");
await mkdir(output, { recursive: true });
const root = await createWebUiE2eRoot();
let server, browser;
const receipt = {
  evidenceKind: "deterministic_integration",
  modelRequests: 0,
  scenario: candidateOnly ? "no_plan_candidate" : "formal_artifact",
  viewports: [],
};
try {
  receipt.build = await productionEntryReceipt();
  const target = candidateOnly
    ? await seedCandidate(root)
    : {
        ...(await seedWebUiNarrativeFixture(root)).artifactNavigation,
        expectedPath: "artifacts/interactive-report.html",
      };
  server = await startProductionWebServer(root);
  browser = await startWebUiBrowser(root);
  const context = browser.browser.contexts()[0];
  await context.addInitScript(
    () => window.top === window && localStorage.setItem("napier.locale", "en"),
  );
  for (const width of [1440, 320]) {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.setDefaultTimeout(15_000);
    await page.setViewportSize({ width, height: 900 });
    const previews = [];
    page.on("response", (response) => {
      if (
        /\/artifacts\/[^/]+\/preview(?:-file)?$/u.test(
          new URL(response.url()).pathname,
        ) ||
        (candidateOnly &&
          new URL(response.url()).pathname === "/api/workspace/file")
      )
        previews.push({
          status: response.status(),
          path: new URL(response.url()).pathname,
        });
    });
    await page.goto(`${server.origin}/?thread=${target.threadId}`);
    await page.locator(".task-narrative.phase-ended").waitFor();
    assert.equal(
      await page.locator(".task-narrative.objective-accepted").count(),
      0,
    );
    await page.locator(".composer textarea").fill("Existing draft");
    let clicks = 0;
    const outputButton = page
      .locator(".workspace-evidence-output-list button")
      .first();
    if (!(await outputButton.isVisible())) {
      await page
        .locator('button[aria-controls="workspace-evidence-rail"]')
        .click();
      clicks += 1;
    }
    await outputButton.waitFor();
    const selectedPath = await outputButton.getAttribute("title");
    assert.equal(selectedPath, target.expectedPath);
    await page.screenshot({
      path: path.join(output, `task-${width}.png`),
      fullPage: true,
    });
    await outputButton.click();
    clicks += 1;
    try {
      await page
        .locator(
          ".artifact-inspector iframe, .artifact-inspector .artifact-source-preview, .artifact-inspector .message-markdown",
        )
        .first()
        .waitFor();
    } catch (error) {
      await page.screenshot({
        path: path.join(output, `failure-${width}.png`),
        fullPage: true,
      });
      console.error(await page.locator(".artifact-inspector").textContent());
      throw error;
    }
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".artifact-inspector-meta")
          ?.textContent?.includes("Refreshing"),
    );
    const frame = page.frameLocator(".artifact-inspector iframe");
    await frame
      .getByRole("heading", { name: "Interactive output report", exact: true })
      .waitFor();
    await frame
      .getByRole("button", { name: "Advance preview", exact: true })
      .evaluate((button) => button.click());
    assert.equal(await frame.locator("#stage").textContent(), "Step 2");
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".artifact-inspector-meta")
          ?.textContent?.includes("Refreshing"),
    );
    const geometry = await page.evaluate(() => ({
      overflowPx: Math.max(
        0,
        document.documentElement.scrollWidth - innerWidth,
      ),
      status: document.querySelector(".task-narrative-current")?.textContent,
      inspector: document.querySelector(".artifact-inspector-meta")
        ?.textContent,
      accepted: Boolean(
        document.querySelector(".task-narrative.objective-accepted"),
      ),
    }));
    assert.equal(geometry.overflowPx, 0);
    assert.equal(geometry.accepted, false);
    assert.ok(clicks <= 2);
    assert.ok(
      previews.some((entry) => entry.status === 200),
      candidateOnly
        ? "Candidate preview must load the checked workspace file"
        : "Formal artifacts must use the bound integrity endpoint",
    );
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: path.join(output, `preview-${width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Continue editing", exact: true })
      .click();
    await page.locator(".composer textarea").waitFor();
    const draft = await page.locator(".composer textarea").inputValue();
    assert.ok(draft.startsWith("Existing draft\n\n"));
    assert.ok(draft.includes(target.expectedPath));
    await page.waitForFunction(
      () =>
        document.activeElement === document.querySelector(".composer textarea"),
    );
    assert.equal(await page.locator(".artifact-inspector").count(), 0);
    receipt.viewports.push({
      programmaticHtmlInteraction: "Step 2",
      continueEditingDraft: true,
      width,
      clicks,
      selectedPath,
      ...geometry,
      previews,
      pageErrors: errors,
    });
    await page.close();
  }
  receipt.status = "passed";
} finally {
  await browser?.close();
  await server?.close();
  await removeWebUiE2eRoot(root);
}
await writeFile(
  path.join(output, "receipt.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
);
console.log(JSON.stringify(receipt, null, 2));

async function seedCandidate(root) {
  const store = new LocalStore({
    workspaceRoot: path.join(root, "workspace"),
    dataRoot: path.join(root, "state"),
  });
  await store.initialize();
  try {
    const agent = store.listAgents()[0];
    const thread = await store.createThread({
      title: "No-plan output after a plan-tool failure",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const expectedPath = "candidate-report.html";
    await writeFile(
      path.join(root, "workspace", expectedPath),
      `<html><body><h1>Interactive output report</h1><p id="stage">Step 1</p><button onclick="document.querySelector('#stage').textContent='Step 2'">Advance preview</button></body></html>`,
    );
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "message.user",
      category: "message",
      visibility: "user",
      payload: { role: "user", text: "Prepare the output." },
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "tool.failed",
      category: "tool",
      visibility: "user",
      payload: {
        toolName: "update_plan",
        callId: "missing-plan",
        error: "Plan not found",
      },
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "message.assistant",
      category: "message",
      visibility: "user",
      payload: { role: "assistant", text: `Open [report](${expectedPath}).` },
    });
    await store.finishRun(run.id, "completed");
    assert.equal(store.listPlans(thread.id).length, 0);
    return { threadId: thread.id, expectedPath };
  } finally {
    store.close();
  }
}
