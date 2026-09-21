import type { RunEvent, JsonValue, RunRecord } from "@napier/contracts";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256 } from "./ed25519.js";
import { ModelInvocationCapsuleStore } from "./model-invocation-capsule-store.js";
import { runInputCapsuleStore } from "./run-input-capsule.js";
import { resolveExternalOutcomeReview } from "./external-outcome-review.js";
import {
  validateInitialInvocationReceipt,
  validateRunInputCaptureReceipt,
  validateRunReproductionEvents,
} from "./run-input-reproduction-source.js";

/** Export only into a new private directory. Original files, Run outcomes and
 * captured inputs are never updated. A grader must be supplied separately. */
export async function exportRunInputReproduction(input: {
  store: {
    workspaceRoot: string;
    dataRoot: string;
    listRuns(threadId: string): RunRecord[];
    listRunEvents(runId: string): Promise<RunEvent[]>;
  };
  threadId: string;
  runId: string;
  output: string;
  externalOutcomeReview?: unknown;
}): Promise<{
  runId: string;
  workspaceComplete: boolean;
  receiptSha256: string;
}> {
  const run = input.store
    .listRuns(input.threadId)
    .find((candidate) => candidate.id === input.runId);
  if (!run) throw new Error("Source Run is not in the requested thread");
  const { events, terminalEvent } = validateRunReproductionEvents(
    run,
    input.threadId,
    await input.store.listRunEvents(run.id),
  );
  if (
    run.status === "completed" &&
    !events.some((e) => e.type === "tool.failed") &&
    input.externalOutcomeReview === undefined
  )
    throw new Error(
      "Reproduction export requires a settled failure, recovered tool failure, or external outcome review",
    );
  const captures = events.filter((e) => e.type === "run.inputs.captured");
  if (
    captures.length !== 1 ||
    typeof field(captures[0]!, "capsuleSha256") !== "string"
  )
    throw new Error("Run has no unique initial input capsule");
  const capture = captures[0]!;
  const capsule = await runInputCapsuleStore(input.store.dataRoot).read(
    String(field(capture, "capsuleSha256")),
  );
  validateRunInputCaptureReceipt(capture, capsule);
  if (
    capsule.runId !== run.id ||
    capsule.threadId !== run.threadId ||
    capsule.configurationSha256 !== run.configuration?.contentSha256 ||
    capsule.workspaceRootSha256 !== sha256(input.store.workspaceRoot)
  )
    throw new Error("Initial input capsule does not match the source Run");
  const externalOutcomeReview = resolveExternalOutcomeReview(
    input.externalOutcomeReview,
    run,
    capsule.promptSha256,
  );
  const invocationEvent = events.find(
    (e) =>
      (e.type === "context.model_invocation" ||
        e.type === "context.model_invocation_unavailable") &&
      field(e, "purpose") === "agent_turn",
  );
  if (
    !invocationEvent ||
    invocationEvent.type !== "context.model_invocation" ||
    invocationEvent.seq <= capture.seq ||
    invocationEvent.seq >= terminalEvent.seq
  )
    throw new Error(
      "Initial model invocation is missing or predates the workspace capture",
    );
  const invocation = await new ModelInvocationCapsuleStore(
    input.store.dataRoot,
  ).read(String(field(invocationEvent, "capsuleSha256")));
  validateInitialInvocationReceipt(invocationEvent, invocation);
  if (
    invocation.sourceRunId !== run.id ||
    invocation.sourceThreadId !== run.threadId
  )
    throw new Error("Model invocation belongs to another Run");
  const prompt = events.find(
    (e) =>
      e.type === "message.user" &&
      e.seq < invocationEvent.seq &&
      typeof field(e, "text") === "string" &&
      sha256(String(field(e, "text"))) === capsule.promptSha256,
  );
  if (!prompt)
    throw new Error(
      "Original task prompt does not match the initial input capsule",
    );
  const output = path.resolve(input.output);
  await mkdir(output, { mode: 0o700 });
  try {
    const fixture = path.join(output, "fixture");
    await mkdir(fixture, { mode: 0o700 });
    for (const directory of capsule.directories)
      await mkdir(path.join(fixture, directory.path), {
        recursive: true,
        mode: 0o700,
      });
    for (const file of capsule.files) {
      const destination = path.join(fixture, file.path);
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, Buffer.from(file.data, "base64"), {
        flag: "wx",
        mode: 0o600,
      });
      await chmod(destination, file.mode);
    }
    for (const directory of [...capsule.directories].reverse())
      await chmod(path.join(fixture, directory.path), directory.mode);
    await writeFile(
      path.join(output, "prompt.md"),
      String(field(prompt, "text")),
      { flag: "wx", mode: 0o600 },
    );
    await writeFile(
      path.join(output, "initial-invocation.json"),
      canonicalJson(invocation),
      { flag: "wx", mode: 0o600 },
    );
    const content = {
      kind: "napier.production-run-reproduction",
      schemaVersion: externalOutcomeReview ? 2 : 1,
      runId: run.id,
      threadId: run.threadId,
      originalStatus: run.status,
      ...(externalOutcomeReview
        ? {
            externalOutcomeReview: {
              authority: "caller_assessment",
              receipt: externalOutcomeReview,
            },
          }
        : {}),
      configuration: run.configuration,
      initialCaptureEventId: capture.id,
      initialCapsuleSha256: capsule.contentSha256,
      initialInvocationEventId: invocationEvent.id,
      initialInvocationSha256: invocation.contentSha256,
      promptSha256: capsule.promptSha256,
      files: capsule.files.map(({ data: _data, ...file }) => file),
      omissions: capsule.omissions,
      workspaceComplete: capsule.omissions.length === 0,
      qualificationReady: false,
      limitations: [
        "Optimistic file scan, not an atomic filesystem snapshot",
        "External services and installed dependency bytes are not restored",
        "Independent grader and environment qualification are required",
        "Same model inputs do not guarantee the same failure",
        ...(externalOutcomeReview
          ? [
              "External review is caller-supplied; hash bindings do not authenticate the reviewer or prove task failure",
            ]
          : []),
      ],
    };
    const receiptSha256 = sha256(canonicalJson(content));
    await writeFile(
      path.join(output, "reproduction.json"),
      canonicalJson({ ...content, contentSha256: receiptSha256 }),
      { flag: "wx", mode: 0o600 },
    );
    return {
      runId: run.id,
      workspaceComplete: content.workspaceComplete,
      receiptSha256,
    };
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}

function field(event: RunEvent, key: string): JsonValue | undefined {
  const p = event.payload;
  return p && typeof p === "object" && !Array.isArray(p) ? p[key] : undefined;
}
