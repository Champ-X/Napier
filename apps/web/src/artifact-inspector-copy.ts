import { deepMergeCopy, getLocale, type LocaleOverride } from "./locale";

const en = {
  viewMode: "View mode",
  preview: "Preview",
  source: "Raw source",
  diff: "Changes",
  refresh: "Refresh",
  refreshing: "Refreshing…",
  download: "Download",
  openInTab: "Open in new tab",
  fileChanged:
    "The file changed since inspection. Refresh to preview its current version.",
  siteUnavailable: "HTML preview is unavailable. Refresh and try again.",
  downloading: "Downloading…",
  close: "Close preview",
  htmlTitle: "HTML artifact preview",
  lines: "lines",
  bytes: "bytes",
  noDiff: "No working-tree changes were recorded.",
} as const;

const zh: LocaleOverride<typeof en> = {
  viewMode: "查看方式",
  preview: "预览",
  source: "源码",
  diff: "变更",
  refresh: "刷新",
  refreshing: "正在刷新…",
  download: "下载",
  openInTab: "在新标签页打开",
  fileChanged: "文件在检查后发生了变化，请刷新后查看当前版本。",
  siteUnavailable: "HTML 预览暂不可用，请刷新后重试。",
  downloading: "正在下载…",
  close: "关闭预览",
  htmlTitle: "HTML 产物预览",
  lines: "行",
  bytes: "字节",
  noDiff: "没有记录到工作区变更。",
};

export const artifactInspectorCopy = deepMergeCopy(
  en,
  getLocale() === "zh" ? zh : {},
);
