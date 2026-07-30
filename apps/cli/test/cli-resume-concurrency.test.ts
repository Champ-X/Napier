import { rm } from "node:fs/promises";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
  createLocalAgentRuntime,
  UnsupportedSandboxAdapter,
  type LocalAgentRuntimeOptions,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  runCli,
  type RunCliDependencies,
} from "../src/cli.js";
import {
  CaptureWritable,
  cliIo,
  createInterruptedFixture,
  deferred,
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

describe("Napier CLI resume cancellation and concurrency", () => {
  it("settles an externally cancelled recovery as a linked child", async () => {
    const fixture = await createInterruptedFixture(temporaryRoots);
    const provider = fauxProvider({ provider: "faux-cli-resume-cancel" });
    const entered = deferred<void>();
    const release = deferred<void>();
    provider.setResponses([
      async () => {
        entered.resolve();
        await release.promise;
        return fauxAssistantMessage("CANCELLED_RESUME_MUST_NOT_COMPLETE");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const controller = new AbortController();
    const stdout = new CaptureWritable();
    const execution = runCli(
      [
        "resume",
        "--workspace",
        fixture.workspaceRoot,
        "--data-root",
        fixture.dataRoot,
        "--thread",
        fixture.threadId,
        "--model",
        "faux-cli-resume-cancel/faux-1",
        "--jsonl",
      ],
      cliIo(fixture, stdout, new CaptureWritable()),
      providerDependencies(provider),
      controller.signal,
    );
    await entered.promise;
    controller.abort();
    release.resolve();

    expect(await execution).toBe(1);
    const frames = parseFrames(stdout.text());
    const snapshot = frames.at(-2);
    const done = frames.at(-1);
    expect(done).toEqual(
      expect.objectContaining({
        type: "done",
        status: "cancelled",
        threadId: fixture.threadId,
      }),
    );
    expect(snapshot?.type).toBe("snapshot");
    if (snapshot?.type !== "snapshot" || done?.type !== "done") return;
    expect(
      snapshot.detail.runs.find((run) => run.id === done.runId),
    ).toEqual(
      expect.objectContaining({
        status: "cancelled",
        parentRunId: fixture.runId,
        source: "recovery",
      }),
    );
  });

  it("applies the CLI timeout to the recovery child", async () => {
    const fixture = await createInterruptedFixture(temporaryRoots);
    const provider = fauxProvider({ provider: "faux-cli-resume-timeout" });
    provider.setResponses([
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 1_100));
        return fauxAssistantMessage("TIMED_OUT_RESUME_MUST_NOT_COMPLETE");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const stdout = new CaptureWritable();

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
          "faux-cli-resume-timeout/faux-1",
          "--timeout-ms",
          "1000",
          "--jsonl",
        ],
        cliIo(fixture, stdout, new CaptureWritable()),
        providerDependencies(provider),
      ),
    ).toBe(1);

    const frames = parseFrames(stdout.text());
    const snapshot = frames.at(-2);
    const done = frames.at(-1);
    expect(done).toEqual(
      expect.objectContaining({ type: "done", status: "cancelled" }),
    );
    expect(snapshot?.type).toBe("snapshot");
    if (snapshot?.type !== "snapshot" || done?.type !== "done") return;
    expect(
      snapshot.detail.runs.find((run) => run.id === done.runId),
    ).toEqual(
      expect.objectContaining({
        status: "cancelled",
        parentRunId: fixture.runId,
      }),
    );
    expect(
      snapshot.detail.runs.find((run) => run.id === fixture.runId)?.status,
    ).toBe("interrupted");
  }, 10_000);

  it("admits only one recovery child for a waiting Thread", async () => {
    const fixture = await createInterruptedFixture(temporaryRoots);
    const entered = deferred<void>();
    const release = deferred<void>();
    const providers: ReturnType<typeof fauxProvider>[] = [];
    let bootstraps = 0;
    const dependencies: RunCliDependencies = {
      async createRuntime(options: LocalAgentRuntimeOptions) {
        const provider = fauxProvider({ provider: "faux-cli-resume-race" });
        providers.push(provider);
        if (bootstraps === 0) {
          provider.setResponses([
            async () => {
              entered.resolve();
              await release.promise;
              return fauxAssistantMessage("FIRST_RESUME_COMPLETED");
            },
            fauxAssistantMessage('{"facts":[]}'),
          ]);
        } else {
          provider.setResponses([
            fauxAssistantMessage("SECOND_RESUME_MUST_NOT_EXECUTE"),
            fauxAssistantMessage('{"facts":[]}'),
          ]);
        }
        bootstraps += 1;
        const services = await createLocalAgentRuntime({
          ...options,
          sandbox: new UnsupportedSandboxAdapter("cli-resume-race"),
        });
        services.models.registerProvider(provider.provider);
        return services;
      },
    };
    const args = [
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
      "faux-cli-resume-race/faux-1",
      "--jsonl",
    ];
    const firstStdout = new CaptureWritable();
    const first = runCli(
      args,
      cliIo(fixture, firstStdout, new CaptureWritable()),
      dependencies,
    );
    await entered.promise;
    const secondStdout = new CaptureWritable();
    const secondCode = await runCli(
      args,
      cliIo(fixture, secondStdout, new CaptureWritable()),
      dependencies,
    );
    release.resolve();

    expect(await first).toBe(0);
    expect(secondCode).toBe(1);
    expect(parseFrames(firstStdout.text()).at(-1)).toEqual(
      expect.objectContaining({ type: "done", status: "completed" }),
    );
    expect(parseFrames(secondStdout.text())).toEqual([
      expect.objectContaining({
        type: "error",
        threadId: fixture.threadId,
      }),
    ]);
    expect(providers).toHaveLength(2);
    expect(providers[1]!.state.callCount).toBe(0);
  });
});
