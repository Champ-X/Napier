export type MessageFlowchartDirection = "TD" | "LR" | "RL";
export type MessageFlowchartShape = "box" | "round" | "diamond" | "circle";

export interface MessageFlowchartNode {
  id: string;
  label: string;
  shape: MessageFlowchartShape;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MessageFlowchartEdge {
  from: string;
  to: string;
  label?: string;
  tone: "solid" | "dashed" | "strong";
}

export interface MessageFlowchart {
  direction: MessageFlowchartDirection;
  nodes: MessageFlowchartNode[];
  edges: MessageFlowchartEdge[];
  width: number;
  height: number;
}

interface ParsedNode {
  id: string;
  label: string;
  shape: MessageFlowchartShape;
}

const NODE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/u;

/**
 * Parse a deliberately bounded Mermaid flowchart subset. Unsupported syntax is
 * returned as source by the caller instead of being guessed or executed.
 */
export function parseMessageFlowchart(
  value: string,
): MessageFlowchart | undefined {
  if (value.length > 8_000) return undefined;
  const statements = value
    .replaceAll("\r\n", "\n")
    .split(/\n|;/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("%%"));
  const declaration = statements
    .shift()
    ?.match(/^(?:flowchart|graph)\s+(TD|TB|LR|RL)$/iu);
  if (!declaration) return undefined;
  const rawDirection = declaration[1]!.toUpperCase();
  const direction: MessageFlowchartDirection =
    rawDirection === "TB" ? "TD" : (rawDirection as MessageFlowchartDirection);
  const nodes = new Map<string, ParsedNode>();
  const edges: MessageFlowchartEdge[] = [];

  for (const statement of statements) {
    const edge = parseEdge(statement);
    if (edge) {
      upsertNode(nodes, edge.from);
      upsertNode(nodes, edge.to);
      edges.push({
        from: edge.from.id,
        to: edge.to.id,
        ...(edge.label ? { label: edge.label } : {}),
        tone: edge.tone,
      });
      continue;
    }
    const node = parseNode(statement);
    if (!node) return undefined;
    upsertNode(nodes, node);
  }
  if (nodes.size === 0 || nodes.size > 40 || edges.length > 80)
    return undefined;
  return layoutFlowchart(direction, [...nodes.values()], edges);
}

function parseEdge(statement: string):
  | {
      from: ParsedNode;
      to: ParsedNode;
      label?: string;
      tone: MessageFlowchartEdge["tone"];
    }
  | undefined {
  const match = statement.match(
    /^(.+?)\s*(-->|---|-.->|==>)\s*(?:\|([^|]{1,80})\|\s*)?(.+)$/u,
  );
  if (!match) return undefined;
  const from = parseNode(match[1]!.trim());
  const to = parseNode(match[4]!.trim());
  const label = match[3]?.trim();
  if (!from || !to || (label && !safeFlowLabel(label))) return undefined;
  return {
    from,
    to,
    ...(label ? { label } : {}),
    tone:
      match[2] === "-.->" ? "dashed" : match[2] === "==>" ? "strong" : "solid",
  };
}

function parseNode(value: string): ParsedNode | undefined {
  const plain = value.match(/^([A-Za-z][A-Za-z0-9_-]{0,47})$/u);
  if (plain) return { id: plain[1]!, label: plain[1]!, shape: "box" };
  const match = value.match(
    /^([A-Za-z][A-Za-z0-9_-]{0,47})(?:\[([^\]\n]{1,160})\]|\{([^}\n]{1,160})\}|\(\(([^)\n]{1,160})\)\)|\(([^)\n]{1,160})\))$/u,
  );
  if (!match || !NODE_ID.test(match[1]!)) return undefined;
  const label = (match[2] ?? match[3] ?? match[4] ?? match[5])!.trim();
  if (!safeFlowLabel(label)) return undefined;
  return {
    id: match[1]!,
    label,
    shape: match[3]
      ? "diamond"
      : match[4]
        ? "circle"
        : match[5]
          ? "round"
          : "box",
  };
}

function safeFlowLabel(label: string): boolean {
  return Boolean(label) && !/[<>\u0000-\u001f\u007f]/u.test(label);
}

function upsertNode(
  nodes: Map<string, ParsedNode>,
  candidate: ParsedNode,
): void {
  const current = nodes.get(candidate.id);
  if (
    !current ||
    candidate.label !== candidate.id ||
    candidate.shape !== "box"
  ) {
    nodes.set(candidate.id, candidate);
  }
}

function layoutFlowchart(
  direction: MessageFlowchartDirection,
  sourceNodes: ParsedNode[],
  edges: MessageFlowchartEdge[],
): MessageFlowchart {
  const levels = nodeLevels(sourceNodes, edges);
  const byLevel = new Map<number, ParsedNode[]>();
  for (const node of sourceNodes) {
    const level = levels.get(node.id) ?? 0;
    byLevel.set(level, [...(byLevel.get(level) ?? []), node]);
  }
  const levelEntries = [...byLevel.entries()].sort(
    ([left], [right]) => left - right,
  );
  const maximumLevelSize = Math.max(
    ...levelEntries.map(([, nodes]) => nodes.length),
  );
  const levelCount = Math.max(1, levelEntries.length);
  const horizontal = direction === "LR" || direction === "RL";
  const width = horizontal
    ? Math.max(360, 220 + Math.max(0, levelCount - 1) * 220)
    : Math.max(320, 60 + maximumLevelSize * 210);
  const height = horizontal
    ? Math.max(180, 50 + maximumLevelSize * 88)
    : Math.max(180, 50 + levelCount * 110);
  const laidOut: MessageFlowchartNode[] = [];
  for (const [level, nodes] of levelEntries) {
    nodes.sort((left, right) => left.id.localeCompare(right.id));
    for (const [position, node] of nodes.entries()) {
      const nodeWidth = Math.min(180, Math.max(92, 34 + node.label.length * 7));
      const nodeHeight =
        node.shape === "diamond" ? 64 : node.shape === "circle" ? 58 : 46;
      const primary = 110 + level * 220;
      const secondary =
        ((horizontal ? height : width) / (nodes.length + 1)) * (position + 1);
      const logicalX = horizontal ? primary : secondary;
      const x = direction === "RL" ? width - logicalX : logicalX;
      const y = horizontal ? secondary : 42 + level * 110;
      laidOut.push({ ...node, x, y, width: nodeWidth, height: nodeHeight });
    }
  }
  return { direction, nodes: laidOut, edges, width, height };
}

function nodeLevels(
  nodes: ParsedNode[],
  edges: MessageFlowchartEdge[],
): Map<string, number> {
  const levels = new Map(nodes.map((node) => [node.id, 0]));
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const next = Math.min(nodes.length - 1, (levels.get(edge.from) ?? 0) + 1);
      if (next > (levels.get(edge.to) ?? 0)) {
        levels.set(edge.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return levels;
}
