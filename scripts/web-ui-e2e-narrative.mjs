import assert from "node:assert/strict";

import {
  startProductionWebServer,
  WEB_UI_START_TIMEOUT_MS,
} from "./web-ui-e2e-runtime.mjs";

export async function readWebUiNarrative(page, expected) {
  await page.locator(".task-narrative-current strong").waitFor({
    state: "visible",
    timeout: WEB_UI_START_TIMEOUT_MS,
  });
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
      artifactPath: text(".task-narrative-completed small").replace(
        /^Outputs · /u,
        "",
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

export async function warmWebUiLoopback(browser, origin) {
  const context = browserContext(browser);
  const startedAt = performance.now();
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const page = await context.newPage();
    try {
      const response = await page.goto(`${origin}/api/health`, {
        waitUntil: "commit",
        timeout: 15_000,
      });
      assert.equal(response?.ok(), true);
      return {
        attempts: attempt,
        durationMs: Math.round(performance.now() - startedAt),
      };
    } catch (error) {
      lastError = error;
    } finally {
      await page.close().catch(() => undefined);
    }
  }
  throw lastError;
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
    { width: 1_600, height: 900 },
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
    return {
      disconnected,
      samePort: restarted.origin === origin,
      narrativePreserved: true,
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

export async function verifyWebUiRecoveryNarrative(browser, origin, expected) {
  const page = await openWebUiPage(
    browserContext(browser),
    `${origin}/?thread=${encodeURIComponent(expected.threadId)}`,
    { width: 1_600, height: 900 },
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

async function readRecoveryNarrative(page, expected) {
  const narrative = await readWebUiNarrative(page, {
    ...expected,
    artifactPath: "",
  });
  const {
    metrics: _metrics,
    artifactPath: _artifactPath,
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
