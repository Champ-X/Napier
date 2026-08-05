import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { StreamFrame } from "@napier/contracts";
import { hashEventStream } from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { parseCliArgs, runCli } from "../src/cli.js";
import {
  CaptureWritable,
  cliIo,
  collect,
  createInterruptedFixture,
  createInterruptedResearchFixture,
  parseFrames,
  providerDependencies,
} from "./cli-resume-fixture.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Napier CLI interrupted Run resume", () => {
  it("parses the explicit resume contract and rejects run-only options", () => {
    expect(
      parseCliArgs([
        "resume",
        "--workspace",
        ".",
        "--data-root",
        ".napier",
        "--thread",
        "thread_resume_fixture",
        "--run",
        "run_resume_fixture",
        "--model",
        "deepseek/deepseek-v4-flash",
        "--timeout-ms",
        "5000",
        "--jsonl",
      ]),
    ).toEqual({
      kind: "resume",
      options: {
        workspace: ".",
        dataRoot: ".napier",
        threadId: "thread_resume_fixture",
        runId: "run_resume_fixture",
        model: { provider: "deepseek", id: "deepseek-v4-flash" },
        timeoutMs: 5_000,
        jsonl: true,
      },
    });
    expect(parseCliArgs(["resume", "--help"])).toEqual({ kind: "help" });
    expect(() =>
      parseCliArgs([
        "resume",
        "--workspace",
        ".",
        "--thread",
        "thread_resume_fixture",
        "--prompt",
        "Do not accept a new prompt.",
      ]),
    ).toThrow("Unknown option");
    expect(() =>
      parseCliArgs(["resume", "--workspace", ".", "--thread", "x"]),
    ).toThrow("--thread is invalid");
  });

  it("resumes a specified interrupted Run through ordered JSONL", async () => {
    const fixture = await createInterruptedFixture(temporaryRoots);
    const provider = fauxProvider({ provider: "faux-cli-resume" });
    provider.setResponses([
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("<run-recovery>");
        expect(messages).toContain("Resume the interrupted task");
        expect(messages).toContain("has an unknown outcome");
        return fauxAssistantMessage("CLI_RESUME_RESULT");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();

    const code = await runCli(
      [
        "resume",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--thread",
        fixture.threadId,
        "--run",
        fixture.runId,
        "--model",
        "faux-cli-resume/faux-1",
        "--jsonl",
      ],
      cliIo(fixture, stdout, stderr),
      providerDependencies(provider),
    );

    expect(code, stderr.text() || stdout.text()).toBe(0);
    expect(stderr.text()).toBe("");
    const frames = parseFrames(stdout.text());
    const snapshot = frames.at(-2);
    const done = frames.at(-1);
    expect(snapshot?.type).toBe("snapshot");
    expect(done?.type).toBe("done");
    if (snapshot?.type !== "snapshot" || done?.type !== "done") return;
    const child = snapshot.detail.runs.find((run) => run.id === done.runId);
    expect(child).toEqual(
      expect.objectContaining({
        status: "completed",
        parentRunId: fixture.runId,
        source: "recovery",
      }),
    );
    expect(
      snapshot.detail.runs.find((run) => run.id === fixture.runId)?.status,
    ).toBe("interrupted");
    const streamed = frames.filter(
      (frame): frame is Extract<StreamFrame, { type: "event" }> =>
        frame.type === "event",
    );
    expect(streamed.length).toBeGreaterThan(3);
    expect(streamed.every((frame) => frame.event.runId === done.runId)).toBe(
      true,
    );
    expect(streamed.map((frame) => frame.event.seq)).toEqual(
      Array.from(
        { length: streamed.length },
        (_, index) => streamed[0]!.event.seq + index,
      ),
    );
    expect(done).toEqual(
      expect.objectContaining({
        threadId: fixture.threadId,
        status: "completed",
        eventCount: snapshot.detail.thread.eventCount,
        eventStreamSha256: hashEventStream(snapshot.detail.events),
      }),
    );
    expect(
      snapshot.detail.events.filter((event) => event.type === "message.user"),
    ).toHaveLength(1);
    expect(
      snapshot.detail.events
        .filter((event) => event.runId === done.runId)
        .map((event) => event.type),
    ).toEqual(
      expect.arrayContaining([
        "run.recovery.started",
        "run.recovery.prompt",
        "run.recovery.completed",
      ]),
    );
  });

  it("restores private Research Sources through a fresh CLI resume", async () => {
    const fixture = await createInterruptedResearchFixture(temporaryRoots);
    const provider = fauxProvider({ provider: "faux-cli-research-resume" });
    provider.setResponses([
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("<run-recovery>");
        expect(messages).toContain(
          "A private local Source capsule is available",
        );
        expect(messages).toContain("Call research_source list");
        expect(messages).not.toContain(fixture.sourceSecret);
        return fauxAssistantMessage(
          fauxToolCall("research_source", { action: "list" }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain(fixture.sourceId);
        expect(messages).toContain(fixture.citationId);
        expect(messages).not.toContain(fixture.sourceSecret);
        return fauxAssistantMessage(
          fauxToolCall("research_source", {
            action: "cite",
            sourceId: fixture.sourceId,
            sourceContentSha256: fixture.sourceContentSha256,
            startLine: 1,
            endLine: 1,
            claim: "The fresh CLI process recovered private Source evidence.",
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          fixture.sourceSecret,
        );
        return fauxAssistantMessage("CLI_RESEARCH_RESUME_RESULT");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();

    const code = await runCli(
      [
        "resume",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--thread",
        fixture.threadId,
        "--run",
        fixture.runId,
        "--model",
        "faux-cli-research-resume/faux-1",
        "--jsonl",
      ],
      cliIo(fixture, stdout, stderr),
      providerDependencies(provider),
    );

    expect(code, stderr.text() || stdout.text()).toBe(0);
    expect(stderr.text()).toBe("");
    expect(stdout.text()).not.toContain(fixture.sourceSecret);
    const frames = parseFrames(stdout.text());
    const snapshot = frames.findLast((frame) => frame.type === "snapshot");
    const done = frames.at(-1);
    expect(snapshot?.type).toBe("snapshot");
    expect(done?.type).toBe("done");
    if (snapshot?.type !== "snapshot" || done?.type !== "done") return;
    const researchEvents = snapshot.detail.events.filter(
      (event) =>
        event.runId === done.runId &&
        event.type === "tool.completed" &&
        event.payload["toolName"] === "research_source",
    );
    expect(
      researchEvents.map(
        (event) =>
          (event.payload["details"] as Record<string, unknown>)["action"],
      ),
    ).toEqual(["list", "cite"]);
    expect(JSON.stringify(snapshot.detail.events)).not.toContain(
      fixture.sourceSecret,
    );
    expect(
      (researchEvents.at(-1)!.payload["details"] as Record<string, unknown>)[
        "stateCapsule"
      ],
    ).toEqual(
      expect.objectContaining({
        sourceRunId: done.runId,
        sourceCount: 1,
        citationCount: 2,
        storage: "local_only",
      }),
    );
  });

  it("prints the resumed assistant result in human mode", async () => {
    const fixture = await createInterruptedFixture(temporaryRoots);
    const provider = fauxProvider({ provider: "faux-cli-resume-human" });
    provider.setResponses([
      fauxAssistantMessage("CLI_RESUME_HUMAN_RESULT"),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const stdout = new CaptureWritable();
    const stderr = new CaptureWritable();

    expect(
      await runCli(
        [
          "resume",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--thread",
          fixture.threadId,
          "--run",
          fixture.runId,
          "--model",
          "faux-cli-resume-human/faux-1",
        ],
        cliIo(fixture, stdout, stderr),
        providerDependencies(provider),
      ),
    ).toBe(0);

    expect(stdout.text()).toBe("CLI_RESUME_HUMAN_RESULT\n");
    expect(stderr.text()).toMatch(
      new RegExp(
        `^Napier run run_[a-z0-9]+ completed \\(thread ${fixture.threadId}\\)\\n$`,
        "u",
      ),
    );
  });

  it("fails closed for a non-waiting Thread or wrong interrupted Run", async () => {
    const fixture = await createInterruptedFixture(temporaryRoots);
    const provider = fauxProvider({ provider: "faux-cli-resume-invalid" });
    provider.setResponses([
      fauxAssistantMessage("MUST_NOT_RUN"),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const dependencies = providerDependencies(provider);
    const first = new CaptureWritable();

    const wrongRunCode = await runCli(
      [
        "resume",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--thread",
        fixture.threadId,
        "--run",
        "run_missing_resume_target",
        "--model",
        "faux-cli-resume-invalid/faux-1",
        "--jsonl",
      ],
      cliIo(fixture, first, new CaptureWritable()),
      dependencies,
    );

    expect(wrongRunCode).toBe(1);
    expect(parseFrames(first.text())).toEqual([
      expect.objectContaining({
        type: "error",
        threadId: fixture.threadId,
      }),
    ]);
    expect(provider.state.callCount).toBe(0);

    const resumed = new CaptureWritable();
    expect(
      await runCli(
        [
          "resume",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--thread",
          fixture.threadId,
          "--model",
          "faux-cli-resume-invalid/faux-1",
          "--jsonl",
        ],
        cliIo(fixture, resumed, new CaptureWritable()),
        dependencies,
      ),
    ).toBe(0);
    const afterCompletion = new CaptureWritable();
    expect(
      await runCli(
        [
          "resume",
          "--workspace",
          fixture.workspaceRoot,
          "--data-root",
          fixture.dataRoot,
          "--thread",
          fixture.threadId,
          "--model",
          "faux-cli-resume-invalid/faux-1",
          "--jsonl",
        ],
        cliIo(fixture, afterCompletion, new CaptureWritable()),
        dependencies,
      ),
    ).toBe(1);
    expect(parseFrames(afterCompletion.text())).toEqual([
      expect.objectContaining({ type: "error" }),
    ]);
  });

  it("runs the built CLI as a real resume subprocess", async () => {
    const fixture = await createInterruptedFixture(temporaryRoots);
    const cliPath = path.resolve(import.meta.dirname, "../dist/index.js");
    const child = spawn(
      process.execPath,
      [
        cliPath,
        "resume",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--thread",
        fixture.threadId,
        "--run",
        fixture.runId,
        "--jsonl",
      ],
      {
        cwd: fixture.root,
        env: {},
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const [exit, stdout, stderr] = await Promise.all([
      new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
      }),
      collect(child.stdout),
      collect(child.stderr),
    ]);

    expect(exit).toBe(0);
    expect(stderr).toBe("");
    const frames = parseFrames(stdout);
    expect(frames.at(-1)).toEqual(
      expect.objectContaining({
        type: "done",
        threadId: fixture.threadId,
        status: "completed",
      }),
    );
    const snapshot = frames.at(-2);
    expect(snapshot?.type).toBe("snapshot");
    if (snapshot?.type !== "snapshot") return;
    const childRun = snapshot.detail.runs.find(
      (run) => run.parentRunId === fixture.runId,
    );
    expect(childRun).toEqual(
      expect.objectContaining({
        status: "completed",
        source: "recovery",
      }),
    );
  }, 15_000);
});
