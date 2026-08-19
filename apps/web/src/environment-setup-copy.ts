import { deepMergeCopy, getLocale, type LocaleOverride } from "./locale";

export const environmentSetupCopyEn = {
  provider: {
    eyebrow: "LIVE PROVIDER · EXPLICIT LOCATOR",
    title: { ready: "Provider ready", pending: "Enable live reasoning" },
    checkingAria: "Checking provider locators",
    intro:
      "Napier only registers the locator you approve. Secret values stay in the server environment and never appear here.",
    preview: "PREVIEW",
    readySuffix: "is available",
    applying: "Verifying locator…",
    enable: "Enable",
    noLocator: "No locator available",
    retry: "Retry provider check",
    checking: "Checking standard environment locators…",
    statuses: {
      ready: {
        label: "Ready",
        detail: "This locator is enabled and the model is available.",
      },
      available: {
        label: "Found",
        detail:
          "The environment locator exists. Enable it explicitly for Napier.",
      },
      missing: {
        label: "Not found",
        detail: "Set this environment variable before enabling the provider.",
      },
      conflict: {
        label: "Review",
        detail: "Another active locator already controls this provider.",
      },
      unavailable: {
        label: "Unavailable",
        detail: "This provider or model is not available in this build.",
      },
    },
  },
  sandbox: {
    eyebrow: "PROCESS PLANE · PINNED OCI",
    title: { ready: "Sandbox active", pending: "Enable coding runtime" },
    checkingAria: "Checking Sandbox runtime",
    labels: {
      status: "STATUS",
      image: "IMAGE",
      source: "SOURCE",
      release: "RELEASE",
      toolchain: "TOOLCHAIN",
      preview: "PREVIEW",
    },
    active: "ACTIVE",
    toolchain: "NODE · PY · GIT · LSP · DAP",
    readyDetail:
      "The current Web Runtime now routes new process work through the verified immutable image.",
    removalTitle: "Remove Napier binding?",
    fallback: "Fallback",
    imageRetained: "image retained locally",
    boundary: "Local daemon · no remote endpoint",
    keepActive: "Keep active",
    removing: "Removing binding…",
    remove: "Remove binding",
    noBindingClose: "No binding · close",
    cannotRemoveClose: "Cannot safely remove · close",
    ready: "Coding runtime ready",
    reviewRemoval: "Review removal",
    reviewSavedBinding: "Review saved binding",
    applying: "Verifying · repairing drift if needed…",
    retry: "Retry Sandbox check",
    checking: "Inspecting the local Docker runtime and pinned image…",
    acquisitions: {
      external_release: "SIGNED RELEASE",
      packaged_source: "PINNED SOURCE",
      local_verified: "LOCAL VERIFIED",
    },
    statuses: {
      ready: {
        title: "Image found",
        detail:
          "The pinned image is present. Apply the exact preview to verify every production capability and runtime resource boundary before activation. If the toolchain has drifted, Setup rebuilds it once from the packaged source and verifies again.",
        action: "Verify & activate",
        actionable: true,
      },
      pullable: {
        title: "Official release available",
        detail:
          "Apply the exact preview to anonymously pull the reviewed immutable release, verify its source and toolchain, then run every production capability check. If the public registry is unavailable, Setup builds the same pinned source locally.",
        action: "Install & activate",
        actionable: true,
      },
      buildable: {
        title: "Build required",
        detail:
          "A local Docker daemon is ready. Napier can build the pinned toolchain, then prove its process, memory, CPU, storage, filesystem, privilege, and network limits.",
        action: "Build & activate",
        actionable: true,
      },
      runtime_unavailable: {
        title: "Docker offline",
        detail:
          "Start a supported local Docker daemon. Remote Docker endpoints are rejected.",
        action: "Docker required",
        actionable: false,
      },
      unsupported: {
        title: "Host unsupported",
        detail: "This host cannot run the pinned OCI Sandbox setup.",
        action: "Unavailable",
        actionable: false,
      },
    },
  },
} as const;

export const environmentSetupCopyZh: LocaleOverride<
  typeof environmentSetupCopyEn
