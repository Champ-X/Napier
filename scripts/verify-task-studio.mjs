import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { seedWebUiNarrativeFixture } from "./web-ui-e2e-fixture.mjs";
import {
  createWebUiE2eRoot,
  removeWebUiE2eRoot,
  startProductionWebServer,
  startWebUiBrowser,
} from "./web-ui-e2e-runtime.mjs";

// Real production UI and API, isolated ledger fixtures; no online model calls.
const output = path.resolve("benchmark-results/frontend-task-studio");
await mkdir(output, { recursive: true });
const root = await createWebUiE2eRoot();
let server;
let browserRuntime;
const receipt = { status: "running", checks: [], screenshots: [], errors: [] };
const check = (name) => {
  receipt.checks.push(name);
  console.log(`PASS ${name}`);
};
try {
  const fixture = await seedWebUiNarrativeFixture(root);
  server = await startProductionWebServer(root);
  browserRuntime = await startWebUiBrowser(root);
  const context = await browserRuntime.browser.newContext({
    locale: "zh-CN",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => receipt.errors.push(error.message));
  const url = `${server.origin}/?thread=${fixture.empty.threadId}`;
  const screenshot = async (name) => {
    await page.screenshot({ path: path.join(output, `${name}.png`) });
    receipt.screenshots.push(`${name}.png`);
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.locator(".welcome-panel").waitFor();
  await page.keyboard.press("Tab");
  assert.equal(
    await page
      .locator(".workspace-skip-link")
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await page.keyboard.press("Enter");
  assert.equal(
    await page
      .locator("#main-workspace")
      .evaluate((e) => e === document.activeElement),
    true,
  );
  check("Keyboard skip link reaches the workbench");
  const railToggle = page.locator("#workspace-rail-toggle");
  if ((await railToggle.getAttribute("aria-pressed")) === "true")
    await railToggle.click();
  await screenshot("welcome-desktop");
  await page.locator('[data-starter-key="inspect"]').click();
  const composer = page.locator(".composer textarea");
  assert.match(await composer.inputValue(), /检查当前工作区/);
  assert.equal(
    await composer.evaluate((e) => e === document.activeElement),
    true,
  );
  await composer.dispatchEvent("keydown", {
    key: "Enter",
    ctrlKey: true,
    isComposing: true,
  });
  assert.match(await composer.inputValue(), /检查当前工作区/);
  check(
    "Starter fills and focuses the composer; IME confirmation preserves the draft",
  );
  await composer.fill("");
  await page.locator("#workspace-view-task").click();
  await page.getByRole("button", { name: "回到对话，描述目标" }).click();
  await page.locator(".welcome-panel").waitFor();
  check("Empty task offers a working route back to conversation");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.locator(".context-workbench").waitFor();
  await page.waitForFunction(
    () => document.querySelector("#main-workspace")?.inert,
  );
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(
        () => !!document.activeElement.closest(".workspace-settings-surface"),
      ),
      true,
    );
  }
  await screenshot("settings-desktop");
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => document.activeElement?.textContent?.trim() === "设置",
  );
  assert.equal(
    await page.locator("#main-workspace").evaluate((e) => e.inert),
    false,
  );
  check("Settings isolate background focus and restore their opener");
  for (const width of [1920, 1280, 960, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator(".welcome-starter").last().scrollIntoViewIfNeeded();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    const last = await page.locator(".welcome-starter").last().boundingBox();
    assert.ok(
      last &&
        last.x >= 0 &&
        last.x + last.width <= width &&
        last.y + last.height <= 901,
      JSON.stringify({ width, last }),
    );
    await page.locator(".welcome-panel").scrollIntoViewIfNeeded();
    if (width === 390 || width === 320) await screenshot(`welcome-${width}`);
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.locator(".context-workbench").waitFor();
    const content = await page.locator(".settings-content").boundingBox();
    assert.ok(content && content.width >= Math.min(width - 48, 250));
    assert.equal(
      await page
        .locator(".settings-content")
        .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      true,
    );
    await page.locator("#settings-section-language").click();
    await page.locator(".language-panel").waitFor();
    if (width === 390 || width === 320) await screenshot(`settings-${width}`);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.locator("#settings-section-context").click();
    await page.keyboard.press("Escape");
    check(`Welcome, settings content, and navigation reflow at ${width}px`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const view of ["task", "subagents", "trajectory"]) {
    await page.locator(`#workspace-view-${view}`).click();
    await page.locator(`#workspace-panel-${view}`).waitFor();
    await screenshot(view);
  }
  await page.getByRole("button", { name: "开发者工作台", exact: true }).click();
  await page.locator(".developer-workbench-surface").waitFor();
  await page.waitForFunction(
    () => document.querySelector("#main-workspace")?.inert,
  );
  await screenshot("developer-desktop");
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => document.activeElement?.textContent?.trim() === "开发者工作台",
  );
  check("Developer workbench also restores keyboard focus");
  await page.goto(`${server.origin}/?thread=${fixture.threadId}`);
  await page.locator(".message-ledger").waitFor();
  await screenshot("conversation-evidence");
  check("Recorded conversation and evidence render with the shared theme");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.locator("#settings-section-language").click();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await page.goto(url);
  await page.locator(".welcome-panel").waitFor();
  assert.match(
    await page.locator(".welcome-identity").innerText(),
    /Your task workspace/,
  );
  await screenshot("welcome-english");
  check("Language switching applies to new welcome and shortcut copy");
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await screenshot("forced-colors");
  assert.equal(
    await page
      .locator(".welcome-starter")
      .first()
      .evaluate((e) => getComputedStyle(e).borderTopStyle),
    "solid",
  );
  check("Forced colors retain control boundaries; reduced motion supported");
  const failure = await context.newPage();
  await failure.route("**/api/bootstrap", (route) => route.abort());
  await failure.goto(server.origin);
  await failure.locator(".fatal-retry-button").waitFor();
  await failure.unroute("**/api/bootstrap");
  await failure.locator(".fatal-retry-button").click();
  await failure.locator(".app-shell").waitFor();
  check("Connection failure retry recovers the real workspace");
  assert.deepEqual(receipt.errors, []);
  receipt.status = "passed";
} catch (error) {
  receipt.status = "failed";
  receipt.failure = String(error.stack ?? error);
  process.exitCode = 1;
  console.error(error);
} finally {
  await browserRuntime?.close();
  await server?.close();
  await removeWebUiE2eRoot(root);
  await writeFile(
    path.join(output, "verification.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
}
