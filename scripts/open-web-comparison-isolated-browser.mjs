import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { sha256 } from "../packages/runtime/dist/index.js";
import { assertOpenWebComparisonBrowserRuntimeCurrent } from "./open-web-comparison-browser-runtime.mjs";

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const LSOF = "/usr/sbin/lsof";
const START_TIMEOUT_MS = 20_000;
const CLOSE_GRACE_MS = 1_000;
const execFileAsync = promisify(execFile);

export async function startOpenWebComparisonIsolatedBrowser(input) {
  const trialRoot = await realpath(input.trialRoot);
  const browserRoot = path.join(trialRoot, "browser");
  const profileRoot = path.join(browserRoot, "profile");
  const runtimeRoot = path.join(browserRoot, "runtime");
  await mkdir(profileRoot, { recursive: true, mode: 0o700 });
  await mkdir(runtimeRoot, { recursive: false, mode: 0o700 });
  const runtime = input.runtime;
  if (
    !runtime ||
    !path.isAbsolute(runtime.executablePath) ||
    !path.isAbsolute(runtime.root)
  ) {
    throw new Error("Comparison Browser runtime is unavailable");
  }
  const comparisonRoot = path.dirname(runtime.root);
  assertWithin(comparisonRoot, trialRoot);
  assertWithin(comparisonRoot, runtime.root);
  await assertOpenWebComparisonBrowserRuntimeCurrent(runtime);
  const proxy = new URL(input.proxyServer);
  if (
    proxy.protocol !== "http:" ||
    proxy.hostname !== "127.0.0.1" ||
    !validPort(proxy.port) ||
    proxy.username ||
    proxy.password
  ) {
    throw new Error(
      "Comparison Browser proxy must be unauthenticated loopback",
    );
  }
  const profile = buildOpenWebComparisonBrowserSandboxProfile({
    trialRoot,
    browserRoot,
    comparisonRoot,
    browserRuntimeRoot: runtime.root,
    executablePath: runtime.executablePath,
    proxyPort: Number(proxy.port),
  });
  const profilePath = path.join(runtimeRoot, "browser-comparison.sb");
  await writeFile(profilePath, `${profile}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  const port = await reserveLoopbackPort();
  const startedAt = performance.now();
  const child = spawn(
    SANDBOX_EXEC,
    [
      "-f",
      profilePath,
      "--",
      runtime.executablePath,
      ...browserArguments(profileRoot, runtimeRoot, input.proxyServer, port),
    ],
    {
      cwd: trialRoot,
      env: browserEnvironment(runtimeRoot),
      detached: true,
      shell: false,
      stdio: "ignore",
    },
  );
  let closed = false;
  try {
    const cdp = await waitForCdp(child, port);
    await verifyLoopbackListener(child.pid, port);
    await assertOpenWebComparisonBrowserRuntimeCurrent(runtime);
    const receipt = {
      status: "ready",
      diagnostic: "fresh_profile_loopback_cdp",
      profilePersistent: false,
      userStateImported: false,
      loopbackOnly: true,
      processClosed: false,
      launchDurationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      browserExecutableSha256: runtime.executableSha256,
      browserRuntimeSetSha256: runtime.runtimeSetSha256,
      sandboxProfileSha256: sha256(profile),
      cdpEndpointSha256: sha256(cdp.url),
    };
    return {
      cdpUrl: cdp.url,
      port: cdp.port,
      receipt,
      async close() {
        if (closed) return;
        closed = true;
        await terminateProcessGroup(child);
        await assertOpenWebComparisonBrowserRuntimeCurrent(runtime);
        await assertBrowserProfileCurrent(profilePath, profile);
        receipt.processClosed = true;
      },
    };
  } catch (error) {
    await terminateProcessGroup(child).catch(() => undefined);
    throw error;
  }
}

export function buildOpenWebComparisonBrowserSandboxProfile(input) {
  assertWithin(input.comparisonRoot, input.trialRoot);
  assertWithin(input.comparisonRoot, input.browserRuntimeRoot);
  assertWithin(input.trialRoot, input.browserRoot);
  assertWithin(input.browserRuntimeRoot, input.executablePath);
  if (!validPort(String(input.proxyPort))) {
    throw new Error("Comparison Browser proxy port is invalid");
  }
  const userHome = path.resolve(homedir());
  return [
    "(version 1)",
    "(allow default)",
    `(deny file-read-data (subpath ${literal(userHome)}))`,
    `(deny file-read-data (subpath ${literal("/Volumes")}))`,
    `(deny file-read-data (require-all (subpath ${literal(input.comparisonRoot)}) (require-not (require-any (subpath ${literal(input.browserRoot)}) (subpath ${literal(input.browserRuntimeRoot)})))))`,
    `(deny file-read-data (require-all (subpath ${literal(input.trialRoot)}) (require-not (subpath ${literal(input.browserRoot)}))))`,
    `(deny file-write* (require-not (require-any (subpath ${literal(input.browserRoot)}) (subpath ${literal(privateVarAlias(input.browserRoot))}))))`,
    `(deny process-exec (require-not (literal ${literal(input.executablePath)})))`,
    `(deny network-outbound (require-not (remote ip "localhost:${String(input.proxyPort)}")))`,
    `(deny network-bind (require-not (local ip "localhost:*")))`,
    `(deny network-inbound (require-not (local ip "localhost:*")))`,
  ].join("\n");
}

function browserArguments(profileRoot, runtimeRoot, proxyServer, port) {
  return [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-gpu",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${String(port)}`,
    `--user-data-dir=${profileRoot}`,
    `--proxy-server=${proxyServer}`,
    "--proxy-bypass-list=<-loopback>",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-breakpad",
    "--disable-crashpad",
    "--disable-crash-reporter",
    `--crash-dumps-dir=${path.join(runtimeRoot, "crash")}`,
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-quic",
    "--disable-sync",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ];
}