> = {
  provider: {
    eyebrow: "实时提供商 · 明确定位器",
    title: { ready: "提供商已就绪", pending: "启用实时推理" },
    checkingAria: "正在检查提供商定位器",
    intro:
      "Napier 只登记你批准的定位器；密钥值保留在服务端环境中，不会显示在这里。",
    preview: "预览",
    readySuffix: "可用",
    applying: "正在验证定位器……",
    enable: "启用",
    noLocator: "没有可用定位器",
    retry: "重新检查提供商",
    checking: "正在检查标准环境定位器……",
    statuses: {
      ready: {
        label: "已就绪",
        detail: "此定位器已启用，模型可以使用。",
      },
      available: {
        label: "已找到",
        detail: "已找到环境定位器；请明确启用后再交给 Napier 使用。",
      },
      missing: {
        label: "未找到",
        detail: "请先设置此环境变量，再启用提供商。",
      },
      conflict: {
        label: "需检查",
        detail: "另一个活动定位器已在控制此提供商。",
      },
      unavailable: {
        label: "不可用",
        detail: "当前构建不支持此提供商或模型。",
      },
    },
  },
  sandbox: {
    eyebrow: "进程平面 · 固定 OCI",
    title: { ready: "Sandbox 已启用", pending: "启用编码运行环境" },
    checkingAria: "正在检查 Sandbox 运行环境",
    labels: {
      status: "状态",
      image: "镜像",
      source: "来源",
      release: "发行版",
      toolchain: "工具链",
      preview: "预览",
    },
    active: "已启用",
    toolchain: "NODE · PY · GIT · LSP · DAP",
    readyDetail:
      "当前 Web Runtime 已将新的进程任务路由到经过验证的不可变镜像。",
    removalTitle: "移除 Napier 绑定？",
    fallback: "回退",
    imageRetained: "本地镜像将保留",
    boundary: "本地守护进程 · 无远程端点",
    keepActive: "保持启用",
    removing: "正在移除绑定……",
    remove: "移除绑定",
    noBindingClose: "没有绑定 · 关闭",
    cannotRemoveClose: "无法安全移除 · 关闭",
    ready: "编码运行环境已就绪",
    reviewRemoval: "检查移除方案",
    reviewSavedBinding: "检查已保存绑定",
    applying: "正在验证；必要时修复漂移……",
    retry: "重新检查 Sandbox",
    checking: "正在检查本地 Docker 运行时和固定镜像……",
    acquisitions: {
      external_release: "签名发行版",
      packaged_source: "固定源码",
      local_verified: "本地已验证",
    },
    statuses: {
      ready: {
        title: "已找到镜像",
        detail:
          "固定镜像已存在。应用精确预览后，Napier 会验证全部生产能力与运行资源边界；若工具链发生漂移，设置流程会从内置源码重建一次并重新验证。",
        action: "验证并启用",
        actionable: true,
      },
      pullable: {
        title: "官方发行版可用",
        detail:
          "应用精确预览后，Napier 会匿名拉取已评审的不可变发行版，验证其来源和工具链，并运行全部生产能力检查；若公共镜像仓库不可用，则在本地构建同一份固定源码。",
        action: "安装并启用",
        actionable: true,
      },
      buildable: {
        title: "需要构建",
        detail:
          "本地 Docker 守护进程已就绪。Napier 可以构建固定工具链，并验证进程、内存、CPU、存储、文件系统、权限和网络限制。",
        action: "构建并启用",
        actionable: true,
      },
      runtime_unavailable: {
        title: "Docker 未运行",
        detail:
          "请启动受支持的本地 Docker 守护进程；远程 Docker 端点会被拒绝。",
        action: "需要 Docker",
        actionable: false,
      },
      unsupported: {
        title: "主机不受支持",
        detail: "此主机无法运行固定 OCI Sandbox 设置。",
        action: "不可用",
        actionable: false,
      },
    },
  },
};

export const environmentSetupCopy = deepMergeCopy(
  environmentSetupCopyEn,
  getLocale() === "zh" ? environmentSetupCopyZh : {},
);
