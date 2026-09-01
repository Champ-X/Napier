import type { JsonValue, RunEvent } from "@napier/contracts";

const STRONG_UNAVAILABLE_ASSERTION =
  /\b(?:cannot|can't|disabled|no access|not available|unavailable)\b|不可用|无法|不能|无权限|未提供|受限/giu;
const WEAK_UNAVAILABLE_ASSERTION =
  /\b(?:lack|lacking|missing|no)\b|没有|缺少/giu;
const AVAILABLE_ASSERTION =
  /\b(?:available|can use|have access|enabled)\b|可以|能够|(?<!不)(?<!未)可用|已提供|有权限/giu;

const CAPABILITY_CLAIM_GROUPS: ReadonlyArray<{
  pattern: RegExp;
  tools: readonly string[];
}> = [
  {
    pattern:
      /\b(?:bash|shell|terminal|cli|command line)\b|命令行|命令工具|终端|控制台/iu,
    tools: ["workspace_process"],
  },
  {
    pattern: /\b(?:internet|network|online)\b|网络|联网|上网/iu,
    tools: ["web_search", "web_fetch", "browser"],
  },
  { pattern: /\bweb search\b|网页搜索/iu, tools: ["web_search"] },
  { pattern: /\bweb fetch\b|网页读取|网页抓取/iu, tools: ["web_fetch"] },
  {
    pattern: /\b(?:edit|modify|patch|write)\b|写入|编辑|修改|补丁/iu,
    tools: ["apply_patch", "workspace_file_apply"],
  },
  {
    pattern:
      /\b(?:clone|git|repo|repository|version control)\b|git_\*|克隆|仓库|版本控制/iu,
    tools: ["workspace_process", "git_inspect"],
  },
];

const EXPLICIT_CAPABILITY_TOOL =
  /\b(?:apply_patch|browser|git_[a-z_]+|run_command|web_fetch|web_search|workspace_file_apply|workspace_process)\b/giu;

export interface UnresolvedCapabilityClaim {
  claimedTools: string[];
  usableNow: string[];
  discoverable: string[];
}

export function claimedUnavailableCapabilityTools(args: unknown): string[] {
  const text = safeCapabilityClaimText(args);
  const claimed = new Set<string>();
  for (const { pattern, tools } of CAPABILITY_CLAIM_GROUPS) {
    for (const match of matches(text, pattern)) {
      if (assertsUnavailableNear(text, match.index, match.text.length)) {
        tools.forEach((tool) => claimed.add(tool));
      }
    }
  }
  for (const match of text.matchAll(EXPLICIT_CAPABILITY_TOOL)) {
    if (assertsUnavailableNear(text, match.index!, match[0]!.length)) {
      claimed.add(match[0]!.toLocaleLowerCase());
    }
  }
  return [...claimed];
}

export function unresolvedCapabilityClaim(input: {
  args: unknown;
  events: readonly RunEvent[];
  activeToolNames: ReadonlySet<string>;
  runtimeAvailableToolNames: ReadonlySet<string>;
}): UnresolvedCapabilityClaim | undefined {
  const claimedTools = claimedUnavailableCapabilityTools(input.args);
  if (claimedTools.length === 0) return undefined;
  const latestTerminalState = latestToolTerminalStates(input.events);
  const usableNow = claimedTools.filter(
    (name) =>
      input.activeToolNames.has(name) &&
      !establishesExecutionBlock(latestTerminalState.get(name)),
  );
  const discoverable = claimedTools.filter(
    (name) =>
      input.runtimeAvailableToolNames.has(name) &&
      !input.activeToolNames.has(name) &&
      !establishesExecutionBlock(latestTerminalState.get(name)),
  );
  return { claimedTools, usableNow, discoverable };
}

type ToolTerminal = {
  state: "completed" | "failed" | "blocked";
  payload: JsonValue;
};

function latestToolTerminalStates(
  events: readonly RunEvent[],
): Map<string, ToolTerminal> {
  const states = new Map<string, ToolTerminal>();
  for (const event of events) {
    if (
      event.type !== "tool.completed" &&
      event.type !== "tool.failed" &&
      event.type !== "tool.blocked"
    ) {
      continue;
    }
    const toolName = eventToolName(event.payload);
    if (toolName) {
      states.set(toolName, {
        state: event.type.slice(5) as ToolTerminal["state"],
        payload: event.payload,
      });
    }
  }
  return states;
}

function establishesExecutionBlock(
  terminal: ToolTerminal | undefined,
): boolean {
  if (!terminal || terminal.state === "completed") return false;
  if (terminal.state === "blocked") return true;
  return hasPermanentUnavailableDiagnostic(terminal.payload);
}

function hasPermanentUnavailableDiagnostic(value: JsonValue): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value))
    return value.some(hasPermanentUnavailableDiagnostic);
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item === "string" &&
      /^(?:status|state|failureCode|errorCode)$/u.test(key) &&
      /(?:^|_)(?:unavailable|unsupported|not_configured|not_enabled)(?:$|_)/iu.test(
        item,
      )
    ) {
      return true;
    }
    if (hasPermanentUnavailableDiagnostic(item)) return true;
  }
  return false;
}

function eventToolName(payload: JsonValue): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  return typeof payload["toolName"] === "string"
    ? payload["toolName"]
    : undefined;
}

function safeCapabilityClaimText(args: unknown): string {
  try {
    const serialized = JSON.stringify(args);
    return typeof serialized === "string" ? serialized.slice(0, 16_000) : "";
  } catch {
    return "";
  }
}

function matches(
  text: string,
  pattern: RegExp,
): Array<{ index: number; text: string }> {
  const flags = pattern.flags.includes("g")
    ? pattern.flags
    : `${pattern.flags}g`;
  return [...text.matchAll(new RegExp(pattern.source, flags))].map((match) => ({
    index: match.index!,
    text: match[0]!,
  }));
}

function assertsUnavailableNear(
  text: string,
  start: number,
  length: number,
): boolean {
  const end = start + length;
  const unavailableDistance = Math.min(
    nearestAssertionDistance(
      text,
      STRONG_UNAVAILABLE_ASSERTION,
      start,
      end,
      180,
    ),
    nearestAssertionDistance(text, WEAK_UNAVAILABLE_ASSERTION, start, end, 40),
  );
  if (!Number.isFinite(unavailableDistance)) return false;
  const availableDistance = nearestAssertionDistance(
    text,
    AVAILABLE_ASSERTION,
    start,
    end,
    80,
  );
  return unavailableDistance < availableDistance;
}

function nearestAssertionDistance(
  text: string,
  pattern: RegExp,
  start: number,
  end: number,
  radius: number,
): number {
  const windowStart = Math.max(0, start - radius);
  const windowEnd = Math.min(text.length, end + radius);
  let nearest = Number.POSITIVE_INFINITY;
  for (const match of matches(text.slice(windowStart, windowEnd), pattern)) {
    const assertionStart = windowStart + match.index;
    const assertionEnd = assertionStart + match.text.length;
    const distance =
      assertionEnd < start
        ? start - assertionEnd
        : assertionStart > end
          ? assertionStart - end
          : 0;
    nearest = Math.min(nearest, distance);
  }
  return nearest;
}
