// Run with: node --import tsx scripts/check-workspace-html-preview.mjs
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

import { startWorkspaceHtmlPreviewFixture } from "../apps/server/test/workspace-html-preview-browser-fixture.ts";

const root = await realpath(
  await mkdtemp(path.join(tmpdir(), "napier-html-browser-")),
);
let browser;
let server;
try {
  await mkdir(path.join(root, "site/assets"), { recursive: true });
  await writeFile(
    path.join(root, "site/index.html"),
    `<!doctype html><html><head>
    <link rel="stylesheet" href="assets/style.css"></head><body>
    <section id="one">First slide<img src="assets/paper.svg"></section>
    <section id="two" hidden>Second slide</section><button>Next slide</button>
    <script type="module" src="assets/main.js"></script></body></html>`,
  );
  await writeFile(
    path.join(root, "site/assets/style.css"),
    "section{width:90vw;max-width:900px;color:rgb(32,64,128)}[hidden]{display:none}",
  );
  await writeFile(
    path.join(root, "site/assets/main.js"),
    'import { advance } from "./advance.js"; document.querySelector("button").onclick=advance; document.body.dataset.ready="true";',
  );
  await writeFile(
    path.join(root, "site/assets/advance.js"),
    'export function advance(){document.querySelector("#one").hidden=true;document.querySelector("#two").hidden=false;}',
  );
  await writeFile(
    path.join(root, "site/assets/paper.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>',
  );
  server = await startWorkspaceHtmlPreviewFixture(root);
  const origin = server.origin;
  const response = await fetch(
    `${origin}/api/workspace/file?path=site/index.html`,
  );
  const previewUrl = `${origin}${response.headers.get("X-Napier-Workspace-Preview-Url")}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1200, height: 800 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.locator("iframe").evaluate((element, url) => {
    element.src = url;
  }, previewUrl);
  const frame = page.frameLocator("iframe");
  await frame.locator('body[data-ready="true"]').waitFor();
  assert.equal(await frame.locator("section:visible").count(), 1);
  assert.equal(
    await frame
      .locator("#one")
      .evaluate((element) => getComputedStyle(element).color),
    "rgb(32, 64, 128)",
  );
  assert.equal(
    await frame
      .locator("img")
      .evaluate((element) => element.complete && element.naturalWidth > 0),
    true,
  );
  await frame.getByRole("button", { name: "Next slide" }).click();
  assert.equal(
    await frame.locator("section:visible").textContent(),
    "Second slide",
  );
  await page.locator("iframe").evaluate((element) => {
    element.style.width = "360px";
  });
  assert.ok((await frame.locator("#two").boundingBox()).width <= 360);
  assert.equal(
    await frame.locator("body").evaluate(() => {
      try {
        return Boolean(parent.document);
      } catch {
        return false;
      }
    }),
    false,
  );
  assert.equal(
    await frame.locator("body").evaluate(async (url) => {
      try {
        await fetch(url);
        return true;
      } catch {
        return false;
      }
    }, `${origin}/api/private`),
    false,
  );
  assert.equal(server.forbiddenRequests(), 0);
  const standalone = await browser.newPage();
  await standalone.goto(previewUrl);
  await standalone.locator('body[data-ready="true"]').waitFor();
  await standalone.getByRole("button", { name: "Next slide" }).click();
  assert.equal(
    await standalone.locator("section:visible").textContent(),
    "Second slide",
  );
  assert.deepEqual(errors, []);
  console.log(
    "HTML browser regression passed: relative CSS/images/modules, embedded and standalone navigation, resize, opaque origin, and blocked application API access.",
  );
} finally {
  await browser?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
