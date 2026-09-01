import type { Api, Message, Model } from "@earendil-works/pi-ai";

export type ModelHarnessFamily = "anthropic" | "openai" | "google" | "generic";
export type ModelHarnessTaskPhase =
  | "browser"
  | "coding"
  | "data"
  | "research"
  | "general";
export type ModelHarnessEnvironmentCapability =
  | "browser"
  | "workspace_write"
  | "process"
  | "code_kernel"
  | "mcp";

export interface ModelHarnessProfile {
  id: `napier.model-harness.${ModelHarnessFamily}.v1`;
  family: ModelHarnessFamily;
  promptDialect: "xml-guided" | "instruction-led" | "compact";
  maxActiveTools: number;
  defaultMaxRetries: number;
  defaultMaxRetryDelayMs: number;
}

export interface ModelHarnessRule {
  id: string;
  priority: number;
  providerPattern: string;
  modelPattern: string;
  guidance: string;
  maxActiveTools?: number;
  defaultMaxRetries?: number;
  defaultMaxRetryDelayMs?: number;
}

export interface ModelHarnessResolution extends ModelHarnessProfile {
  resolutionId: typeof MODEL_HARNESS_RESOLUTION_ID;
  ruleSetVersion: typeof MODEL_HARNESS_RULE_SET_VERSION;
  matchedRuleId: string;
  policySource: "family" | "model_rule";
  taskPhase: ModelHarnessTaskPhase;
  environmentCapabilities: ModelHarnessEnvironmentCapability[];
  guidance: string;
}

export interface ModelHarnessResolutionInput {
  model: Pick<Model<Api>, "api" | "provider" | "id">;
  messages: readonly Message[];
  tools: readonly { name: string }[];
  rules?: readonly ModelHarnessRule[];
}

export const MODEL_HARNESS_RESOLUTION_ID =
  "napier.model-harness-resolution.rules-v1.v2";
export const MODEL_HARNESS_RULE_SET_VERSION = "napier.model-harness-rules.v1";

const RULE_ID = /^[a-z][a-z0-9.-]{2,79}$/u;
const OPENAI_APIS = new Set([
  "openai-completions",
  "openai-responses",
  "azure-openai-responses",
  "openai-codex-responses",
]);
const GOOGLE_APIS = new Set(["google-generative-ai", "google-vertex"]);
const PHASE_PATTERNS: Array<[ModelHarnessTaskPhase, RegExp]> = [
  [
    "browser",
    /\b(browser|click|form|navigate|page|site|website)\b|浏览器|点击|表单|页面|网站/iu,
  ],
  [
    "research",
    /\b(citation|latest|research|search|source|web)\b|引用|最新|调研|搜索|来源/iu,
  ],
  [
    "coding",
    /\b(build|bug|clone|code|develop|file|fix|html|implement|javascript|program|refactor|repo|repository|source code|test|typescript|verify)\b|代码|源码|编写|编码|开发|生成|制作|克隆|构建|仓库|实现|文件|测试|验证|修复|重构/iu,
  ],
  [
    "data",
    /\b(analyze (?:a |the )?(?:csv|data|dataset|dataframe|spreadsheet)|csv|data|dataset|dataframe|spreadsheet|sql|sqlite|statistics)\b|数据|表格|统计/iu,
  ],
];
const INTERNAL_USER_REDIRECT_PREFIXES = [
  "Internal thinking-loop redirect:",
  "Internal execution redirect:",
  "Internal convergence redirect:",
  "Internal capability recovery redirect:",
] as const;
const CAPABILITY_TOOLS: Record<
  Exclude<ModelHarnessEnvironmentCapability, "mcp">,
  ReadonlySet<string>
> = {
  browser: new Set(["browser"]),
  workspace_write: new Set([
    "apply_patch",
    "lsp_rename_apply",
    "lsp_code_action_apply",
    "workspace_file_apply",
  ]),
  process: new Set(["run_command", "workspace_process", "node_debugger"]),
  code_kernel: new Set(["javascript_kernel", "python_kernel"]),
};

