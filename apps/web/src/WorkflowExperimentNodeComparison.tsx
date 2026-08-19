import { workflowExperimentCopy as copy } from "./workflow-experiment-copy";
import type { WorkflowExperimentComparisonView } from "./workflow-experiment-view-model";

export interface WorkflowExperimentNodeComparisonProps {
  nodes: WorkflowExperimentComparisonView["nodes"];
}

export function WorkflowExperimentNodeComparison({
  nodes,
}: WorkflowExperimentNodeComparisonProps) {
  return (
    <ol className="workflow-node-comparison">
      {nodes.map((node, index) => (
        <li key={node.nodeId}>
          <header>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{node.nodeId}</strong>
            <em>{node.execution}</em>
          </header>
          <div className="workflow-node-status">
            <span>
              {copy.source} <strong>{statusLabel(node.sourceStatus)}</strong>
            </span>
            <span aria-hidden="true">{"->"}</span>
            <span>
              {copy.target} <strong>{statusLabel(node.targetStatus)}</strong>
            </span>
          </div>
          <dl>
            <div>
              <dt>{copy.output}</dt>
              <dd>{changeLabel(node.outputChange)}</dd>
            </div>
            <div>
              <dt>{copy.model}</dt>
              <dd>
                {node.targetModels.join(", ") ||
                  node.sourceModels.join(", ") ||
                  copy.changes.unavailable}
              </dd>
            </div>
            <div>
              <dt>{copy.duration}</dt>
              <dd>{formatSigned(node.durationMsDelta, "ms")}</dd>
            </div>
            <div>
              <dt>{copy.tokens}</dt>
              <dd>{formatSigned(node.tokenDelta)}</dd>
            </div>
          </dl>
          <p className="workflow-node-tools">
            {[
              ...(node.addedToolNames.length > 0
                ? [`${copy.addedTools}: ${node.addedToolNames.join(", ")}`]
                : []),
              ...(node.removedToolNames.length > 0
                ? [`${copy.removedTools}: ${node.removedToolNames.join(", ")}`]
                : []),
            ].join(" / ") || copy.noToolChanges}
          </p>
        </li>
      ))}
    </ol>
  );
}

function statusLabel(status: string): string {
  return copy.statuses[status as keyof typeof copy.statuses] ?? status;
}

function changeLabel(change: string): string {
  return copy.changes[change as keyof typeof copy.changes] ?? change;
}

function formatSigned(value: number, suffix = ""): string {
  return `${value > 0 ? "+" : ""}${value.toLocaleString()}${suffix}`;
}
