import { deepMergeCopy, getLocale, type LocaleOverride } from "./locale";

/**
 * Copy registry for the Composer permission control and effective Runtime
 * readiness. Visible text resolves here so the shell stays locale-driven.
 */
export const composerCopyEn = {
  labels: {
    network: "Network",
    sandbox: "Sandbox",
    browser: "Browser",
    permission: "Permission",
  },
  values: {
    notNeeded: "Not needed",
    ready: "Ready",
    availableUnverified: "Available · unverified",
    unavailable: "Unavailable",
    staticOnly: "Static only",
    readOnlyFallback: "Read-only fallback",
    hostDirect: "Host direct",
    readOnly: "Read only",
    workspaceChanges: "Workspace changes",
    fullAccess: "Full access",
    externalConfirm: "External confirm",
    checking: "Checking",
    searchFetch: "Search + Fetch",
  },
  unverifiedSuffix: " · unverified",
  details: {
    inactive: "{label} is not required by the active task mode.",
    networkBlocked: "Search or Fetch is not exposed by the effective Runtime.",
    sandboxReadOnlyFallback:
      "No supported Sandbox provider is reported. The Runtime will expose only its negotiated safe read-only tool surface.",
    sandboxHostDirect:
      "Explicit host-direct mode is active. It provides no OS isolation.",
    browserRequired: "Browser mode requires the Browser tool to be exposed.",
    browserStaticFallback:
      "Dynamic-page Browser fallback is unavailable; static Search and Fetch can still run.",
    permissionReadOnlyFallback:
      "The configured write policy remains unchanged, but this Run will withhold mutating and process-backed capabilities until Sandbox is ready.",
    permissionObserve:
      "This Run can observe but cannot mutate the workspace or perform external side effects.",
    permissionWorkspace:
      "Workspace changes are enabled; high-impact external effects still require confirmation.",
    permissionFullAccess:
      "Workspace changes, commands, network access, and delegated work are enabled.",
    permissionExternal: "External interaction is confirmation-bound.",
    pending: "Effective capability readiness has not loaded.",
  },
  messages: {
    checking:
      "Checking effective Network, Sandbox, Browser, and permission readiness before sending.",
    unavailable: "Effective capability readiness is unavailable.",
    unavailableWithReview:
      "Effective capability readiness is unavailable; review the capability contract before sending.",
    refreshing:
      "Refreshing effective readiness for the selected permission before sending.",
    blockedPrefix: "Cannot start ",
    blockedSeparator: ": ",
    blockedItemJoin: "; ",
    blockedSuffix: ". Review or restore capabilities before sending.",
  },
  modeLabels: {
    coding: "Coding",
    research: "Research",
    data: "Data",
    browser: "Browser",
    safe_automation: "Workspace",
    read_only: "Read only",
    full_access: "Full access",
    custom: "Custom mode",
  },
  modeSummaries: {
    read_only: "Read and analyze without changing files or running commands.",
    safe_automation:
      "Edit files and run commands; external effects remain confirmation-bound.",
    full_access: "Allow files, commands, network, Browser, and Subagents.",
  },
  mode: {
    sandboxNotLoaded:
      "Sandbox readiness is not loaded yet; process tools may fail closed.",
    sandboxInvalid:
      "The saved Sandbox binding is invalid. This task can start with safe reads only; remove that exact binding, then activate Sandbox before editing or running commands.",
    sandboxUnavailable:
      "Sandbox is unavailable. This task can start with safe reads and static network access; editing, commands, Browser sessions, Extensions, and Subagents stay unavailable until Sandbox is ready.",
    policyReadOnly: "Read only",
    policyWorkspace: "Workspace changes",
    policyFullAccess: "Full access",
    policyExternal: "External interaction",
  },
  permission: {
    title: "Permissions",
    defaultHint: "Full access is the default",
    runtimeStatus: "Runtime",
    runtimeReady: "Selected permissions are ready for the next run.",
    advancedSettings: "Advanced settings",
  },
  images: {
    attach: "Attach images",
    drop: "Drop images to attach",
    selected: "Attached images",
    remove: "Remove",
    clear: "Clear images",
    ephemeral:
      "Images are sent with this run only and are not saved to history.",
    visionRequired: "Choose a vision model to use attached images.",
    errors: {
      unsupported: "Use a JPEG, PNG, GIF, or WebP image.",
      too_many: "Attach up to four images per run.",
      too_large: "Each image must be 8 MiB or smaller.",
      total_too_large: "Attached images must total 16 MiB or less.",
    },
  },
  nextRunBadge: "NEXT RUN ONLY",
} as const;

