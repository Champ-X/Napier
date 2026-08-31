import { deepMergeCopy, getLocale, type LocaleOverride } from "./locale";

const en = {
  sectionsLabel: "Agent context sections",
  sections: {
    runtime: { label: "Next run", description: "Model and readiness" },
    profile: { label: "Agent profile", description: "Persistent behavior" },
    packages: { label: "Revisions", description: "History and skills" },
    evidence: { label: "Evidence", description: "Credentials and usage" },
  },
  profileSectionsLabel: "Agent profile configuration groups",
  profileSections: {
    identity: {
      label: "Identity & routing",
      description: "Prompt, route and variables",
    },
    capability: {
      label: "Capabilities",
      description: "Tools, skills and delegation",
    },
    resilience: {
      label: "Resilience",
      description: "Recovery, guardrails and limits",
    },
  },
} as const;

const zh: LocaleOverride<typeof en> = {
  sectionsLabel: "智能体上下文分区",
  sections: {
    runtime: { label: "下次运行", description: "模型与就绪状态" },
    profile: { label: "智能体配置", description: "持久行为与策略" },
    packages: { label: "版本与技能", description: "修订历史与技能内容" },
    evidence: { label: "凭据与证据", description: "凭据、用量与检查点" },
  },
  profileSectionsLabel: "智能体配置分组",
  profileSections: {
    identity: { label: "身份与路由", description: "提示词、路由与变量" },
    capability: { label: "能力边界", description: "工具、技能与委派" },
    resilience: { label: "恢复与限额", description: "恢复、护栏与预算" },
  },
};

export const contextSurfaceCopy = deepMergeCopy(
  en,
  getLocale() === "zh" ? zh : {},
);
