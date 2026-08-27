import type { desktopWorkbenchCopy } from "./desktop-workbench-copy";
import type { LocaleOverride } from "./locale";

export const contextCompactionCopyZh = {
  eyebrow: "上下文检查点",
  title: "压缩预览与分支",
  body: "先检查模型生成的上下文检查点，再应用到新会话；源会话记录始终保持不变。",
  forkOnly: "仅创建分支",
  retainedMessages: "保留的最近消息",
  source: "预览来源",
  messages: "条消息",
  messagesCompacted: "条消息将被摘要",
  previewAction: "生成预览",
  previewing: "正在生成……",
  previewReady: "预览已就绪",
  summary: "检查点摘要",
  decisions: "已做决策",
  openLoops: "待办事项",
  artifacts: "工作产物",
  none: "暂无记录。",
  range: "源范围",
  retainedFrom: "原始记录起点",
  continuity: "连续性事件",
  sourceHash: "源事件集",
  forkTitle: "新会话标题",
  applyAction: "创建压缩分支",
  applying: "正在创建分支……",
  applyNote:
    "应用操作仅可执行一次；若预览后源会话发生变化，系统会拒绝创建分支。",
  noThread: "请先打开一个会话。",
  modelUnavailable: "请选择已配置的提供方模型。",
  notEnoughMessages: "至少需要三条消息。",
  runActive: "请等待当前运行结束。",
  untitledThread: "未命名会话",
} satisfies LocaleOverride<
  typeof desktopWorkbenchCopy.settingsSurface.contextCompaction
>;