export const composerCopyZh: LocaleOverride<typeof composerCopyEn> = {
  labels: {
    network: "网络",
    sandbox: "Sandbox",
    browser: "浏览器",
    permission: "权限",
  },
  values: {
    notNeeded: "无需",
    ready: "就绪",
    availableUnverified: "可用 · 未验证",
    unavailable: "不可用",
    staticOnly: "仅静态",
    readOnlyFallback: "只读回退",
    hostDirect: "主机直连",
    readOnly: "只读",
    workspaceChanges: "工作区写入",
    fullAccess: "完全访问",
    externalConfirm: "外部需确认",
    checking: "检查中",
    searchFetch: "搜索 + 抓取",
  },
  unverifiedSuffix: " · 未验证",
  details: {
    inactive: "{label}不受当前任务模式要求。",
    networkBlocked: "有效 Runtime 未开放搜索或抓取工具。",
    sandboxReadOnlyFallback:
      "未报告任何受支持的 Sandbox 提供方。Runtime 只会开放其协商后的安全只读工具集。",
    sandboxHostDirect: "已启用显式主机直连模式，不提供系统隔离。",
    browserRequired: "浏览器模式需要开放浏览器工具。",
    browserStaticFallback:
      "动态页面的浏览器回退不可用；静态搜索与抓取仍可运行。",
    permissionReadOnlyFallback:
      "已配置的写入策略保持不变，但本次运行会在 Sandbox 就绪前暂缓一切写入和进程类能力。",
    permissionObserve: "本次运行可以观察，但不能修改工作区或产生外部副作用。",
    permissionWorkspace: "已开启工作区写入；高影响的外部副作用仍需确认。",
    permissionFullAccess: "已开启工作区写入、命令、网络访问与委派执行。",
    permissionExternal: "外部交互需要逐次确认。",
    pending: "有效能力就绪状态尚未加载。",
  },
  messages: {
    checking: "发送前正在检查有效的网络、Sandbox、浏览器与权限就绪状态。",
    unavailable: "有效能力就绪状态不可用。",
    unavailableWithReview: "有效能力就绪状态不可用；请在发送前检查能力契约。",
    refreshing: "发送前正在为所选权限刷新有效就绪状态。",
    blockedPrefix: "无法启动",
    blockedSeparator: "：",
    blockedItemJoin: "；",
    blockedSuffix: "。请在发送前检查或恢复能力。",
  },
  modeLabels: {
    coding: "编码",
    research: "研究",
    data: "数据",
    browser: "浏览器",
    safe_automation: "工作区",
    read_only: "只读",
    full_access: "完全访问",
    custom: "自定义模式",
  },
  modeSummaries: {
    read_only: "可读取和分析，但不会修改文件或执行命令。",
    safe_automation: "允许编辑文件和执行命令；高影响外部操作仍需确认。",
    full_access: "允许文件、命令、网络、浏览器与子智能体。",
  },
  mode: {
    sandboxNotLoaded:
      "Sandbox 就绪状态尚未加载；进程类工具可能会直接失败关闭。",
    sandboxInvalid:
      "保存的 Sandbox 绑定无效。本任务可以仅以安全只读方式启动；请先移除该绑定，再激活 Sandbox，然后才能编辑或执行命令。",
    sandboxUnavailable:
      "Sandbox 不可用。本任务可以仅以安全只读和静态网络访问方式启动；在 Sandbox 就绪前，编辑、命令、浏览器会话、扩展与子智能体都不可用。",
    policyReadOnly: "只读",
    policyWorkspace: "工作区写入",
    policyFullAccess: "完全访问",
    policyExternal: "外部交互",
  },
  permission: {
    title: "权限",
    defaultHint: "默认使用完全访问",
    runtimeStatus: "运行环境",
    runtimeReady: "所选权限已就绪，将持续用于后续运行。",
    advancedSettings: "高级设置",
  },
  images: {
    attach: "添加图片",
    drop: "松开以添加图片",
    selected: "已添加的图片",
    remove: "移除",
    clear: "清空图片",
    ephemeral: "图片仅随本轮发送，不会保存到会话历史。",
    visionRequired: "请选择支持视觉输入的模型后再发送图片。",
    errors: {
      unsupported: "仅支持 JPEG、PNG、GIF 或 WebP 图片。",
      too_many: "每次运行最多添加 4 张图片。",
      too_large: "单张图片不能超过 8 MiB。",
      total_too_large: "图片总大小不能超过 16 MiB。",
    },
  },
  nextRunBadge: "仅下一次运行",
};

export const composerCopy = deepMergeCopy(
  composerCopyEn,
  getLocale() === "zh" ? composerCopyZh : {},
);
