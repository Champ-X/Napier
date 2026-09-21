import { randomBytes } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  type AssistantMessageEvent,
} from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import {
  ModelThinkingTrace,
  MAX_THINKING_TRACE_BYTES,
} from "../src/model-thinking-trace.js";
import {
  ModelThinkingTraceStore,
  recordModelThinkingTrace,
} from "../src/model-thinking-trace-store.js";
import { guardModelThinkingLoop } from "../src/model-thinking-loop-guard.js";
import {
  DEFAULT_MODEL_TURN_DEADLINE_POLICY,
  ModelTurnWatchdogError,
} from "../src/model-turn-deadline.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import type { ModelContextEnvelopeReceipt } from "@napier/contracts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const run = { id: "run_thinkingtrace1", threadId: "thread_thinkingtrace1" };
const envelope = {
  contentSha256: "a".repeat(64),
  turnIndex: 7,
} as ModelContextEnvelopeReceipt;
const evidence = {
  reason: "semantic_stall" as const,
  attempt: 1 as const,
  observedBytes: 100,
  observedThinkingChunks: 4,
  repeatedUnitBytes: 25,
  repeatedUnitSha256: sha256("semantic_progress_timeout"),
};
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-thinking-trace-"));
  roots.push(root);
  return root;
}

it("keeps an immutable complete prefix and hashes all observed UTF-8 deltas", () => {
  const trace = new ModelThinkingTrace();
  const first = "Inspect src/example.ts\n中文🙂";
  trace.observe(first);
  trace.observe("");
  const snapshot = trace.snapshot();
  trace.observe(" next");
  expect(snapshot).toEqual({
    encoding: "utf8_deltas",
    observedBytes: Buffer.byteLength(first),
    observedChunks: 1,
    observedSha256: sha256(first),
    capturedBytes: Buffer.byteLength(first),
    capturedSha256: sha256(first),
    truncated: false,
    text: first,
  });
  expect(trace.snapshot().text).toBe(`${first} next`);
  expect(trace.snapshot().observedSha256).toBe(sha256(`${first} next`));
});

it.each([1, 2, 3])(
  "bounds retained bytes without splitting a Unicode codepoint at offset %s",
  (offset) => {
    const trace = new ModelThinkingTrace(),
      prefix = "a".repeat(MAX_THINKING_TRACE_BYTES - offset);
    trace.observe(prefix);
    trace.observe("🙂");
    trace.observe("tail".repeat(100000));
    const snapshot = trace.snapshot();
    expect(snapshot.text).toBe(prefix);
    expect(snapshot.capturedBytes).toBe(MAX_THINKING_TRACE_BYTES - offset);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.observedSha256).toBe(
      sha256(prefix + "🙂" + "tail".repeat(100000)),
    );
    expect(snapshot.observedChunks).toBe(3);
  },
);

it("stores private run/input-bound capsules and detects tampered bytes", async () => {
  const root = await fixture(),
    trace = new ModelThinkingTrace();
  trace.observe("PRIVATE_REJECTED_REASONING");
  const receipt = await recordModelThinkingTrace(
    root,
    run,
    envelope,
    evidence,
    trace.snapshot(),
  );
  expect(receipt.status).toBe("stored");
  if (receipt.status !== "stored") throw Error("Missing trace");
  const store = new ModelThinkingTraceStore(root),
    capsule = await store.read(receipt.capsuleSha256);
  expect(capsule).toMatchObject({
    sourceRunId: run.id,
    sourceThreadId: run.threadId,
    turnIndex: 7,
    contextEnvelopeSha256: envelope.contentSha256,
    evidence,
    trace: { text: "PRIVATE_REJECTED_REASONING" },
  });
  expect(JSON.stringify(receipt)).not.toContain("PRIVATE_REJECTED_REASONING");
  const file = path.join(
    root,
    "model-thinking-traces",
    `${receipt.capsuleSha256}.json`,
  );
  if (process.platform !== "win32") {
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(file))).mode & 0o777).toBe(0o700);
  }
  const edited = JSON.parse(await readFile(file, "utf8"));
  edited.trace.text = "tampered";
  await writeFile(file, JSON.stringify(edited));
  await expect(store.read(receipt.capsuleSha256)).rejects.toThrow();
});

