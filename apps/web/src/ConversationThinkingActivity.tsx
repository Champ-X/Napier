import { Brain } from "lucide-react";
import { useEffect, useState } from "react";

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
  const elapsedSeconds = useLiveElapsedSeconds(activity.startedAt, active);
  const chinese = getLocale() === "zh";
  const title = active
    ? chinese
      ? elapsedSeconds
        ? `正在思考 · ${formatDuration(elapsedSeconds, true)}`
        : "正在思考…"
      : elapsedSeconds
        ? `Thinking · ${formatDuration(elapsedSeconds, false)}`
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
      aria-busy={active}
      onToggle={(event) => {
        if (!active) setExpanded(event.currentTarget.open);
      }}
    >
      <summary>
        <Brain size={15} aria-hidden="true" />
        <span>{title}</span>
        {activity.localDisplayOrigin ? (
          <small>{chinese ? "本机私有副本" : "Local private copy"}</small>
        ) : null}
      </summary>
      <div className="conversation-thinking-content">
        {activity.transcript ? (
          <pre
            className="conversation-thinking-transcript"
            aria-live={active ? "polite" : "off"}
            aria-atomic="false"
          >
            <code>{activity.transcript}</code>
          </pre>
        ) : active ? (
          <p className="conversation-thinking-waiting" role="status">
            {chinese ? "正在等待模型输出…" : "Waiting for model output…"}
          </p>
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

function useLiveElapsedSeconds(
  startedAt: string,
  active: boolean,
): number | undefined {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);
  if (!active) return undefined;
  const start = Date.parse(startedAt);
  const elapsed = now - start;
  // Imported historical fixtures should not render a nonsensical live timer.
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 86_400_000) {
    return undefined;
  }
  return Math.max(1, Math.floor(elapsed / 1_000));
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
