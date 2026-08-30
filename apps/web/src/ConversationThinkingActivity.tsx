import { Brain } from "lucide-react";
import { useState } from "react";

import type { ConversationThinkingActivity as ThinkingActivity } from "./conversation-thinking-view-model";
import { getLocale } from "./locale";

export interface ConversationThinkingActivityProps {
  activity: ThinkingActivity;
  active?: boolean;
}

export function ConversationThinkingActivity({
  activity,
  active = false,
}: ConversationThinkingActivityProps) {
  const [expanded, setExpanded] = useState(false);
  const chinese = getLocale() === "zh";
  const title = active
    ? chinese
      ? "正在思考…"
      : "Thinking…"
    : activity.durationSeconds
      ? chinese
        ? `思考了 ${formatDuration(activity.durationSeconds, true)}`
        : `Thought for ${formatDuration(activity.durationSeconds, false)}`
      : chinese
        ? "已完成思考"
        : "Finished thinking";
  return (
    <details
      className={`conversation-thinking${active ? " is-active" : ""}`}
      open={active || expanded}
      onToggle={(event) => {
        if (!active) setExpanded(event.currentTarget.open);
      }}
    >
      <summary>
        <Brain size={15} aria-hidden="true" />
        <span>{title}</span>
      </summary>
      <div className="conversation-thinking-content">
        {activity.transcript ? (
          <pre className="conversation-thinking-transcript">
            <code>{activity.transcript}</code>
          </pre>
        ) : (
          <p className="conversation-thinking-redacted">
            {chinese
              ? "这条历史记录没有保留思考原文，无法恢复或补写。"
              : "This historical entry did not retain the thinking transcript; it cannot be recovered or reconstructed."}
          </p>
        )}
      </div>
    </details>
  );
}

function formatDuration(seconds: number, chinese: boolean): string {
  if (seconds < 60) return `${formatNumber(seconds)}${chinese ? " 秒" : "s"}`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return chinese
    ? `${formatNumber(minutes)} 分 ${formatNumber(remainder)} 秒`
    : `${formatNumber(minutes)}m ${formatNumber(remainder)}s`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(getLocale() === "zh" ? "zh-CN" : "en").format(
    value,
  );
}
