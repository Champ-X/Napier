import { useId } from "react";

import {
  parseMessageFlowchart,
  type MessageFlowchartEdge,
  type MessageFlowchartNode,
} from "./message-flowchart";

export function MessageFlowchart({ source }: { source: string }) {
  const chart = parseMessageFlowchart(source);
  const markerId = `message-flow-${useId().replace(/[^a-z0-9_-]/giu, "")}`;
  if (!chart) return null;
  const nodes = new Map(chart.nodes.map((node) => [node.id, node]));
  return (
    <figure className="message-flowchart">
      <figcaption>Flowchart</figcaption>
      <div>
        <svg
          viewBox={`0 0 ${String(chart.width)} ${String(chart.height)}`}
          role="img"
          aria-label="Flowchart rendered from the answer"
        >
          <title>Flowchart rendered from the answer</title>
          <defs>
            <marker
              id={markerId}
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L8,4 L0,8 z" />
            </marker>
          </defs>
          <g className="message-flowchart-edges">
            {chart.edges.map((edge, index) => (
              <FlowEdge
                edge={edge}
                from={nodes.get(edge.from)!}
                to={nodes.get(edge.to)!}
                markerId={markerId}
                key={`${edge.from}-${edge.to}-${String(index)}`}
              />
            ))}
          </g>
          <g className="message-flowchart-nodes">
            {chart.nodes.map((node) => (
              <FlowNode node={node} key={node.id} />
            ))}
          </g>
        </svg>
      </div>
    </figure>
  );
}

function FlowNode({ node }: { node: MessageFlowchartNode }) {
  const x = node.x - node.width / 2;
  const y = node.y - node.height / 2;
  return (
    <g className={`is-${node.shape}`}>
      {node.shape === "diamond" ? (
        <path
          d={`M ${node.x} ${y} L ${x + node.width} ${node.y} L ${node.x} ${y + node.height} L ${x} ${node.y} Z`}
        />
      ) : node.shape === "circle" ? (
        <ellipse
          cx={node.x}
          cy={node.y}
          rx={node.width / 2}
          ry={node.height / 2}
        />
      ) : (
        <rect
          x={x}
          y={y}
          width={node.width}
          height={node.height}
          rx={node.shape === "round" ? 22 : 5}
        />
      )}
      <text
        x={node.x}
        y={node.y}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {shortLabel(node.label)}
      </text>
    </g>
  );
}

function FlowEdge({
  edge,
  from,
  to,
  markerId,
}: {
  edge: MessageFlowchartEdge;
  from: MessageFlowchartNode;
  to: MessageFlowchartNode;
  markerId: string;
}) {
  const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
  const startX =
    from.x + (horizontal ? (Math.sign(to.x - from.x) * from.width) / 2 : 0);
  const startY =
    from.y + (horizontal ? 0 : (Math.sign(to.y - from.y) * from.height) / 2);
  const endX =
    to.x - (horizontal ? (Math.sign(to.x - from.x) * to.width) / 2 : 0);
  const endY =
    to.y - (horizontal ? 0 : (Math.sign(to.y - from.y) * to.height) / 2);
  const path = horizontal
    ? `M ${startX} ${startY} C ${(startX + endX) / 2} ${startY}, ${(startX + endX) / 2} ${endY}, ${endX} ${endY}`
    : `M ${startX} ${startY} C ${startX} ${(startY + endY) / 2}, ${endX} ${(startY + endY) / 2}, ${endX} ${endY}`;
  return (
    <g className={`is-${edge.tone}`}>
      <path d={path} markerEnd={`url(#${markerId})`} />
      {edge.label ? (
        <text
          x={(startX + endX) / 2}
          y={(startY + endY) / 2 - 6}
          textAnchor="middle"
        >
          {shortLabel(edge.label, 28)}
        </text>
      ) : null}
    </g>
  );
}

function shortLabel(value: string, maximum = 34): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}
