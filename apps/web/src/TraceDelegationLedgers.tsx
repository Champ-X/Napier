import type { AgentMilestone, ModelRef, SubagentTask } from "@napier/contracts";

import { agentMilestoneCopy } from "./agent-milestone-copy";
import { copy } from "./copy";
import { DelegationCard } from "./DelegationCard";

export function AgentMilestoneLedger({
  milestones,
  unavailable,
}: {
  milestones: AgentMilestone[] | undefined;
  unavailable: boolean;
}) {
  return (
    <section
      className="agent-milestone-ledger"
      aria-labelledby="agent-milestone-title"
      aria-busy={milestones === undefined}
    >
      <header>
        <div>
          <span>{agentMilestoneCopy.eyebrow}</span>
          <h3 id="agent-milestone-title">{agentMilestoneCopy.title}</h3>
        </div>
        <span>{String(milestones?.length ?? 0).padStart(2, "0")}</span>
      </header>
      {milestones === undefined ? (
        <p>{agentMilestoneCopy.loading}</p>
      ) : unavailable ? (
        <p role="status">{agentMilestoneCopy.unavailable}</p>
      ) : milestones.length === 0 ? (
        <p>{agentMilestoneCopy.empty}</p>
      ) : (
        <ol>
          {milestones
            .slice()
            .reverse()
            .map((milestone) => (
              <li className="agent-milestone-card" key={milestone.id}>
                <header>
                  <span>{agentMilestoneCopy.phases[milestone.phase]}</span>
                  <code>#{String(milestone.sequence).padStart(2, "0")}</code>
                </header>
                <strong>{milestone.title}</strong>
                <p>{milestone.summary}</p>
                <dl>
                  <div>
                    <dt>{agentMilestoneCopy.completed}</dt>
                    <dd>{milestone.completedItems.length}</dd>
                  </div>
                  <div>
                    <dt>{agentMilestoneCopy.open}</dt>
                    <dd>{milestone.openLoops.length}</dd>
                  </div>
                  <div>
                    <dt>{agentMilestoneCopy.evidence}</dt>
                    <dd>{milestone.evidence.eventCount}</dd>
                  </div>
                </dl>
                {milestone.openLoops.length > 0 ? (
                  <ul>
                    {milestone.openLoops.map((openLoop) => (
                      <li key={openLoop}>{openLoop}</li>
                    ))}
                  </ul>
                ) : null}
                <footer>
                  <time dateTime={milestone.recordedAt}>
                    {formatTime(milestone.recordedAt)}
                  </time>
                  <code title={milestone.contentSha256}>
                    {milestone.contentSha256.slice(0, 12)}
                  </code>
                </footer>
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}

export function DelegationLedger({
  tasks,
  reviewerModel,
  reviewerModelConfigured,
}: {
  tasks: SubagentTask[];
  reviewerModel: ModelRef | undefined;
  reviewerModelConfigured: boolean;
}) {
  if (tasks.length === 0) return null;
  return (
    <section className="delegation-ledger" aria-labelledby="delegation-title">
      <header className="delegation-heading">
        <div>
          <span>{copy.delegation.eyebrow}</span>
          <h3 id="delegation-title">{copy.delegation.title}</h3>
        </div>
        <span>{String(tasks.length).padStart(2, "0")}</span>
      </header>
      <div className="delegation-list">
        {tasks
          .slice()
          .reverse()
          .map((task) => (
            <DelegationCard
              key={`${task.id}:${reviewerModel?.provider ?? ""}/${reviewerModel?.id ?? ""}`}
              task={task}
              reviewerModel={reviewerModel}
              reviewerModelConfigured={reviewerModelConfigured}
            />
          ))}
      </div>
    </section>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
