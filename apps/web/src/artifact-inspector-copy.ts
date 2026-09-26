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
  svgUnavailable:
    "SVG preview could not be loaded. View the source to check the file, or refresh to try again.",
  imageUnavailable:
    "Image preview could not be loaded. Refresh to try again, or download the file to inspect it.",
  previewTruncated:
    "Preview is limited to 2,000 lines or 200,000 characters. Download the file to read its full contents.",
  textUnavailable:
    "Text preview is unavailable. Download the file to read its full contents.",
  textEncodingUnavailable:
    "Text encoding is invalid. Preview supports UTF-8 and UTF-16 with a byte-order mark. Download the original file to inspect it.",
  textPreviewPartial:
    "Only part of the text is shown. Download the file to read its full contents.",
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
  svgUnavailable: "SVG 预览加载失败。可切换到源码检查文件，或刷新后重试。",
  imageUnavailable: "图片预览加载失败。可刷新后重试，或下载文件检查内容。",
  previewTruncated:
    "预览最多显示 2,000 行或 200,000 个字符，可下载文件查看完整内容。",
  textUnavailable: "文本预览暂不可用，可下载文件查看完整内容。",
  textEncodingUnavailable:
    "文本编码无效。预览支持 UTF-8 及带 BOM 的 UTF-16，可下载原文件检查。",
  textPreviewPartial: "仅显示部分文本，可下载文件查看完整内容。",
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
