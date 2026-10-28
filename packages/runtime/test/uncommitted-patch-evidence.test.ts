import { inspectUncommittedWorkspacePatch } from "../src/workspace-patch-pending-inspection.js";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { LocalStore } from "../src/store.js";
import {
  uncommittedPatchCandidates,
} from "../src/workspace-patch-uncommitted-evidence.js";
import { patchCommitStartedPayload } from "../src/workspace-patch-preparation.js";

const roots: string[] = [];
const stores: LocalStore[] = [];
afterEach(async () => {
  stores.splice(0).forEach((store) => store.close());
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it.each(
  ["create", "replace"].flatMap((operation) =>
    ["before-effect", "after-prepared"].map((checkpoint) => ({
      operation,
      checkpoint,
    })),
  ),
)(
  "proves target commit was not entered at $checkpoint for $operation",
  async ({ operation, checkpoint }) => {
    const fixture = await crashed(checkpoint, operation);
    const inspected = await inspectUncommittedWorkspacePatch(fixture);
    expect(inspected.proof.checkpoint).toBe(
      checkpoint === "before-effect" ? "before_effect" : "before_commit",
    );
    expect(inspected.args.operation).toBe(operation);
    if (operation === "create") {
      expect(inspected.args).toMatchObject({
        content: "written once\n",
        expectedSha256: null,
      });
      await expect(stat(fixture.target)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } else expect(await readFile(fixture.target, "utf8")).toBe("before\n");
    const privateFiles = await readdir(
      path.join(fixture.dataRoot, "workspace-patch-invocations"),
    );
    expect(privateFiles).toHaveLength(1);
    expect(
      (
        await stat(
          path.join(
            fixture.dataRoot,
            "workspace-patch-invocations",
            privateFiles[0]!,
          ),
        )
      ).mode & 0o777,
    ).toBe(0o600);
    const receipt = fixture.events.find(
      (event) => event.type === "workspace.patch.invocation",
    )!;
    expect(JSON.stringify(receipt)).not.toContain("retained.txt");
    expect(JSON.stringify(receipt)).not.toContain("written once");
    expect(
      fixture.events.filter((event) => event.type === "tool.completed"),
    ).toHaveLength(0);
  },
  30000,
);

it.each(["create", "replace"])(
  "keeps %s indeterminate after the commit gate even if its target is unchanged",
  async (operation) => {
    const fixture = await crashed("after-commit-marker", operation);
    expect(uncommittedPatchCandidates(fixture.events)).toEqual([]);
    await expect(inspectUncommittedWorkspacePatch(fixture)).rejects.toThrow(
      "no proof",
    );
    if (operation === "create")
      await expect(stat(fixture.target)).rejects.toMatchObject({
        code: "ENOENT",
      });
    else expect(await readFile(fixture.target, "utf8")).toBe("before\n");
  },
  30000,
);

it("does not mistake an externally deleted committed file for an unexecuted operation", async () => {
  const root = await crashProcess("after-file", "create");
  const target = path.join(root, "workspace/retained.txt");
  expect(await readFile(target, "utf8")).toBe("written once\n");
  await unlink(target);
  const fixture = await open(root);
  expect(uncommittedPatchCandidates(fixture.events)).toEqual([]);
  await expect(inspectUncommittedWorkspacePatch(fixture)).rejects.toThrow(
    "no proof",
  );
}, 30000);

it.each(["before-effect", "after-prepared"])(
  "rejects target drift after %s",
  async (checkpoint) => {
    const fixture = await crashed(checkpoint, "replace");
    await writeFile(fixture.target, "changed externally\n");
    await expect(inspectUncommittedWorkspacePatch(fixture)).rejects.toThrow(
      "precondition changed",
    );
    expect(await readFile(fixture.target, "utf8")).toBe("changed externally\n");
  },
  30000,
);

it("fences the original writer before its commit gate", async () => {
  const fixture = await crashed("after-prepared", "create");
  const prepared = fixture.events.find(
    (event) => event.type === "workspace.patch.prepared",
  )!;
  await expect(
    fixture.store.appendEventOnceAtRunHead(
      {
        threadId: fixture.run.threadId,
        runId: fixture.run.id,
        type: "workspace.patch.commit_started",
        category: "tool",
        visibility: "debug",
        payload: patchCommitStartedPayload(prepared),
      },
      {
        namespace: "workspace-patch-commit",
        key: `${fixture.run.id}:${fixture.callId}`,
        expectedRunHeadSeq: fixture.events.at(-1)!.seq,
      },
    ),
  ).rejects.toThrow();
  await expect(stat(fixture.target)).rejects.toMatchObject({ code: "ENOENT" });
}, 30000);

it("does not commit a target when the commit marker cannot be saved", async () => {
  const fixture = await crashed("commit-marker-failure", "create");
  await expect(stat(fixture.target)).rejects.toMatchObject({ code: "ENOENT" });
  expect(
    fixture.events.filter((event) => event.type === "tool.failed"),
  ).toHaveLength(1);
  expect(uncommittedPatchCandidates(fixture.events)).toEqual([]);
}, 30000);

it("rejects missing exact input even when the journal proves no target commit", async () => {
  const fixture = await crashed("before-effect", "create");
  const files = await readdir(
    path.join(fixture.dataRoot, "workspace-patch-invocations"),
  );
  await unlink(
    path.join(fixture.dataRoot, "workspace-patch-invocations", files[0]!),
  );
  await expect(inspectUncommittedWorkspacePatch(fixture)).rejects.toThrow();
}, 30000);

async function crashed(checkpoint: string, operation: string) {
  return open(await crashProcess(checkpoint, operation));
}
async function crashProcess(checkpoint: string, operation: string) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-uncommitted-patch-"));
  roots.push(root);
  await expect(
    promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(
          new URL("./fixtures/patch-recovery-crash.ts", import.meta.url),
        ),
        root,
        checkpoint,
        operation,
      ],
      { timeout: 20000 },
    ),
  ).rejects.toMatchObject({ code: 73 });
  return root;
}
async function open(root: string) {
  const workspaceRoot = path.join(root, "workspace"),
    dataRoot = path.join(root, "data");
  const store = new LocalStore({ workspaceRoot, dataRoot });
  stores.push(store);
  await store.initialize(true);
  const thread = store
    .listThreads()
    .find((thread) => thread.title === "Retain settled patch")!;
  const run = store.listRuns(thread.id)[0]!;
  const events = await store.listRunEvents(run.id);
  const callId = String(
    events.find((event) => event.type === "tool.started")!.payload["callId"],
  );
  return {
    root,
    store,
    workspaceRoot,
    dataRoot,
    run,
    events,
    callId,
    target: path.join(workspaceRoot, "retained.txt"),
  };
}