it("fails diagnostic capture independently of task recovery and rejects inconsistent traces", async () => {
  const root = await fixture(),
    trace = new ModelThinkingTrace();
  trace.observe("observed");
  await writeFile(path.join(root, "model-thinking-traces"), "not a directory");
  const failed = await recordModelThinkingTrace(
    root,
    run,
    envelope,
    evidence,
    trace.snapshot(),
  );
  expect(failed).toMatchObject({
    status: "unavailable",
    reason: "storage_failed",
  });
  expect(JSON.stringify(failed)).not.toContain(root);
  expect(
    await recordModelThinkingTrace(
      root,
      run,
      undefined,
      evidence,
      trace.snapshot(),
    ),
  ).toEqual({ status: "unavailable", reason: "missing_input_binding" });
  expect(
    await recordModelThinkingTrace(
      root,
      run,
      envelope,
      evidence,
      new ModelThinkingTrace().snapshot(),
    ),
  ).toEqual({ status: "unavailable", reason: "no_reasoning_deltas" });
  const empty = await fixture(),
    store = new ModelThinkingTraceStore(empty);
  await expect(
    store.put({
      sourceThreadId: run.threadId,
      sourceRunId: run.id,
      turnIndex: 7,
      contextEnvelopeSha256: envelope.contentSha256,
      evidence,
      trace: { ...trace.snapshot(), observedBytes: 1 },
    }),
  ).rejects.toThrow();
  expect(await readdir(empty)).toEqual([]);
});

it("captures reasoning beyond the commit buffer without changing watchdog recovery or inventing provider usage", async () => {
  const model = deepseekProvider()
    .getModels()
    .find((m) => m.id === "deepseek-v4-flash")!;
  const text = randomBytes(42000).toString("hex"),
    parts = [text.slice(0, 32000), text.slice(32000, 64000), text.slice(64000)];
  const policy = DEFAULT_MODEL_TURN_DEADLINE_POLICY,
    error = new ModelTurnWatchdogError({
      ...policy,
      reason: "semantic_progress_timeout",
      limitMs: policy.semanticProgressTimeoutMs,
    });
  const partial = fauxAssistantMessage([]),
    terminal = {
      ...partial,
      stopReason: "aborted" as const,
      errorMessage: error.message,
    };
  let captured: ReturnType<ModelThinkingTrace["snapshot"]> | undefined,
    attempts = 0;
  const stream = guardModelThinkingLoop({
    model,
    context: { messages: [] },
    options: {},
    rootSignal: new AbortController().signal,
    async createSource() {
      attempts++;
      const source = createAssistantMessageEventStream();
      for (const delta of parts)
        source.push({
          type: "thinking_delta",
          contentIndex: 0,
          delta,
          partial,
        } as AssistantMessageEvent);
      source.push({ type: "error", reason: "aborted", error: terminal });
      source.end(terminal);
      return { source, context: { messages: [] }, options: {} };
    },
    onDetected(detected, action, usage, trace) {
      expect(detected.reason).toBe("semantic_stall");
      expect(action).toBe("retry");
      expect(usage).toBeUndefined();
      captured = trace;
      return "finalize";
    },
  });
  const events = [];
  for await (const event of stream) events.push(event);
  expect(attempts).toBe(1);
  expect(captured?.text).toBe(text);
  expect(captured?.observedSha256).toBe(sha256(text));
  expect(captured?.truncated).toBe(false);
  expect(
    events.filter((e) => e.type === "thinking_delta").map((e) => e.delta),
  ).toEqual(parts);
  expect((await stream.result()).stopReason).toBe("error");
  expect(canonicalJson(captured)).not.toContain("provider_terminal");
});
