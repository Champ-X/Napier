import { execFile as execFileWithCallback } from "node:child_process";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import rootPackage from "../package.json" with { type: "json" };
import { watchDevelopmentEnvironment } from "./development-entry.mjs";

const execFile = promisify(execFileWithCallback);
const roots = [];
const watchers = [];
const concurrentlyPath = path.resolve(
  "node_modules/concurrently/dist/bin/concurrently.js",
);

afterEach(async () => {
  await Promise.all(watchers.splice(0).map((watcher) => watcher.stop()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("development entry", () => {
  it("keeps the supervisor outside the environment it reloads", () => {
    expect(rootPackage.scripts.dev).toBe(
      "npm run build:core:development && node scripts/development-entry.mjs",
    );
  });

  it("inherits env-file values in a concurrently child process", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-dev-entry-"));
    roots.push(root);
    const envPath = path.join(root, ".env");
    await writeFile(envPath, "NAPIER_DEV_ENTRY_TEST=visible_to_child\n");
    const { stdout } = await execFile(
      process.execPath,
      [
        `--env-file=${envPath}`,
        concurrentlyPath,
        "--raw",
        "--success",
        "all",
        "node -p process.env.NAPIER_DEV_ENTRY_TEST",
      ],
      { cwd: root },
    );

    expect(stdout.trim()).toBe("visible_to_child");
  });

  it("reloads created, replaced, and removed env files without retaining old values", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-dev-reload-"));
    roots.push(root);
    const entry = path.join(root, "entry.mjs");
    const statePath = path.join(root, "state.json");
    const envPath = path.join(root, ".env");
    const log = vi.fn();
    await writeFile(
      entry,
      `
      import { writeFileSync } from "node:fs";
      writeFileSync("state.json", JSON.stringify({
        pid: process.pid,
        value: process.env.NAPIER_DEV_RELOAD_VALUE ?? null,
        override: process.env.NAPIER_DEV_RELOAD_OVERRIDE,
      }));
      setInterval(() => {}, 1000);
    `,
    );
    const watcher = watchDevelopmentEnvironment({
      cwd: root,
      entry,
      args: [],
      env: { ...process.env, NAPIER_DEV_RELOAD_OVERRIDE: "from-shell" },
      stdio: "ignore",
      log,
    });
    watchers.push(watcher);
    const state = async () => JSON.parse(await readFile(statePath, "utf8"));
    const waitForValue = async (value) => {
      await vi.waitFor(
        async () => {
          expect(await state()).toMatchObject({
            value,
            override: "from-shell",
          });
        },
        { timeout: 5_000, interval: 50 },
      );
      return state();
    };
    const initial = await waitForValue(null);
    await writeFile(
      envPath,
      "NAPIER_DEV_RELOAD_VALUE=fixture-secret-one\nNAPIER_DEV_RELOAD_OVERRIDE=from-file\n",
    );
    const created = await waitForValue("fixture-secret-one");
    expect(created.pid).not.toBe(initial.pid);

    await writeFile(envPath, "NAPIER_DEV_RELOAD_VALUE=fixture-secret-two\n");
    await waitForValue("fixture-secret-two");
    await writeFile(
      path.join(root, ".env.next"),
      "NAPIER_DEV_RELOAD_VALUE=fixture-secret-three\n",
    );
    await rename(path.join(root, ".env.next"), envPath);
    await waitForValue("fixture-secret-three");

    await rm(envPath);
    const removed = await waitForValue(null);
    expect(removed.pid).not.toBe(created.pid);
    expect(JSON.stringify(log.mock.calls)).not.toContain("fixture-secret");
    await watcher.stop();
    expect(() => process.kill(removed.pid, 0)).toThrow();
  });
});
