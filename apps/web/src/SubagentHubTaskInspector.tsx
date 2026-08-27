import type { SubagentHubTaskV1 } from "@napier/contracts/subagent-hub";
import {
  AlertTriangle,
  ArrowUpRight,
  GitBranch,
  LoaderCircle,
  RotateCcw,
  Send,
  Square,
} from "lucide-react";
import { useEffect, useState } from "react";

import { subagentHubCopy as copy } from "./subagent-hub-copy";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";
import {
  formatSubagentHubNumber,
  formatSubagentTaskId,
  SubagentTaskStatusIcon,
} from "./subagent-hub-view-primitives";

type WorkspaceViewModel = ReturnType<typeof useWorkspaceViewModel>;

export function SubagentHubTaskInspector({
  task,
  tasks,
  vm,
  onSelect,
}: {
  task: SubagentHubTaskV1;
  tasks: SubagentHubTaskV1[];
  vm: WorkspaceViewModel;
  onSelect(taskId: string): void;
}) {
  const [messageKind, setMessageKind] = useState<"steering" | "input">(
    "steering",
  );
  const [message, setMessage] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const busy =
    vm.subagentHubActionBusy?.taskId === task.taskId
      ? vm.subagentHubActionBusy.action
      : undefined;
  const actionPending = vm.subagentHubActionBusy !== undefined;

  useEffect(() => {
    setMessage("");
    setCancelOpen(false);
    setCancelReason("");
  }, [task.taskId]);

  const submitMessage = async () => {
    if (!message.trim() || actionPending) return;
    const response = await vm.steerSubagent(
      task.taskId,
      task.revision,
      messageKind,
      message,
    );
    if (response) setMessage("");
  };
  const submitCancel = async () => {
    if (!cancelReason.trim() || actionPending) return;
    const response = await vm.cancelSubagent(
      task.taskId,
      task.revision,
      cancelReason,
    );
    if (response) {
      setCancelReason("");
      setCancelOpen(false);
    }
  };
  const submitRevive = async () => {
    if (actionPending) return;
    const response = await vm.reviveSubagent(task.taskId, task.revision);
    if (response) onSelect(response.result.taskId);
  };

  return (
    <aside className="subagent-hub-inspector">
      <section className="subagent-hub-facts">
        <header>
          <span>{copy.control}</span>
          <SubagentTaskStatusIcon task={task} />
        </header>
        <dl>
          <Fact
            label={copy.model}
            value={`${task.model.provider}/${task.model.id}`}
          />
          <Fact label={copy.run} value={formatSubagentTaskId(task.runId)} />
          <Fact label={copy.revision} value={String(task.revision)} />
          <Fact
            label={copy.steps}
            value={formatSubagentHubNumber(task.stepCount)}
          />
          <Fact
            label={copy.turns}
            value={formatSubagentHubNumber(task.turnCount)}
          />
          <Fact
            label={copy.tokens}
            value={formatSubagentHubNumber(
              task.usage.inputTokens + task.usage.outputTokens,
            )}
          />
          <Fact
            label={copy.mailbox}
            value={`${task.mailbox.deliveredCount}/${task.mailbox.acceptedCount} · ${task.mailbox.pendingCount} ${copy.pending}`}
          />
        </dl>
      </section>

      <section className="subagent-hub-controls">
        {task.control.steer ? (
          <>
            <div
              className="subagent-hub-control-mode"
              role="group"
              aria-label={copy.control}
            >
              <button
                type="button"
                className={messageKind === "steering" ? "is-active" : ""}
                onClick={() => setMessageKind("steering")}
              >
                {copy.steering}
              </button>
              <button
                type="button"
                className={messageKind === "input" ? "is-active" : ""}
                onClick={() => setMessageKind("input")}
              >
                {copy.input}
              </button>
            </div>
            <textarea
              value={message}
              maxLength={8_000}
              placeholder={copy.messagePlaceholder}
              aria-label={copy.messagePlaceholder}
              onChange={(event) => setMessage(event.target.value)}
            />
            <button
              className="subagent-hub-primary-action"
              type="button"
              disabled={!message.trim() || actionPending}
              onClick={() => void submitMessage()}
            >
              {busy === "steer" ? (
                <LoaderCircle className="is-spinning" size={14} />
              ) : (
                <Send size={14} />
              )}
              {busy === "steer" ? copy.sending : copy.send}
            </button>
          </>
        ) : null}
        {task.control.cancel ? (
          cancelOpen ? (
            <div className="subagent-hub-cancel-form">
              <input
                value={cancelReason}
                maxLength={500}
                placeholder={copy.cancelReason}
                aria-label={copy.cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
              />
              <button
                type="button"
                disabled={!cancelReason.trim() || actionPending}
                onClick={() => void submitCancel()}
              >
                {busy === "cancel" ? copy.cancelling : copy.confirmCancel}
              </button>
            </div>
          ) : (
            <button
              className="subagent-hub-secondary-action is-danger"
              type="button"
              disabled={actionPending}
              onClick={() => setCancelOpen(true)}
            >
              <Square size={13} /> {copy.cancel}
            </button>
          )
        ) : null}
        {task.control.revive ? (
          <button
            className="subagent-hub-primary-action"
            type="button"
            disabled={actionPending}
            onClick={() => void submitRevive()}
          >
            {busy === "revive" ? (
              <LoaderCircle className="is-spinning" size={14} />
            ) : (
              <RotateCcw size={14} />
            )}
            {busy === "revive" ? copy.reviving : copy.revive}
          </button>
        ) : null}
        {!task.control.steer &&
        !task.control.cancel &&
        !task.control.revive &&
        task.control.unavailableReason ? (
          <p className="subagent-hub-unavailable">
            <AlertTriangle size={14} />
            {copy.unavailable[task.control.unavailableReason]}
          </p>
        ) : null}
        {vm.subagentHubActionError?.taskId === task.taskId ? (
          <p className="subagent-hub-action-error" role="alert">
            <strong>{copy.actionFailed}</strong>
            {vm.subagentHubActionError.message}
          </p>
        ) : null}
      </section>

      <Outcome task={task} />
      <Worktree task={task} />
      <Lineage task={task} tasks={tasks} onSelect={onSelect} />
      {task.typedOutput ? (
        <details className="subagent-hub-typed-output">
          <summary>
            {copy.typedOutput}
            <code>{task.typedOutput.schemaSha256.slice(0, 12)}</code>
          </summary>
          <pre>{JSON.stringify(task.typedOutput.value, null, 2)}</pre>
        </details>
      ) : null}
    </aside>
  );
}

function Outcome({ task }: { task: SubagentHubTaskV1 }) {
  return (
    <section className="subagent-hub-outcome">
      <header>
        <span>{copy.outcome}</span>
        {task.outcome ? (
          <code>{task.outcome.contentSha256.slice(0, 12)}</code>
        ) : null}
      </header>
      {task.outcome ? (
        <>
          <p>{task.outcome.summary}</p>
          <div className="subagent-hub-outcome-metrics">
            <span>
              {task.outcome.evidenceCount} {copy.evidence}
            </span>
            <span>
              {task.outcome.unknownCount} {copy.unknown}
            </span>
            <span>
              {task.outcome.warningCount} {copy.warning}
            </span>
            <span>
              {task.outcome.blockerCount} {copy.blocker}
            </span>
          </div>
          <ul>
            {task.outcome.items.map((item, index) => (
              <li
                className={`severity-${item.severity}`}
                key={`${item.kind}-${index}`}
              >
                <span>{item.kind}</span>
                <strong>{item.title}</strong>
                <small>
                  {item.evidenceCount} {copy.evidence}
                </small>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="is-empty">{copy.outcomeEmpty}</p>
      )}
    </section>
  );
}

function Worktree({ task }: { task: SubagentHubTaskV1 }) {
  if (task.worktree.state === "none") return null;
  return (
    <section className="subagent-hub-worktree">
      <header>
        <span>{copy.worktree}</span>
        <code>{task.worktree.state}</code>
      </header>
      <dl>
        {task.worktree.writeScopeCount !== undefined ? (
          <Fact
            label={copy.writeScope}
            value={formatSubagentHubNumber(task.worktree.writeScopeCount)}
          />
        ) : null}
        {task.worktree.changedFileCount !== undefined ? (
          <Fact
            label={copy.changedFiles}
            value={formatSubagentHubNumber(task.worktree.changedFileCount)}
          />
        ) : null}
        {task.worktree.applyStatus ? (
          <Fact label={copy.apply} value={task.worktree.applyStatus} />
        ) : null}
        {task.worktree.postcondition ? (
          <Fact
            label={copy.postcondition}
            value={task.worktree.postcondition}
          />
        ) : null}
        {task.worktree.durable ? <Fact label={copy.durable} value="✓" /> : null}
      </dl>
    </section>
  );
}

function Lineage({
  task,
  tasks,
  onSelect,
}: {
  task: SubagentHubTaskV1;
  tasks: SubagentHubTaskV1[];
  onSelect(taskId: string): void;
}) {
  const ids = [task.lineage.parentTaskId, ...task.lineage.childTaskIds].filter(
    (id): id is string => Boolean(id),
  );
  if (ids.length === 0) return null;
  return (
    <section className="subagent-hub-lineage">
      <header>
        <span>{copy.lineage}</span>
        <GitBranch size={14} />
      </header>
      {ids.map((id) => {
        const related = tasks.find((candidate) => candidate.taskId === id);
        return (
          <button
            type="button"
            key={id}
            disabled={!related}
            onClick={() => related && onSelect(id)}
          >
            <span>
              {id === task.lineage.parentTaskId ? copy.parent : copy.children}
            </span>
            <strong>{related?.description ?? formatSubagentTaskId(id)}</strong>
            <ArrowUpRight size={13} />
          </button>
        );
      })}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