export const MODEL_HARNESS_RULES: readonly ModelHarnessRule[] = Object.freeze([
  Object.freeze({
    id: "openai-reasoning",
    priority: 100,
    providerPattern:
      "^(?:openai|azure-openai-responses|openai-codex|openrouter)$",
    modelPattern:
      "^(?:(?:openai|openrouter)[/:.])?(?:o[1-9](?:[-._].*)?|gpt-5(?:[-._].*)?)$",
    guidance:
      "Use concise plans, parallelize independent reads, and verify each mutation before concluding.",
    maxActiveTools: 20,
    defaultMaxRetries: 1,
  }),
  Object.freeze({
    id: "claude",
    priority: 100,
    providerPattern: "^(?:anthropic|amazon-bedrock|openrouter)$",
    modelPattern: "^(?:(?:anthropic|openrouter)[/:.])?claude(?:[-._].*)?$",
    guidance:
      "Keep tool inputs minimal and parallelize only independent reads; preserve explicit verification evidence.",
    maxActiveTools: 20,
    defaultMaxRetries: 1,
  }),
  Object.freeze({
    id: "gemini",
    priority: 100,
    providerPattern: "^(?:google|google-vertex|openrouter)$",
    modelPattern: "^(?:(?:google|openrouter)[/:.])?gemini(?:[-._].*)?$",
    guidance:
      "Prefer a compact tool surface, ground every write in a prior read, and verify mutations sequentially.",
    maxActiveTools: 20,
    defaultMaxRetries: 1,
  }),
  Object.freeze({
    id: "deepseek",
    priority: 100,
    providerPattern: "^(?:deepseek|openrouter)$",
    modelPattern: "^(?:(?:deepseek|openrouter)[/:.])?deepseek(?:[-._].*)?$",
    guidance:
      "Use one mutation sequence at a time, keep tool arguments exact, and verify before advancing.",
    maxActiveTools: 28,
    defaultMaxRetries: 1,
  }),
]);

interface CompiledRule {
  rule: ModelHarnessRule;
  providerPattern: RegExp;
  modelPattern: RegExp;
}

const COMPILED_MODEL_HARNESS_RULES = compileRules(MODEL_HARNESS_RULES);

export function resolveModelHarnessProfile(
  model: Pick<Model<Api>, "api">,
): ModelHarnessProfile {
  const family =
    model.api === "anthropic-messages"
      ? "anthropic"
      : OPENAI_APIS.has(model.api)
        ? "openai"
        : GOOGLE_APIS.has(model.api)
          ? "google"
          : "generic";
  const settings =
    family === "anthropic"
      ? {
          promptDialect: "xml-guided" as const,
          maxActiveTools: 32,
          defaultMaxRetries: 2,
        }
      : family === "openai"
        ? {
            promptDialect: "instruction-led" as const,
            maxActiveTools: 28,
            defaultMaxRetries: 2,
          }
        : family === "google"
          ? {
              promptDialect: "instruction-led" as const,
              maxActiveTools: 24,
              defaultMaxRetries: 2,
            }
          : {
              promptDialect: "compact" as const,
              maxActiveTools: 24,
              defaultMaxRetries: 1,
            };
  return {
    id: `napier.model-harness.${family}.v1`,
    family,
    ...settings,
    defaultMaxRetryDelayMs: 30_000,
  };
}

export function resolveModelHarnessResolution(
  input: ModelHarnessResolutionInput,
): ModelHarnessResolution {
  const base = resolveModelHarnessProfile(input.model);
  const compiled = input.rules
    ? compileRules(input.rules)
    : COMPILED_MODEL_HARNESS_RULES;
  const matched = matchingRule(input.model, compiled);
  if (matched) assertRuleNarrowsProfile(matched.rule, base);
  return {
    ...base,
    resolutionId: MODEL_HARNESS_RESOLUTION_ID,
    ruleSetVersion: MODEL_HARNESS_RULE_SET_VERSION,
    matchedRuleId: matched?.rule.id ?? "family-fallback",
    policySource: matched ? "model_rule" : "family",
    taskPhase: inferModelHarnessTaskPhase(input.messages),
    environmentCapabilities: projectModelHarnessEnvironmentCapabilities(
      input.tools,
    ),
    guidance: matched?.rule.guidance ?? familyGuidance(base.family),
    maxActiveTools: matched?.rule.maxActiveTools ?? base.maxActiveTools,
    defaultMaxRetries:
      matched?.rule.defaultMaxRetries ?? base.defaultMaxRetries,
    defaultMaxRetryDelayMs:
      matched?.rule.defaultMaxRetryDelayMs ?? base.defaultMaxRetryDelayMs,
  };
}

export function validateModelHarnessRules(
  rules: readonly ModelHarnessRule[],
): void {
  compileRules(rules);
}

export function inferModelHarnessTaskPhase(
  messages: readonly Message[],
): ModelHarnessTaskPhase {
  return inferModelHarnessTaskPhases(messages)[0] ?? "general";
}

/**
 * A user request can require more than one execution surface. The receipt keeps
 * a stable primary phase, while tool selection uses every matched phase so a
 * compound research-and-build task does not lose either half of its toolset.
 */
export function inferModelHarnessTaskPhases(
  messages: readonly Message[],
): ModelHarnessTaskPhase[] {
  const latest = messages
    .toReversed()
    .find(
      (message) =>
        message.role === "user" &&
        userText(message).trim().length > 0 &&
        !INTERNAL_USER_REDIRECT_PREFIXES.some((prefix) =>
          userText(message).startsWith(prefix),
        ),
    );
  if (!latest || latest.role !== "user") return ["general"];
  const text = userText(latest);
  const phases = PHASE_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(
    ([phase]) => phase,
  );
  return phases.length > 0 ? phases : ["general"];
}

