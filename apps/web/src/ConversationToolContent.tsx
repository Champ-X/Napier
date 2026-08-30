import type { ConversationToolDisplay } from "./conversation-tool-display-view-model";
import { getLocale } from "./locale";

export function ConversationToolContent({
  display,
  toolName,
}: {
  display: ConversationToolDisplay;
  toolName: string;
}) {
  const chinese = getLocale() === "zh";
  const sections = [
    display.input
      ? { label: inputLabel(toolName, chinese), value: display.input }
      : undefined,
    display.output
      ? { label: outputLabel(toolName, chinese), value: display.output }
      : undefined,
    display.error
      ? { label: chinese ? "错误" : "Error", value: display.error, error: true }
      : undefined,
  ].filter(Boolean) as Array<{ label: string; value: string; error?: boolean }>;
  const fallback =
    (display.inputRedacted && !display.input) ||
    (display.outputRedacted && !display.output && !display.error);
  if (sections.length === 0 && !fallback) return null;
  return (
    <div className="conversation-tool-content">
      {sections.map((section) => (
        <section
          className={section.error ? "is-error" : undefined}
          key={section.label}
        >
          <span>{section.label}</span>
          <pre>
            <code>{section.value}</code>
          </pre>
        </section>
      ))}
      {fallback ? (
        <small>
          {chinese
            ? "这条历史记录只保留了哈希证据，原始内容无法恢复。"
            : "This historical entry retained hash evidence only; its original content cannot be recovered."}
        </small>
      ) : null}
    </div>
  );
}

function inputLabel(toolName: string, chinese: boolean): string {
  if (toolName === "run_command" || toolName === "workspace_process") {
    return chinese ? "命令" : "Command";
  }
  if (toolName === "apply_patch") return chinese ? "变更" : "Diff";
  return chinese ? "输入" : "Input";
}

function outputLabel(toolName: string, chinese: boolean): string {
  return toolName === "run_command" || toolName === "workspace_process"
    ? "STDOUT"
    : chinese
      ? "结果"
      : "Result";
}
