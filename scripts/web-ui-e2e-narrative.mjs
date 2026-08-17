import assert from "node:assert/strict";

import {
  startProductionWebServer,
  WEB_UI_START_TIMEOUT_MS,
} from "./web-ui-e2e-runtime.mjs";

export async function readWebUiNarrative(page, expected) {
  await page.waitForFunction(
    (target) => {
      const text = (selector) =>
        document.querySelector(selector)?.textContent?.trim() ?? "";
      return (
        text(".thread-heading h1") === target.title &&
        text(".task-narrative-current > span") === target.phase &&
        text(".task-narrative-current strong") === target.currentAction &&
        text(".task-narrative-completed p") === target.completedItem &&
        text(".task-narrative-blocker p") === target.blocker &&
        text(".task-narrative-next p") === target.nextStep &&
        text(".task-narrative-completed button").replace(/^Outputs · /u, "") ===
          target.artifactPath
      );
    },
    expected,
    {
      timeout: WEB_UI_START_TIMEOUT_MS,
    },
  );
  const narrative = await page.evaluate(() => {
    const text = (selector) =>
      document.querySelector(selector)?.textContent?.trim() ?? "";
    return {
      title: text(".thread-heading h1"),
      phase: text(".task-narrative-current > span"),
      currentAction: text(".task-narrative-current strong"),
      metrics: text(".task-narrative-current small"),
      completedItem: text(".task-narrative-completed p"),
      blocker: text(".task-narrative-blocker p"),
      nextStep: text(".task-narrative-next p"),
      artifactPath: text(".task-narrative-completed button").replace(
        /^Outputs · /u,
        "",
      ),
      artifactControlVisible: Boolean(
        document.querySelector(".task-narrative-completed button"),
      ),
    };
  });
  for (const key of [
    "title",
    "phase",
    "currentAction",
    "completedItem",
    "blocker",
    "nextStep",
    "artifactPath",
  ]) {
    assert.equal(narrative[key], expected[key]);
  }
  return narrative;
}

export async function openWebUiPage(context, url, viewport, setup = () => {}) {
  let firstError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const page = await context.newPage();
    try {
      setup(page);
      await page.setViewportSize(viewport);
      await page.goto(url, { waitUntil: "commit", timeout: 30_000 });
      return page;
    } catch (error) {
      firstError ??= error;
      await page.close().catch(() => undefined);
    }
  }
  throw firstError;
}

export async function refreshPreservesWebUiNarrative(
  page,
  origin,
  expected,
  before,
) {
  await page.reload({
    waitUntil: "commit",
    timeout: WEB_UI_START_TIMEOUT_MS,
  });
  const after = await readWebUiNarrative(page, expected);
  assert.deepEqual(after, before);
  assert.equal(new URL(page.url()).origin, origin);
  assert.equal(
    new URL(page.url()).searchParams.get("thread"),
    expected.threadId,
  );
  return true;
}

export async function verifyWebUiServerRestart(
  browser,
  runtime,
  root,
  expected,
) {
  const origin = runtime.origin;
  const port = Number(new URL(origin).port);
  const page = await openWebUiPage(
    browserContext(browser),
    `${origin}/?thread=${encodeURIComponent(expected.threadId)}`,
    { width: 1_440, height: 900 },
  );
  let restarted;
  try {
    const before = await readWebUiNarrative(page, expected);
    await runtime.close();
    const disconnected = await page.evaluate(async () => {
      try {
        await fetch("/api/health", { cache: "no-store" });
        return false;
      } catch {
        return true;
      }
    });
    restarted = await startProductionWebServer(root, port);
    assert.equal(restarted.origin, origin);
    await page.reload({
      waitUntil: "commit",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    assert.deepEqual(await readWebUiNarrative(page, expected), before);
    const browserTaskHistoryPreserved =
      await readRestoredBrowserTaskHistory(page);
    return {
      disconnected,
      samePort: restarted.origin === origin,
      narrativePreserved: true,
      browserTaskHistoryPreserved,
      restartStartupDurationMs: restarted.receipt.startupDurationMs,
      runtime: restarted,
    };
  } catch (error) {
    await restarted?.close().catch(() => undefined);
    throw error;
  } finally {
    await page.close();
  }
}

async function readRestoredBrowserTaskHistory(page) {
  await page.locator("#workspace-view-session").click();
  await page.locator("#session-section-browser").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".browser-task-actions [role=status]")
        ?.textContent?.includes("restored history · terminal") === true,
    undefined,
    { timeout: WEB_UI_START_TIMEOUT_MS },
  );
  return page.evaluate(
    () =>
      document
        .querySelector(".browser-task-terminal")
        ?.textContent?.includes("stopped when the Napier server restarted") ===
      true,
  );
}

