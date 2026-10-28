import { getLocale } from "./locale";

export const composerDraftCopy =
  getLocale() === "zh"
    ? {
        unavailable:
          "浏览器暂时无法保存草稿。当前输入仍在本窗口，请在关闭或刷新前复制保存。",
        recovered: "发送未确认的草稿",
        hint: "先查看会话记录，确认是否已发送。恢复此草稿会保留当前输入供切换。",
        restore: "恢复为当前草稿",
        discard: "丢弃这份草稿",
      }
    : {
        unavailable:
          "This browser cannot save drafts right now. Your input remains in this window; copy it before closing or refreshing.",
        recovered: "Drafts with unconfirmed submission",
        hint: "Check the conversation before resending. Restoring a draft keeps your current input available to switch back.",
        restore: "Restore to composer",
        discard: "Discard this draft",
      };
