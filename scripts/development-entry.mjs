import { spawn } from "node:child_process";
import { readFileSync, watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const concurrentlyPath = path.join(
  repoRoot,
  "node_modules/concurrently/dist/bin/concurrently.js",
);
const developmentArgs = [
  "-n",
  "contracts,runtime,server,web",
  "-c",
  "magenta,green,yellow,cyan",
  "--kill-others-on-fail",
  ...["contracts", "runtime", "server", "web"].map(
    (workspace) => `npm run dev -w @napier/${workspace}`,
  ),
];

// Keep this supervisor outside the .env environment. Each fresh child loads
// the file itself, so removed or changed values cannot survive in its parent.
export function watchDevelopmentEnvironment({
  cwd = repoRoot,
  entry = concurrentlyPath,
  args = developmentArgs,
  env = process.env,
  stdio = "inherit",
  log = (message) => process.stdout.write(`${message}\n`),
} = {}) {
  const inheritedEnv = { ...env };
  const envPath = path.join(cwd, ".env");
  let loadedEnvironment;
  let child;
  let timer;
  let restarting = false;
  let stopping = false;
  let resolveFinished;
  const finished = new Promise((resolve) => {
    resolveFinished = resolve;
  });

  function readEnvironment() {
    try {
      return readFileSync(envPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return undefined;
      throw error;
    }
  }

  function finish(code) {
    stopping = true;
    clearTimeout(timer);
    watcher.close();
    resolveFinished(code);
  }

  function start() {
    loadedEnvironment = readEnvironment();
    child = spawn(
      process.execPath,
      ["--env-file-if-exists=.env", entry, ...args],
      { cwd, env: inheritedEnv, stdio },
    );
    child.once("error", () => finish(1));
    child.once("close", (code) => {
      child = undefined;
      if (stopping) finish(0);
      else if (restarting) {
        restarting = false;
        start();
      } else finish(code ?? 1);
    });
  }

  // Watch the directory to detect creation, deletion, and atomic editor saves.
  const watcher = watch(cwd, (_event, filename) => {
    if (filename && filename.toString() !== ".env") return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (stopping || restarting || readEnvironment() === loadedEnvironment)
        return;
      restarting = true;
      log(
        "[dev] .env changed; restarting services with the updated environment…",
      );
      // Concurrently forwards SIGINT to all workspace process trees and waits
      // for them to exit before we start the next generation on the same ports.
      child?.kill("SIGINT");
    }, 250);
  });
  start();

  return {
    finished,
    async stop() {
      stopping = true;
      restarting = false;
      clearTimeout(timer);
      watcher.close();
      if (child) child.kill("SIGINT");
      else finish(0);
      await finished;
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const development = watchDevelopmentEnvironment();
  const stop = () => {
    void development.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.exitCode = await development.finished;
}
