import { rm } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseCliArgs, runCli } from "../src/cli.js";
import {
  branchDependencies,
  CaptureWritable,
  cliIo,
  createBranchFixture,
  parseFrames,
  runChild,
  threadCount,
} from "./cli-branch-fixture.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Napier CLI sequence-accurate branch", () => {
  it("parses branch-only options and rejects execution options", () => {
    expect(
      parseCliArgs([
        "branch",
        "--workspace",
        ".",
        "--data-root",
        ".napier",
        "--thread",
        "thread_branch_source",
        "--from-seq",
        "42",
        "--title",
        "  Experiment   branch ",
        "--jsonl",
      ]),
    ).toEqual({
      kind: "branch",
      options: {
        workspace: ".",
        dataRoot: ".napier",
        threadId: "thread_branch_source",
        fromSeq: 42,
        title: "Experiment branch",
        jsonl: true,
      },
    });
    expect(parseCliArgs(["branch", "--help"])).toEqual({ kind: "help" });
    expect(() =>
      parseCliArgs([
        "branch",
        "--workspace",
        ".",
        "--thread",
        "thread_branch_source",
        "--from-seq",
        "1",
        "--model",
        "deepseek/deepseek-v4-flash",
      ]),
    ).toThrow("Unknown option");
    expect(() =>
      parseCliArgs([
        "branch",
        "--workspace",
        ".",
        "--thread",
        "thread_branch_source",
        "--from-seq",
        "0",
      ]),
    ).toThrow("--from-seq must be a positive integer");
  });

  it("streams a branch bound to the Run visible at sourceSeq", async () => {
    const fixture = await createBranchFixture(temporaryRoots);
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();

    expect(
      await runCli(
        [
          "branch",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--thread",
          fixture.threadId,
          "--from-seq",
          "2",
          "--title",
          "CLI branch",
          "--jsonl",
        ],
        cliIo(fixture, stdout, stderr),
        branchDependencies(),
      ),
    ).toBe(0);

    expect(stderr.text()).toBe("");
    const frames = parseFrames(stdout.text());
    const snapshot = frames.at(-2);
    const done = frames.at(-1);
    expect(snapshot?.type).toBe("snapshot");
    expect(done?.type).toBe("done");
    if (snapshot?.type !== "snapshot" || done?.type !== "done") return;
    expect(snapshot.detail.thread.title).toBe("CLI branch");
    expect(snapshot.detail.runs.find((run) => run.id === done.runId)).toEqual(
      expect.objectContaining({
        status: "completed",
        parentRunId: fixture.firstRunId,
        branchFromSeq: 2,
      }),
    );
    expect(done.status).toBe("completed");
    expect(snapshot.detail.events.map((event) => event.type)).toEqual([
      "branch.created",
      "message.user",
      "message.assistant",
    ]);
    expect(
      frames
        .filter((frame) => frame.type === "event")
        .map((frame) => frame.event.seq),
    ).toEqual([1, 2, 3]);
    expect(stdout.text()).not.toContain("Second request");
    expect(stdout.text()).not.toContain("Second answer");
  });

  it("rejects a future sequence or pre-aborted request without a branch", async () => {
    const fixture = await createBranchFixture(temporaryRoots);
    const future = new CaptureWritable();
    expect(
      await runCli(
        [
          "branch",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--thread",
          fixture.threadId,
          "--from-seq",
          "5",
          "--jsonl",
        ],
        cliIo(fixture, future, new CaptureWritable()),
        branchDependencies(),
      ),
    ).toBe(1);
    expect(parseFrames(future.text())).toEqual([
      expect.objectContaining({
        type: "error",
        threadId: fixture.threadId,
      }),
    ]);
    expect(await threadCount(fixture)).toBe(fixture.initialThreadCount);

    const controller = new AbortController();
    controller.abort();
    const aborted = new CaptureWritable();
    expect(
      await runCli(
        [
          "branch",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--thread",
          fixture.threadId,
          "--from-seq",
          "2",
          "--jsonl",
        ],
        cliIo(fixture, aborted, new CaptureWritable()),
        branchDependencies(),
        controller.signal,
      ),
    ).toBe(1);
    expect(parseFrames(aborted.text())).toEqual([
      expect.objectContaining({ type: "error" }),
    ]);
    expect(await threadCount(fixture)).toBe(fixture.initialThreadCount);
  });

  it("creates a branch in human mode and continues it with the built CLI", async () => {
    const fixture = await createBranchFixture(temporaryRoots);
    const cliPath = path.resolve(import.meta.dirname, "../dist/index.js");
    const branch = await runChild(
      [
        cliPath,
        "branch",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--thread",
        fixture.threadId,
        "--from-seq",
        "2",
        "--title",
        "Built CLI branch",
      ],
      fixture.root,
    );

    expect(branch.code).toBe(0);
    const branchThreadId = branch.stdout.trim();
    expect(branchThreadId).toMatch(/^thread_[a-z0-9]+$/u);
    expect(branch.stderr).toContain(
      `Napier branch ${branchThreadId} from ${fixture.threadId}#2`,
    );

    const continuation = await runChild(
      [
        cliPath,
        "run",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--thread",
        branchThreadId,
        "--prompt",
        "Continue this branch from its copied evidence.",
        "--jsonl",
      ],
      fixture.root,
    );
    expect(continuation.code).toBe(0);
    expect(continuation.stderr).toBe("");
    const frames = parseFrames(continuation.stdout);
    const snapshot = frames.at(-2);
    expect(snapshot?.type).toBe("snapshot");
    if (snapshot?.type !== "snapshot") return;
    expect(snapshot.detail.thread.id).toBe(branchThreadId);
    expect(snapshot.detail.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "branch.created",
        "message.user",
        "message.assistant",
      ]),
    );
  }, 15_000);
});
