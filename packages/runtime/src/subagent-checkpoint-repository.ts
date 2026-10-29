import { canonicalJson } from "./ed25519.js";
import { assertChildCheckpointTranscript } from "./subagent-checkpoint-transcript.js";
import { assertPreviousChildCheckpoint } from "./subagent-checkpoint-validation.js";
import { subagentCheckpointFrontier } from "./subagent-checkpoint-frontier.js";
import { assertChildRunFence, childRunState } from "./subagent-child-run-fence.js";
import type { SubagentChildRunHost } from "./subagent-child-run-host.js";
import type { SubagentChildRunFence, SubagentChildRunState } from "./subagent-child-run-types.js";
import { acceptedSubagentMailbox, validateConsumedSubagentMailbox } from "./subagent-mailbox-state.js";
import { readSubagentWorkingSetBinding, resolvePreparedSubagentWorkingSet } from "./subagent-working-set-capsule.js";
import type { CommitSubagentChildCheckpointInput, PrepareSubagentChildCheckpointResult,
  SubagentWorkingSetBinding } from "./subagent-working-set-types.js";

export class SubagentCheckpointRepository {
  constructor(private readonly host: SubagentChildRunHost) {}

  async prepare(input: SubagentChildRunFence): Promise<PrepareSubagentChildCheckpointResult> {
    input = { ...input };
    this.host.assertInitialized();
    const initial = assertChildRunFence(this.host, input);
    const previousSha = initial.run.subagent!.checkpoint?.capsuleSha256;
    const previous = previousSha ? await readSubagentWorkingSetBinding(this.host.dataRoot, previousSha) : undefined;
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const { run, task } = assertChildRunFence(this.host, input);
      if (run.subagent!.checkpoint?.capsuleSha256 !== previousSha)
        throw new Error("Child checkpoint pointer changed while preparing");
      const events = this.host.requireLedger().listRunEvents(run.id);
      const frontier = subagentCheckpointFrontier(run, task, events);
      assertPreviousChildCheckpoint(frontier, run.subagent!.checkpoint, previous);
      const accepted = acceptedSubagentMailbox(this.host.requireLedger().listRunEvents(task.runId), task);
      const consumed = previous?.mailbox.entries ?? [];
      const consumedThroughSeq = validateConsumedSubagentMailbox(accepted, consumed, []);
      return { frontier, ...(previous ? { previousCheckpoint: previous.receipt } : {}),
        mailbox: { accepted, consumed, consumedThroughSeq } };
    });
  }

  async commit(input: CommitSubagentChildCheckpointInput): Promise<SubagentChildRunState> {
    input = { ...input };
    const proposed = resolvePreparedSubagentWorkingSet(input.prepared);
    const durable = await readSubagentWorkingSetBinding(this.host.dataRoot, proposed.receipt.capsuleSha256);
    if (canonicalJson(durable) !== canonicalJson(proposed)) throw new Error("Child checkpoint durable capsule changed");
    const previous = proposed.previousCapsuleSha256
      ? await readSubagentWorkingSetBinding(this.host.dataRoot, proposed.previousCapsuleSha256) : undefined;
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const { run, task } = assertChildRunFence(this.host, input);
      const events = this.host.requireLedger().listRunEvents(run.id);
      const frontier = subagentCheckpointFrontier(run, task, events);
      if (canonicalJson(frontier) !== canonicalJson(proposed.frontier))
        throw new Error("Child checkpoint execution or ledger frontier changed");
      assertPreviousCheckpoint(proposed, previous, run.subagent!.checkpoint?.capsuleSha256);
      assertChildCheckpointTranscript(proposed, run, task, events, this.host.requireLedger().listRunEvents(task.runId));
      assertPreviousChildCheckpoint(frontier, run.subagent!.checkpoint, previous);
      const accepted = acceptedSubagentMailbox(this.host.requireLedger().listRunEvents(task.runId), task);
      const consumedThroughSeq = validateConsumedSubagentMailbox(accepted, proposed.mailbox.entries, previous?.mailbox.entries ?? []);
      if (consumedThroughSeq !== proposed.mailbox.consumedThroughSeq)
        throw new Error("Child checkpoint mailbox cursor is not its contiguous accepted prefix");
      const checkpoint = { ...proposed.receipt, revision: frontier.checkpointRevision + 1,
        throughSeq: frontier.runHeadSeq, mailboxConsumedCount: proposed.mailbox.entries.length,
        mailboxConsumedThroughSeq: consumedThroughSeq, storage: "local_only" as const };
      run.subagent!.checkpoint = checkpoint;
      run.subagent!.executionRevision += 1;
      task.mailboxConsumedCount = checkpoint.mailboxConsumedCount;
      task.mailboxConsumedThroughSeq = consumedThroughSeq;
      task.revision += 1;
      const appended = this.host.appendEventsToThread(this.host.mutableThread(run.threadId), [{
        threadId: run.threadId, runId: run.id, type: "subagent.child.checkpoint_committed",
        category: "subagent", visibility: "debug", payload: { taskId: task.id, executionId: task.executionId!,
          ...checkpoint, previousCapsuleSha256: proposed.previousCapsuleSha256,
          configurationSha256: frontier.configurationSha256, invocationIndex: frontier.nextInvocationIndex,
          usageSha256: frontier.usageSha256, turnCount: frontier.turnCount, stepCount: frontier.stepCount },
      }]);
      await this.host.persistState(appended);
      return { ...childRunState(run, task), events: appended };
    });
  }
}

function assertPreviousCheckpoint(proposed: SubagentWorkingSetBinding, previous: SubagentWorkingSetBinding | undefined,
  currentSha: string | undefined): void {
  if ((currentSha ?? "") !== proposed.previousCapsuleSha256 ||
      (previous?.receipt.messageSetSha256 ?? "") !== proposed.previousMessageSetSha256 ||
      (previous && (proposed.receipt.messageCount < previous.receipt.messageCount ||
        proposed.systemPromptSha256 !== previous.systemPromptSha256 ||
        proposed.toolDefinitionSetSha256 !== previous.toolDefinitionSetSha256)))
    throw new Error("Child checkpoint rewrites its prior source, prompt, or tools");
}
