import type { LocaleOverride } from "./locale";
import type { workflowBreakpointCopyEn } from "./workflow-breakpoint-copy";

export const workflowBreakpointCopyZh: LocaleOverride<
  typeof workflowBreakpointCopyEn
> = {
  eyebrow: "执行暂停点",
  title: "工作流断点",
  body: "Ledger 已在此节点前停止。加载准确的 Manifest，检查绑定证据，然后明确地继续执行。",
  manifest: "已绑定 Manifest",
  loadManifest: "加载工作流 JSON",
  loadingManifest: "正在检查 Manifest……",
  manifestReady: "Manifest 已验证",
  continuing: "正在继续……",
  continue: "从断点继续",
  node: "节点之前",
  ordinal: "断点",
  planRevision: "计划修订",
  reachedSequence: "到达序号",
  binding: "输入绑定",
  manifestHash: "Manifest",
  waiting: "此暂停点之后尚未开始任何模型、工具或节点副作用。",
  settled: "继续操作已结算",
  nextPause: "工作流已到达下一个断点。",
  refreshHint: "结算后已刷新权威会话。",
  frames: "帧",
  statuses: {
    completed: "已完成",
    waiting: "等待中",
    paused: "已暂停",
    blocked: "已阻止",
    cancelled: "已取消",
  },
  errors: {
    manifestTooLarge: "工作流 Manifest 超过浏览器 1 MiB 上限。",
    manifestInvalid: "工作流 Manifest 无效。",
    manifestMismatch: "工作流 Manifest 与此 Ledger 断点不匹配。",
    evidenceInvalid: "断点证据不一致，无法继续。",
    running: "请等待当前会话操作结算。",
  },
};
