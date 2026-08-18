import { deepMergeCopy, getLocale, type LocaleOverride } from "./locale";

/**
 * Copy for the merged workspace tree (sidebar) and the folder picker dialog.
 *
 * This lives outside the pinned copy.ts/copy.zh.ts pair, so it performs its own
 * locale merge with the same machinery. Strings that already exist in the main
 * copy object (e.g. copy.workspaceSurface.chipLabel, copy.newThread) are reused
 * at the call site instead of being duplicated here.
 */
const en = {
  // Sidebar tree
  currentBadge: "Current",
  switching: "Switching workspace...",
  // Folder picker dialog
  pickerEyebrow: "Local folder",
  pickerTitle: "Choose a workspace",
  pickerBody:
    "Pick the folder this runtime should operate on. Switching rebuilds the runtime on the new folder and shows its own sessions.",
  close: "Close",
  parentDir: "Parent directory",
  atRoot: "Filesystem root",
  empty: "No subfolders here.",
  loadError: "This folder could not be read.",
  selectThis: "Open this folder",
  selecting: "Opening...",
  alreadyHere: "Already the active folder",
  manualEntry: "Enter a path manually",
} as const;

const zh: LocaleOverride<typeof en> = {
  currentBadge: "当前",
  switching: "正在切换工作区……",
  pickerEyebrow: "本地文件夹",
  pickerTitle: "选择工作区",
  pickerBody:
    "选择此运行时要操作的文件夹。切换后会在新文件夹上重建运行时，并显示该文件夹自己的会话。",
  close: "关闭",
  parentDir: "上级目录",
  atRoot: "已到文件系统根目录",
  empty: "此文件夹下没有子文件夹。",
  loadError: "无法读取该文件夹。",
  selectThis: "打开此文件夹",
  selecting: "正在打开……",
  alreadyHere: "已是当前文件夹",
  manualEntry: "手动输入路径",
};

export const workspaceTreeCopy = deepMergeCopy(
  en,
  getLocale() === "zh" ? zh : {},
);
