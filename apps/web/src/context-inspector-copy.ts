import { deepMergeCopy, getLocale, type LocaleOverride } from "./locale";

export const contextInspectorCopyEn = {
  label: "Context inspector",
  typeLabels: {
    event: "Event",
    tool: "Tool",
    evidence: "Evidence",
  },
  pin: "Pin this object",
  unpin: "Unpin this object",
  close: "Close inspector",
} as const;

export const contextInspectorZh: LocaleOverride<typeof contextInspectorCopyEn> =
  {
    label: "上下文检查器",
    typeLabels: {
      event: "事件",
      tool: "工具",
      evidence: "证据",
    },
    pin: "固定该对象",
    unpin: "取消固定",
    close: "关闭检查器",
  };

export const contextInspectorCopy = deepMergeCopy(
  contextInspectorCopyEn,
  getLocale() === "zh" ? contextInspectorZh : {},
);
