import { deepMergeCopy, getLocale, type LocaleOverride } from "./locale";

export const workspaceFileCopyEn = {
  eyebrow: "REVERSIBLE FILE OPERATIONS",
  title: "Workspace recovery",
  description:
    "Inspect entries moved to Napier-managed trash and restore them to their original workspace path.",
  safety:
    "Trash is reversible local recovery storage. Napier never exposes permanent purge or destination overwrite here.",
  refresh: "Refresh recovery items",
  noItems: "No reversible Workspace trash items belong to this Thread.",
  restore: "Restore",
  restoring: "Restoring...",
  restored: "Restored",
  originalPath: "Original path",
  scope: "Scope",
  trashedAt: "Moved to trash",
  snapshot: "Snapshot",
  evidence: "Restore evidence",
  error: "Workspace recovery items could not be loaded.",
  conflict:
    "Restore was blocked because the original path is occupied or the trash bytes changed.",
} as const;

export const workspaceFileCopyZh: LocaleOverride<typeof workspaceFileCopyEn> = {
  eyebrow: "可逆文件操作",
  title: "工作区恢复",
  description: "检查已移入 Napier 托管废纸篓的条目，并恢复到原工作区路径。",
  safety: "废纸篓是可逆的本地恢复存储。此处不提供永久清除或覆盖目标操作。",
  refresh: "刷新恢复项",
  noItems: "此会话没有可逆的工作区废纸篓条目。",
  restore: "恢复",
  restoring: "正在恢复……",
  restored: "已恢复",
  originalPath: "原始路径",
  scope: "范围",
  trashedAt: "移入废纸篓时间",
  snapshot: "快照",
  evidence: "恢复证据",
  error: "无法加载工作区恢复项。",
  conflict: "由于原始路径已被占用或废纸篓内容发生变化，恢复操作被阻止。",
};

export const workspaceFileCopy = deepMergeCopy(
  workspaceFileCopyEn,
  getLocale() === "zh" ? workspaceFileCopyZh : {},
);