export function projectModelHarnessEnvironmentCapabilities(
  tools: readonly { name: string }[],
): ModelHarnessEnvironmentCapability[] {
  const names = new Set(tools.map((tool) => tool.name));
  const capabilities: ModelHarnessEnvironmentCapability[] = [];
  for (const capability of [
    "browser",
    "workspace_write",
    "process",
    "code_kernel",
  ] as const) {
    if ([...CAPABILITY_TOOLS[capability]].some((name) => names.has(name))) {
      capabilities.push(capability);
    }
  }
  if (
    [...names].some(
      (name) => name === "mcp_schema_search" || name.startsWith("mcp__"),
    )
  ) {
    capabilities.push("mcp");
  }
  return capabilities;
}

export function formatModelHarnessPrompt(
  resolution: ModelHarnessResolution,
): string {
  const capabilities = resolution.environmentCapabilities.join(", ") || "none";
  return [
    `<model_harness id="${resolution.resolutionId}" base="${resolution.id}" rule="${resolution.matchedRuleId}">`,
    `Provider prompt dialect: ${resolution.promptDialect}. Model-visible tool definitions are authoritative for this turn.`,
    `Current task phase: ${resolution.taskPhase}. This is the primary phase; model-visible capabilities this turn: ${capabilities}.`,
    resolution.guidance,
    "</model_harness>",
  ].join("\n");
}

function compileRules(rules: readonly ModelHarnessRule[]): CompiledRule[] {
  const ids = new Set<string>();
  return rules.map((rule) => {
    if (!RULE_ID.test(rule.id) || ids.has(rule.id)) {
      throw new Error(
        `Model Harness rule ID is invalid or duplicated: ${rule.id}`,
      );
    }
    ids.add(rule.id);
    if (
      !Number.isSafeInteger(rule.priority) ||
      rule.priority < 0 ||
      rule.priority > 1_000
    ) {
      throw new Error(`Model Harness rule priority is invalid: ${rule.id}`);
    }
    if (
      !positiveBound(rule.maxActiveTools, 32) ||
      !nonnegativeBound(rule.defaultMaxRetries, 10) ||
      !nonnegativeBound(rule.defaultMaxRetryDelayMs, 60_000) ||
      !rule.guidance.trim() ||
      rule.guidance.length > 512 ||
      /[\r\n<>]/u.test(rule.guidance)
    ) {
      throw new Error(`Model Harness rule override is invalid: ${rule.id}`);
    }
    if (
      ![rule.providerPattern, rule.modelPattern].every(
        (pattern) =>
          pattern.length >= 2 &&
          pattern.length <= 256 &&
          pattern.startsWith("^") &&
          pattern.endsWith("$"),
      )
    ) {
      throw new Error(`Model Harness rule pattern is invalid: ${rule.id}`);
    }
    try {
      return {
        rule,
        providerPattern: new RegExp(rule.providerPattern, "u"),
        modelPattern: new RegExp(rule.modelPattern, "u"),
      };
    } catch {
      throw new Error(`Model Harness rule pattern is invalid: ${rule.id}`);
    }
  });
}

function matchingRule(
  model: Pick<Model<Api>, "provider" | "id">,
  rules: readonly CompiledRule[],
): CompiledRule | undefined {
  const provider = normalize(model.provider);
  const modelId = normalize(model.id);
  const matches = rules
    .filter(
      (candidate) =>
        candidate.providerPattern.test(provider) &&
        candidate.modelPattern.test(modelId),
    )
    .sort((left, right) => right.rule.priority - left.rule.priority);
  if (
    matches.length < 2 ||
    matches[0]!.rule.priority !== matches[1]!.rule.priority
  ) {
    return matches[0];
  }
  throw new Error(
    `Model Harness rules are ambiguous: ${matches[0]!.rule.id}, ${matches[1]!.rule.id}`,
  );
}

function assertRuleNarrowsProfile(
  rule: ModelHarnessRule,
  base: ModelHarnessProfile,
): void {
  if (
    (rule.maxActiveTools ?? base.maxActiveTools) > base.maxActiveTools ||
    (rule.defaultMaxRetries ?? base.defaultMaxRetries) >
      base.defaultMaxRetries ||
    (rule.defaultMaxRetryDelayMs ?? base.defaultMaxRetryDelayMs) >
      base.defaultMaxRetryDelayMs
  ) {
    throw new Error(
      `Model Harness rule expands its family profile: ${rule.id}`,
    );
  }
}

function familyGuidance(family: ModelHarnessFamily): string {
  return family === "anthropic"
    ? "Keep tool inputs minimal; parallelize only independent reads."
    : family === "generic"
      ? "Use one tool at a time and verify each result before continuing."
      : "Parallelize independent reads; sequence writes and verify after mutation.";
}

function userText(message: Extract<Message, { role: "user" }>): string {
  return typeof message.content === "string"
    ? message.content
    : message.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join(" ");
}

function positiveBound(value: number | undefined, maximum: number): boolean {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) && value > 0 && value <= maximum)
  );
}

function nonnegativeBound(value: number | undefined, maximum: number): boolean {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) && value >= 0 && value <= maximum)
  );
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
