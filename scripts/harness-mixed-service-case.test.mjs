import { test, expect } from "vitest";
import { mkdtemp, cp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const source = path.resolve("benchmarks/harness-optimization/mixed-service-v1");
test("mixed-service grader requires both fixes and agrees with public tests and TypeScript", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-mixed-service-"));
  const run = (command, args, cwd = root) => spawnSync(command, args, {cwd, encoding:"utf8", timeout:15000});
  const ok = result => expect(result.status, result.stderr + result.stdout).toBe(0);
  try {
    await cp(path.join(source, "fixture"), root, {recursive:true});
    await cp(path.join(source, "outcome.mjs"), path.join(root, "outcome.mjs"));
    expect(run(process.execPath, ["outcome.mjs"]).status).not.toBe(0);
    expect(run(process.execPath, ["--test", "frontend/booking.test.mjs"]).status).not.toBe(0);
    expect(run("/usr/bin/python3", ["-B", "-m", "unittest", "discover", "-s", "backend"]).status).not.toBe(0);
    await cp(path.join(source, "reference/frontend/booking.ts"), path.join(root, "frontend/booking.ts"));
    expect(run(process.execPath, ["outcome.mjs"]).status).not.toBe(0);
    await cp(path.join(source, "reference/backend/quote.py"), path.join(root, "backend/quote.py"));
    ok(run(process.execPath, ["outcome.mjs"]));
    ok(run(process.execPath, ["--test", "frontend/booking.test.mjs"]));
    ok(run("/usr/bin/python3", ["-B", "-m", "unittest", "discover", "-s", "backend"]));
    ok(run(process.execPath, [path.resolve("node_modules/typescript/bin/tsc"), "-p", "frontend/tsconfig.json"]));
    await cp(path.join(source, "fixture/frontend/booking.ts"), path.join(root, "frontend/booking.ts"));
    expect(run(process.execPath, ["outcome.mjs"]).status).not.toBe(0);
  } finally { await rm(root, {recursive:true, force:true}); }
});