export async function verifyWebUiRecoveryNarrative(browser, origin, expected) {
  const page = await openWebUiPage(
    browserContext(browser),
    `${origin}/?thread=${encodeURIComponent(expected.threadId)}`,
    { width: 1_440, height: 900 },
  );
  try {
    await page.waitForFunction(
      (phase) =>
        document
          .querySelector(".task-narrative-current > span")
          ?.textContent?.trim() === phase,
      expected.phase,
      { timeout: WEB_UI_START_TIMEOUT_MS },
    );
    const before = await readRecoveryNarrative(page, expected);
    await page.reload({
      waitUntil: "commit",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    const after = await readRecoveryNarrative(page, expected);
    assert.deepEqual(after, before);
    return {
      ...after,
      selectedThreadPreserved:
        new URL(page.url()).searchParams.get("thread") === expected.threadId,
      refreshPreserved: true,
    };
  } finally {
    await page.close();
  }
}

export async function verifyWebUiLongRunNarrative(browser, origin, expected) {
  const page = await openWebUiPage(
    browserContext(browser),
    `${origin}/?thread=${encodeURIComponent(expected.threadId)}`,
    { width: 1_440, height: 900 },
  );
  try {
    const before = await readWebUiNarrative(page, expected);
    await page.reload({
      waitUntil: "commit",
      timeout: WEB_UI_START_TIMEOUT_MS,
    });
    const after = await readWebUiNarrative(page, expected);
    assert.deepEqual(after, before);
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".conversation-activity-group").length === 3,
      undefined,
      { timeout: WEB_UI_START_TIMEOUT_MS },
    );
    const collapsed = await page.evaluate(() => ({
      summaries: [
        ...document.querySelectorAll(
          ".conversation-activity-group > summary strong",
        ),
      ].map((item) => item.textContent?.trim() ?? ""),
      mountedChildren: document.querySelectorAll(
        ".conversation-activity-group-items > details",
      ).length,
    }));
    await page
      .locator(".conversation-activity-group > summary")
      .first()
      .click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          ".conversation-activity-group-items > details",
        ).length === 12,
      undefined,
      { timeout: WEB_UI_START_TIMEOUT_MS },
    );
    return {
      ...after,
      refreshPreserved: true,
      activityAggregation: {
        summaries: collapsed.summaries,
        collapsedMountedChildren: collapsed.mountedChildren,
        expandedMountedChildren: await page
          .locator(".conversation-activity-group-items > details")
          .count(),
      },
    };
  } finally {
    await page.close();
  }
}

export async function verifyWebUiArtifactNavigation(browser, origin, expected) {
  const page = await openWebUiPage(
    browserContext(browser),
    `${origin}/?thread=${encodeURIComponent(expected.threadId)}`,
    { width: 1_440, height: 900 },
  );
  try {
    await page.waitForFunction(
      ({ title, count }) =>
        document.querySelector(".thread-heading h1")?.textContent?.trim() ===
          title &&
        document.querySelectorAll(".task-narrative-completed nav button")
          .length === count,
      { title: expected.title, count: expected.paths.length },
      { timeout: WEB_UI_START_TIMEOUT_MS },
    );
    const previews = [];
    for (const path of expected.paths) {
      await page
        .locator(`.task-narrative-completed button[title="Open ${path}"]`)
        .click();
      await page.waitForFunction(
        (targetPath) =>
          document.activeElement instanceof HTMLElement &&
          document.activeElement.dataset["artifactPath"] === targetPath,
        path,
        { timeout: WEB_UI_START_TIMEOUT_MS },
      );
      const card = page.locator(
        `.conversation-artifact[data-artifact-path="${path}"]`,
      );
      await card.getByRole("button", { name: "Preview" }).click();
      await card.locator(".conversation-artifact-preview").waitFor({
        state: "visible",
        timeout: WEB_UI_START_TIMEOUT_MS,
      });
      previews.push({
        path,
        focused: true,
        preview: await card
          .locator(".conversation-artifact-preview pre")
          .textContent(),
      });
      await card.getByRole("button", { name: `Close preview ${path}` }).click();
    }
    return { outputCount: expected.paths.length, previews };
  } finally {
    await page.close();
  }
}

async function readRecoveryNarrative(page, expected) {
  const narrative = await readWebUiNarrative(page, {
    ...expected,
    artifactPath: "",
  });
  const {
    metrics: _metrics,
    artifactPath: _artifactPath,
    artifactControlVisible: _artifactControlVisible,
    ...visible
  } = narrative;
  assert.deepEqual(visible, {
    title: expected.title,
    phase: expected.phase,
    currentAction: expected.currentAction,
    completedItem: expected.completedItem,
    blocker: expected.blocker,
    nextStep: expected.nextStep,
  });
  return visible;
}

function browserContext(browser) {
  const context = browser.contexts()[0];
  assert.ok(context, "Web UI E2E Browser context is unavailable");
  return context;
}
