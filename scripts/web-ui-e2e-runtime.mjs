import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright-core";

export const WEB_UI_START_TIMEOUT_MS = 300_000;
const CLOSE_TIMEOUT_MS = 30_000;
const MAX_SERVER_OUTPUT_BYTES = 128 * 1024;
const SERVER_ENTRY = path.resolve("apps/server/dist/index.js");
const WEB_INDEX = path.resolve("apps/web/dist/index.html");

export async function createWebUiE2eRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-web-ui-e2e-"));
  await Promise.all(
    ["state", "workspace", "tmp", "browser-profile"].map((name) =>
      mkdir(path.join(root, name), { mode: 0o700 }),
    ),
  );
  return root;
}

export async function productionEntryReceipt() {
  await Promise.all([access(SERVER_ENTRY), access(WEB_INDEX)]);
  return {
    serverBuilt: true,
    webBuilt: true,
    serverSha256: await sha256File(SERVER_ENTRY),
    webIndexSha256: await sha256File(WEB_INDEX),
  };
}

export async function startProductionWebServer(root, port = 0) {
  const startedAt = performance.now();
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: process.cwd(),
    env: {
      LANG: "C",
      NAPIER_HOME: path.join(root, "state"),
      NAPIER_E2E_MODEL_KEY: "e2e-placeholder-key",
      NAPIER_PORT: String(port),
      NAPIER_WORKSPACE: path.join(root, "workspace"),
      NODE_ENV: "test",
      NO_PROXY: "127.0.0.1,localhost",
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      TMPDIR: path.join(root, "tmp"),
      TZ: "UTC",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const observed = observeServer(child);
  try {
    const origin = await withTimeout(
      observed.origin,
      WEB_UI_START_TIMEOUT_MS,
      "Production Web server startup timed out",
    );
    const health = await fetch(`${origin}/api/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(health.ok, true, "Production Web health check failed");
    return {
      origin,
      receipt: {
        loopbackOnly: new URL(origin).hostname === "127.0.0.1",
        ephemeralPort: Number(new URL(origin).port) > 0,
        healthReady: true,
        startupDurationMs: Math.round(performance.now() - startedAt),
      },
      async close() {
        await terminate(child, observed.exit);
        observed.assertOutputBounded();
      },
    };
  } catch (error) {
    await terminate(child, observed.exit).catch(() => undefined);
    throw error;
  }
}

export async function startWebUiBrowser(root) {
  const startedAt = performance.now();
  const executablePath = await realpath(chromium.executablePath());
  const executable = await lstat(executablePath);
  assert.equal(executable.isFile(), true);
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--disable-background-networking",
      "--disable-breakpad",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-gpu",
      "--disable-sync",
      "--no-default-browser-check",
      "--no-first-run",
    ],
    env: {
      HOME: root,
      LANG: "C",
      NO_PROXY: "127.0.0.1,localhost",
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      TMPDIR: path.join(root, "tmp"),
      TZ: "UTC",
    },
  });
  try {
    await browser.newContext();
    return {
      browser,
      receipt: {
        transport: "playwright-launch",
        freshProfile: true,
        profilePersistent: false,
        osIsolationClaimed: false,
        executableSha256: await sha256File(executablePath),
        startupDurationMs: Math.round(performance.now() - startedAt),
      },
      async close() {
        await browser.close();
      },
    };
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
}

export async function removeWebUiE2eRoot(root) {
  const [canonicalRoot, canonicalTmp, info] = await Promise.all([
    realpath(root),
    realpath(tmpdir()),
    lstat(root),
  ]);
  assert.equal(info.isSymbolicLink(), false);
  assert.equal(path.dirname(canonicalRoot), canonicalTmp);
  assert.equal(
    path.basename(canonicalRoot).startsWith("napier-web-ui-e2e-"),
    true,
  );
  await rm(root, { recursive: true, force: true });
  await assert.rejects(access(root));
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function observeServer(child) {
  let output = "";
  let outputBytes = 0;
  let settleOrigin;
  let rejectOrigin;
  const origin = new Promise((resolve, reject) => {
    settleOrigin = resolve;
    rejectOrigin = reject;
  });
  const exit = childExit(child);
  const consume = (chunk) => {
    outputBytes += chunk.byteLength;
    if (outputBytes > MAX_SERVER_OUTPUT_BYTES) {
      rejectOrigin(
        new Error("Production Web server output exceeded its bound"),
      );
      return;
    }
    output += chunk.toString("utf8");
    const match = output.match(
      /Napier is listening on (http:\/\/127\.0\.0\.1:[1-9][0-9]*)/u,
    );
    if (match) settleOrigin(match[1]);
  };
  child.stdout.on("data", consume);
  child.stderr.on("data", consume);
  child.once("error", rejectOrigin);
  void exit.then(({ code, signal }) => {
    if (!output.includes("Napier is listening on")) {
      rejectOrigin(
        new Error(
          `Production Web server exited before readiness (${String(code)}/${String(signal)})`,
        ),
      );
    }
  });
  return {
    origin,
    exit,
    assertOutputBounded() {
      assert.equal(outputBytes <= MAX_SERVER_OUTPUT_BYTES, true);
    },
  };
}

async function terminate(child, exitPromise = childExit(child)) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  signalProcess(child, "SIGTERM");
  try {
    await withTimeout(exitPromise, CLOSE_TIMEOUT_MS, "Process close timed out");
  } catch {
    signalProcess(child, "SIGKILL");
    await withTimeout(exitPromise, CLOSE_TIMEOUT_MS, "Process kill timed out");
  }
}

function signalProcess(child, signal) {
  if (child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct child when it does not own a process group.
    }
  }
  child.kill(signal);
}

function childExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function sha256File(filePath) {
  return sha256(await readFile(filePath));
}

async function withTimeout(promise, timeoutMs, message) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
