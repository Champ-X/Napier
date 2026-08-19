import type { LocaleOverride } from "./locale";
import type { toolInvocationExperimentCopyEn } from "./tool-invocation-experiment-copy";

export const toolInvocationExperimentCopyZh: LocaleOverride<
  typeof toolInvocationExperimentCopyEn
> = {
  eyebrow: "受控重新执行 / 工具检查点",
  title: "只读工具调用",
  body: "针对新绑定的工作区范围运行一次已捕获的内置只读工具。准确参数与输出正文保持折叠。",
  checkpoint: "已捕获调用",
  selectCheckpoint: "选择已完成的工具调用",
  titleLabel: "目标标题",
  titlePlaceholder: "可选的隔离目标标题",
  preview: "预览调用",
  previewing: "正在绑定调用……",
  reset: "重置",
  empty: "此会话没有可用的已完成只读工具调用。",
  sourceRunning: "请等待活动来源运行结算后再预览。",
  previewReady: "新的调用预览",
  readOnly: "一次只读调用",
  source: "来源",
  candidate: "候选项",
  definition: "工具定义",
  arguments: "私有参数",
  workspace: "工作区范围",
  capsule: "本地胶囊",
  sourceOutput: "来源输出",
  sourceDuration: "来源耗时",
  previewBinding: "预览",
  execute: "执行一次调用",
  cancel: "取消",
  frames: "帧",
  comparison: "调用比较",
  outputChanged: "输出已变化",
  outputUnchanged: "输出未变化",
  duration: "耗时差异",
  bytes: "输出字节差异",
  sourceBytes: "来源字节数",
  targetBytes: "候选字节数",
  openTarget: "打开目标",
  download: "下载结果",
  safety:
    "这里只列出终态运行中的严格本地回执。扩展、会话、写入工具、准确参数、工作区路径和输出正文都不会呈现。",
  errors: {
    checkpointRequired: "请先选择已捕获的工具调用。",
    previewRequired: "执行前请创建新的预览。",
  },
};
