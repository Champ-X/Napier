import { deepMergeCopy, getLocale, type LocaleOverride } from "./locale";

/**
 * Copy for the merged workspace tree and its native folder-picker trigger.
 *
 * This lives outside the pinned copy.ts/copy.zh.ts pair, so it performs its own
 * locale merge with the same machinery. Strings that already exist in the main
 * copy object (e.g. copy.workspaceSurface.chipLabel, copy.newThread) are reused
 * at the call site instead of being duplicated here.
 */
export const workspaceTreeCopyEn = {
  // Sidebar tree
  currentBadge: "Current",
  switching: "Switching workspace...",
  addWorkspace: "Add workspace",
  expandWorkspace: "Expand",
  collapseWorkspace: "Collapse",
  loadSessionsError: "Unable to load sessions",
  loadingSessions: "Loading sessions…",
  noSessions: "No sessions yet",
  search: "Search conversations",
  searchPlaceholder: "Search",
  events: "events",
} as const;

export const workspaceTreeZh: LocaleOverride<typeof workspaceTreeCopyEn> = {
  currentBadge: "当前",
  switching: "正在切换工作区……",
  addWorkspace: "添加工作区",
  expandWorkspace: "展开",
  collapseWorkspace: "收起",
  loadSessionsError: "无法加载会话",
  loadingSessions: "正在加载会话……",
  noSessions: "暂无会话",
  search: "搜索会话",
  searchPlaceholder: "搜索",
  events: "个事件",
};

export const workspaceTreeCopy = deepMergeCopy(
  workspaceTreeCopyEn,
  getLocale() === "zh" ? workspaceTreeZh : {},
);
