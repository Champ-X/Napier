import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { RunEvent, SubagentTask } from "@napier/contracts";

const execute = promisify(execFile);
const repository = fileURLToPath(new URL("../../../", import.meta.url));
export const LEGACY_PRODUCER_COMMIT = "8f2a26cbe074b8a543da825e6df96ab398656dc0";
export interface NativeLegacyFixture {
  root: string; workspaceRoot: string; dataRoot: string; threadId: string; parentRunId: string; childRunId: string;
  taskId: string; candidateId: string; expiresAt: string; capsulePath: string; capsuleSha256: string;
  task: SubagentTask; events: RunEvent[]; modelCalls: number;
}

/** Real historical source, isolated dependencies and contracts; never checkout or build the working tree. */
export async function createLegacyFixtureProducer() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-old-source-"));
  const archive = path.join(root, "source.tar"), checkout = path.join(root, "checkout");
  const fixtures: string[] = [];
  await mkdir(checkout);
  await execute("git", ["archive", "--format=tar", `--output=${archive}`, LEGACY_PRODUCER_COMMIT,
    "package.json", "tsconfig.base.json", "packages/runtime/src", "packages/contracts",
    "packages/runtime/test/subagent-worktree-delivery-fixture.ts"], { cwd: repository });
  await execute("tar", ["-xf", archive, "-C", checkout]);
  const modules = path.join(checkout, "node_modules"); await mkdir(modules);
  for (const name of await readdir(path.join(repository, "node_modules"))) {
    if (name !== "@napier") await symlink(path.join(repository, "node_modules", name), path.join(modules, name), "dir");
  }
  await mkdir(path.join(modules, "@napier"));
  await symlink(path.join(checkout, "packages/contracts"), path.join(modules, "@napier/contracts"), "dir");
  await execute(process.execPath, [path.join(repository, "node_modules/typescript/lib/tsc.js"), "-p", "packages/contracts/tsconfig.json"],
    { cwd: checkout, maxBuffer: 4 * 1024 * 1024 });
  const producer = "packages/runtime/test/subagent-legacy-fixture-producer.ts";
  await copyFile(fileURLToPath(new URL("./subagent-legacy-fixture-producer.ts", import.meta.url)), path.join(checkout, producer));
  await writeFile(path.join(root, "origin.json"), JSON.stringify({ commit: LEGACY_PRODUCER_COMMIT, checkout }));
  return {
    async create(mode = "outcome"): Promise<NativeLegacyFixture> {
      const fixture = await mkdtemp(path.join(tmpdir(), "napier-native-legacy-test-")); fixtures.push(fixture);
      await execute(process.execPath, ["--import", "tsx", producer, fixture, mode], { cwd: checkout, maxBuffer: 2 * 1024 * 1024 });
      return JSON.parse(await readFile(path.join(fixture, "fixture.json"), "utf8")) as NativeLegacyFixture;
    },
    async cleanup() { await Promise.all([...fixtures, root].map((entry) => rm(entry, { recursive: true, force: true }))); },
  };
}
