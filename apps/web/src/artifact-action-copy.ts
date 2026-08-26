import { deepMergeCopy, getLocale, type LocaleOverride } from "./locale";

const en = {
  actions: "Artifact actions", open: "Open", opening: "Opening…",
  preview: "Preview", diff: "Diff", diffing: "Diffing…",
  copyPath: "Copy path", copied: "Copied", copyFailed: "Could not copy the artifact path.",
  previewTitle: "Artifact preview", diffTitle: "Working tree diff", close: "Close artifact inspection",
  lines: "lines", bytes: "bytes", hunks: "hunks", noDiff: "No working-tree diff was recorded for this artifact.",
} as const;

const zh: LocaleOverride<typeof en> = {
  actions: "产物操作", open: "打开", opening: "正在打开…",
  preview: "预览", diff: "差异", diffing: "正在读取差异…",
  copyPath: "复制路径", copied: "已复制", copyFailed: "无法复制产物路径。",
  previewTitle: "产物预览", diffTitle: "工作区差异", close: "关闭产物检查",
  lines: "行", bytes: "字节", hunks: "个变更块", noDiff: "该产物没有工作区差异。",
};

export const artifactActionCopy = deepMergeCopy(en, getLocale() === "zh" ? zh : {});
