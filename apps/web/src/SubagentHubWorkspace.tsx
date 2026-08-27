import type {
  SubagentHubTaskV1,
  SubagentHubTranscriptEntryV1,
} from "@napier/contracts/subagent-hub";
import {
  AlertTriangle,
  Bot,
  CircleDot,
  Inbox,
  TerminalSquare,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { subagentHubCopy as copy } from "./subagent-hub-copy";
import { isSubagentHubProjection } from "./subagent-hub-protocol";
import {
  formatSubagentHubNumber,
  formatSubagentHubTimestamp,
  formatSubagentTaskId,
  SubagentTaskStatusIcon,
} from "./subagent-hub-view-primitives";
import { SubagentHubTaskInspector } from "./SubagentHubTaskInspector";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";

type WorkspaceViewModel = ReturnType<typeof useWorkspaceViewModel>;

export function SubagentHubWorkspace({
  vm,
  focusedTaskId,
}: {
  vm: WorkspaceViewModel;
  focusedTaskId?: string;
}) {
  const candidate = vm.detail?.subagentHub;
  const hub = isSubagentHubProjection(candidate, vm.detail?.thread.id)
    ? candidate
    : undefined;
  const invalid = candidate !== undefined && !hub;
  const [selectedTaskId, setSelectedTaskId] = useState<string>();

  useEffect(() => {
    const requested =
      focusedTaskId && hub?.tasks.some((task) => task.taskId === focusedTaskId)
        ? focusedTaskId
        : undefined;
    setSelectedTaskId(
      (current) =>
        requested ??
        (current && hub?.tasks.some((task) => task.taskId === current)
          ? current
          : hub?.tasks[0]?.taskId),
    );
  }, [focusedTaskId, hub]);

  const selected = useMemo(
    () => hub?.tasks.find((task) => task.taskId === selectedTaskId),
    [hub, selectedTaskId],
  );

  return (
    <section
      id="workspace-panel-subagents"
      className="workspace-view-panel subagent-hub-workspace-view"
      role="tabpanel"
      aria-labelledby="workspace-view-subagents"
    >
      <div className="subagent-hub-workspace">
        <header className="subagent-hub-masthead">
          <div>
            <span>{copy.eyebrow}</span>
            <h2>{copy.title}</h2>
            <p>{copy.body}</p>
          </div>
          {hub ? <HubSummary hub={hub} /> : null}
        </header>

        {invalid ? (
          <HubEmpty title={copy.invalidTitle} body={copy.invalidBody} danger />
        ) : !hub || hub.tasks.length === 0 ? (
          <HubEmpty title={copy.noTasksTitle} body={copy.noTasksBody} />
        ) : (
          <div className="subagent-hub-grid">
            <TaskRail
              tasks={hub.tasks}
              {...(selectedTaskId ? { selectedTaskId } : {})}
              omittedCount={hub.omittedTaskCount}
              onSelect={setSelectedTaskId}
            />
            {selected ? (
              <>
                <Transcript task={selected} />
                <SubagentHubTaskInspector
                  task={selected}
                  tasks={hub.tasks}
                  vm={vm}
                  onSelect={setSelectedTaskId}
                />
              </>
            ) : (
              <HubEmpty title={copy.selectTask} body="" />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function HubSummary({
  hub,
}: {
  hub: NonNullable<WorkspaceViewModel["detail"]>["subagentHub"];
}) {
  if (!hub) return null;
  return (
    <dl className="subagent-hub-summary">
      <SummaryMetric
        label={copy.summary.active}
        value={hub.activeTaskCount}
        accent
      />
      <SummaryMetric
        label={copy.summary.terminal}
        value={hub.terminalTaskCount}
      />
      <SummaryMetric
        label={copy.summary.orphaned}
        value={hub.orphanedTaskCount}
        danger={hub.orphanedTaskCount > 0}
      />
      <SummaryMetric label={copy.summary.events} value={hub.eventWatermark} />
    </dl>
  );
}

function SummaryMetric({
  label,
  value,
  accent = false,
  danger = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div className={accent ? "is-accent" : danger ? "is-danger" : ""}>
      <dt>{label}</dt>
      <dd>{formatSubagentHubNumber(value)}</dd>
    </div>
  );
}

function TaskRail({
  tasks,
  selectedTaskId,
  omittedCount,
  onSelect,
}: {
  tasks: SubagentHubTaskV1[];
  selectedTaskId?: string;
  omittedCount: number;
  onSelect(taskId: string): void;
}) {
  return (
    <aside className="subagent-hub-task-rail" aria-label={copy.taskList}>
      <header>
        <strong>{copy.taskList}</strong>
        <span>
          {formatSubagentHubNumber(tasks.length)} {copy.taskCount}
        </span>
      </header>
      <div className="subagent-hub-task-list">
        {tasks.map((task) => (
          <button
            className={selectedTaskId === task.taskId ? "is-selected" : ""}
            type="button"
            key={task.taskId}
            aria-pressed={selectedTaskId === task.taskId}
            onClick={() => onSelect(task.taskId)}
          >
            <SubagentTaskStatusIcon task={task} />
            <span>
              <small>
                {copy.roles[task.role]} · {copy.statuses[task.status]}
              </small>
              <strong>{task.description}</strong>
              <i>
                {formatSubagentTaskId(task.taskId)} · r{task.revision}
              </i>
            </span>
            {task.mailbox.pendingCount > 0 ? (
              <em aria-label={`${task.mailbox.pendingCount} ${copy.pending}`}>
                {task.mailbox.pendingCount}
              </em>
            ) : null}
          </button>
        ))}
      </div>
      {omittedCount > 0 ? (
        <p>
          {formatSubagentHubNumber(omittedCount)} {copy.omitted}
        </p>
      ) : null}
    </aside>
  );
}

function Transcript({ task }: { task: SubagentHubTaskV1 }) {
  return (
    <section className="subagent-hub-transcript" aria-label={copy.transcript}>
      <header>
        <div>
          <span>
            {copy.roles[task.role]} · {copy.statuses[task.status]}
          </span>
          <h3>{task.description}</h3>
        </div>
        <code>
          {task.model.provider}/{task.model.id}
        </code>
      </header>
      <div
        className="subagent-hub-transcript-list"
        role="log"
        aria-live="polite"
      >
        {task.transcript.length > 0 ? (
          task.transcript.map((entry) => (
            <TranscriptEntry entry={entry} key={entry.id} />
          ))
        ) : (
          <div className="subagent-hub-transcript-empty">
            <CircleDot size={17} aria-hidden="true" />
            <p>{copy.transcriptEmpty}</p>
          </div>
        )}
      </div>
    </section>
  );
}

function TranscriptEntry({ entry }: { entry: SubagentHubTranscriptEntryV1 }) {
  const Icon =
    entry.kind === "tool" || entry.kind === "worktree"
      ? TerminalSquare
      : entry.kind === "message"
        ? Inbox
        : Bot;
  return (
    <article
      className={`subagent-hub-transcript-entry kind-${entry.kind}${entry.isError ? " is-error" : ""}`}
    >
      <div className="subagent-hub-transcript-marker">
        <Icon size={14} aria-hidden="true" />
      </div>
      <div>
        <header>
          <strong>{transcriptLabel(entry)}</strong>
          <code>#{entry.seq}</code>
          <time dateTime={entry.createdAt}>
            {formatSubagentHubTimestamp(entry.createdAt)}
          </time>
        </header>
        {entry.text ? <p>{entry.text}</p> : null}
        {entry.contentRedacted ? (
          <p className="is-redacted">
            {copy.redacted}
            {entry.textSha256 ? ` · ${entry.textSha256.slice(0, 12)}` : ""}
          </p>
        ) : null}
      </div>
    </article>
  );
}

function HubEmpty({
  title,
  body,
  danger = false,
}: {
  title: string;
  body: string;
  danger?: boolean;
}) {
  return (
    <div className={`subagent-hub-empty${danger ? " is-danger" : ""}`}>
      {danger ? <AlertTriangle size={24} /> : <Bot size={24} />}
      <strong>{title}</strong>
      {body ? <p>{body}</p> : null}
    </div>
  );
}

function transcriptLabel(entry: SubagentHubTranscriptEntryV1): string {
  if (entry.toolName) return entry.toolName;
  if (entry.messageKind)
    return entry.messageKind === "steering" ? copy.steering : copy.input;
  return entry.status ?? entry.eventType;
}