async function waitForCdp(child, port) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error("Comparison Browser exited before CDP was ready");
    }
    const url = `http://127.0.0.1:${String(port)}`;
    const response = await fetch(`${url}/json/version`, {
      signal: AbortSignal.timeout(1_000),
    }).catch(() => undefined);
    if (response?.ok) {
      const version = await response.json();
      const websocket = new URL(String(version.webSocketDebuggerUrl));
      if (
        websocket.protocol !== "ws:" ||
        websocket.hostname !== "127.0.0.1" ||
        Number(websocket.port) !== port
      ) {
        throw new Error("Comparison Browser CDP endpoint is not loopback-only");
      }
      return { url, port };
    }
    await sleep(100);
  }
  throw new Error("Comparison Browser CDP startup timed out");
}

async function verifyLoopbackListener(pid, port) {
  const { stdout } = await execFileAsync(
    LSOF,
    ["-nP", "-a", "-p", String(pid), `-iTCP:${String(port)}`, "-sTCP:LISTEN"],
    {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    },
  );
  const listeners = stdout
    .split(/\r?\n/u)
    .filter((line) => line.includes("(LISTEN)"));
  if (
    listeners.length !== 1 ||
    !listeners[0].includes(`127.0.0.1:${String(port)}`) ||
    listeners[0].includes(`*:${String(port)}`)
  ) {
    throw new Error("Comparison Browser CDP listener is not loopback-only");
  }
}

async function assertBrowserProfileCurrent(profilePath, expected) {
  const [info, observed] = await Promise.all([
    lstat(profilePath),
    readFile(profilePath, "utf8"),
  ]);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (info.mode & 0o777) !== 0o600 ||
    observed !== `${expected}\n`
  ) {
    throw new Error("Comparison Browser sandbox profile changed");
  }
}

async function terminateProcessGroup(child) {
  if (child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(CLOSE_GRACE_MS).then(() => false),
  ]);
  if (exited !== false || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(CLOSE_GRACE_MS),
  ]);
  if (child.exitCode === null) {
    throw new Error("Comparison Browser process group did not close");
  }
}

function browserEnvironment(runtimeRoot) {
  return {
    HOME: runtimeRoot,
    TMPDIR: runtimeRoot,
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LANG: process.env.LANG ?? "en_US.UTF-8",
    LC_ALL: process.env.LC_ALL ?? "en_US.UTF-8",
  };
}

function validPort(value) {
  return (
    typeof value === "string" &&
    /^[0-9]+$/u.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) >= 1 &&
    Number(value) <= 65_535
  );
}

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        address && typeof address !== "string" ? address.port : undefined;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("Comparison Browser port is invalid"));
        else resolve(port);
      });
    });
  });
}

function assertWithin(root, candidate, mustBeWithin = true) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  const within =
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative));
  if (within !== mustBeWithin) {
    throw new Error("Comparison Browser path boundary is invalid");
  }
}

function literal(value) {
  return JSON.stringify(path.resolve(value));
}

function privateVarAlias(value) {
  const resolved = path.resolve(value);
  return resolved.startsWith("/private/var/")
    ? resolved.slice("/private".length)
    : resolved;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
