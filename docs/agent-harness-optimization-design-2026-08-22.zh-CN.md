# Napier Agent Harness 优化设计

> 状态：设计评审稿  
> 分析日期：2026-08-22  
> Napier 基线：`3c9b76d`，并包含当前工作区中尚未提交的在研改动  
> 外部基线：oh-my-pi `96f42809764f0907f7d6b115eab5710de28941de`（18.0.0）；DeepSeek Harness `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（0.1.1-rc.2）

## 1. 结论摘要

Napier 已经不是一个“缺少 Agent 主循环”的早期项目。它目前最突出的优势是：本地优先、Ledger 先于展示的持久化语义、严格工具治理、可恢复目标、结构化压缩、统一 Conversation Surface、模型调用扩展链，以及完整度较高的发布与回归门禁。

2026-08-20 旧分析中最重要的三个缺口——Conversation Surface、token-aware 上下文治理、Kernel Prompt/Tool/Policy 竖切——已在随后提交中基本落地。因此，本轮不应继续把这些已完成项列为最高优先级，也不建议继续主要依靠静态提示词和工具优先级表做局部优化。

当前真正限制 Napier 继续演进的是五个结构性问题：

1. **模型路由仍是单点**：缺少按角色选择模型、跨模型/跨供应商受控回退、凭证冷却与恢复、以及逐次尝试的可归因记录。供应商限流、区域故障或单模型能力不匹配仍会直接终止一次运行。
2. **Agent 生命周期仍集中在 `AgentRuntime`**：Kernel 已有竖切，但 step、completion、tool result、loop stopping 等关键阶段尚未形成完整的可组合协议；扩展要么过早进入模型调用层，要么过深侵入 Runtime。
3. **工具面存在“配置可用、模型不可达”的缝隙**：例如 `safe_automation` 预设包含 45 个工具，而当前多类模型规则最多激活 20 个；被裁掉的第一方工具没有通用、可治理的运行时发现入口。
4. **代码模式没有受治理的工具回调桥**：JS/Python 内核与 Napier 工具系统相互隔离，复杂数据变换只能在“写代码”和“调工具”之间反复切换，无法像成熟 Harness 一样在一个持久代码会话中完成嵌套调用。
5. **实现规模开始反噬可演进性**：`store.ts`、`server/app.ts`、`contracts/index.ts` 等热点文件极大，架构门禁依赖大量豁免维持；当前测试通过不等于职责边界已经健康。

建议按下面顺序推进：

- **P0：证据驱动的 Model Route Plan 与安全回退**。先补运行失败分类、路由尝试 Ledger 与同模型 A/B 门禁，再上线受控 fallback。
- **P1：完整 Step/Tool Lifecycle Pipeline**。把 `AgentRuntime` 收缩为安全协调器，把可变策略移入有序、可卸载、可测试的扩展链。
- **P1：Tool Protocol v2 与受治理 Code Bridge**。统一能力发现、读取、编辑协议，避免继续扩大常驻 schema。
- **P1：可监督 Subagent**。增加 provider seam、typed output、live steering、durable mailbox 和明确的失败终态。
- **P2：真实 token 校准、存储域拆分与证据运营化**。

外部项目应作为机制参考，而不是代码组织模板：oh-my-pi 的运行能力很强，但同样存在超大文件；DeepSeek Harness 的生命周期与插件协议清晰，但仍是 developer preview，API 兼容性并不稳定。

## 2. 范围与方法

本分析覆盖：

- Napier 的 Runtime、Kernel、Conversation Surface、上下文压缩、模型注册与适配、工具协议、Subagent、Ledger/Store、评估与架构门禁；
- 最新 oh-my-pi 的模型角色、fallback chain、统一资源面、代码执行、Subagent Hub 与供应商差异处理；
- 最新 DeepSeek Harness 的 Cordis 插件生命周期、turn/step/tool pipeline、压缩、code mode、Subagent provider 与实验性 Agent Team；
- 当前工作区的静态检查和聚焦测试。

本轮执行结果：

- `npm run typecheck`：通过；
- Runtime 聚焦测试：6 个测试文件、62 个测试通过；
- 架构审计：1,772 个源码文件、808 个测试文件、0 个已允许依赖环；
- Prompt regression：8 个维度全部通过；
- `git diff --check`：通过。

这些结果证明当前实现处于可继续重构的稳定起点，但不证明 Harness 策略已经优于外部方案。现有真实同模型 A/B 样本量仍不足以支撑广泛的质量结论。

## 3. 当前实现画像

### 3.1 已形成的核心链路

当前主链路可概括为：

```text
User / API / Workflow
        │
        ▼
Durable Goal + Ledger
        │
        ▼
Conversation Surface ── Canonical Tool Unit / Visibility
        │
        ├── Context Projection / Structured Checkpoint
        ├── Token Pressure / Overflow Recovery
        ▼
Kernel Prompt / Tool / Policy Pipeline
        │
        ▼
Model Harness Profile ── Tool Selection / Guidance / Retry Hint
        │
        ▼
Model Call Pipeline ── prepare / around / finalize
        │
        ▼
AgentRuntime Loop ── stream / execute / progress / stop
        │
        ▼
Tool Policy + Sandbox + Receipt + Ledger
```

这套实现的独特价值在底部和两侧：Ledger、Receipt、Policy、Sandbox、Release Evidence 共同构成了比一般 Agent CLI 更完整的安全与可审计外壳。后续重构必须保留这层外壳，不允许插件绕开它。

### 3.2 8 月 20 日结论的最新状态

| 旧结论 | 当前状态 | 尚存问题 |
| --- | --- | --- |
| 缺少统一 Conversation Surface | **已完成** | 需要继续扩展到所有未来的 nested/tool/code dispatch，而不是再造第二套消息面 |
| 压缩仍可能切断 tool call/result | **核心问题已解决** | 摘要质量、估算误差和跨供应商实际 token 校准仍有空间 |
| Kernel 只是 facade | **已完成第一条竖切** | completion、step、loop、tool result lifecycle 仍主要集中在 `AgentRuntime` |
| 模型差异化 Harness 不足 | **已完成静态 model-level profile** | 规则主要由正则、静态优先级与固定上限驱动，缺少真实 A/B 校准与路由层 |
| 无 code-mode Harness | **未解决** | JS/Python 会话尚不能通过受控桥调用 Napier 工具 |

### 3.3 当前工程热点

截至本次检查，若干生产文件规模为：

| 文件 | 约行数 | 主要风险 |
| --- | ---: | --- |
| `packages/runtime/src/store.ts` | 10,818 | 状态所有权、SQLite 映射、兼容序列化和领域操作耦合 |
| `apps/server/src/app.ts` | 8,733 | 路由、鉴权、协议转换、应用装配混合 |
| `packages/runtime/src/receipt-trust-directory-subscriptions.ts` | 8,392 | 单域内部仍过度聚合 |
| `packages/contracts/src/index.ts` | 6,438 | barrel、协议定义与兼容出口集中 |
| `packages/runtime/src/extension-packages.ts` | 3,720 | 包发现、解析、验证与装配耦合 |
| `packages/runtime/src/agent-runtime.ts` | 约 3,300 | 核心循环、流、工具、治理与进度控制集中 |

架构预算目前有 94 个行数豁免、114 个复杂度豁免和 11 个公共导出豁免。门禁仍有价值，因为它能阻止继续恶化；但这些数字也说明门禁目前更像“ratchet”，尚未真正把复杂度降回正常预算。

## 4. 与最新外部实现的差异

### 4.1 能力对照

| 维度 | Napier | oh-my-pi 18.0.0 | DeepSeek Harness rc.2 | 判断 |
| --- | --- | --- | --- | --- |
| 持久化与审计 | Ledger、Goal、Receipt、release evidence 很强 | session/time travel 成熟 | session log 是模型可见信息的事实源 | **Napier 优势** |
| Turn/Step 生命周期 | model-call 扩展链成熟，Agent loop 仍集中 | session 能力丰富但实现偏重 | turn/step/tool hooks 明确且可卸载 | **需向 DSH 学协议** |
| 模型选择与容错 | 单选模型，family adapter + static profile | model roles、advisor、跨供应商 fallback、cooldown | LLM/provider 可插件化 | **明显缺口** |
| 工具面 | 工具丰富，preset + active subset | 核心工具 + `xd://` 稀有能力设备、统一 URI read | tool schema/result/presentation 分层 | **协议需升级** |
| 上下文治理 | canonical surface、结构化 checkpoint、overflow retry | time travel、memory roles | routed context、compaction、overflow recovery | **核心已追平，校准待补** |
| Subagent | typed role、证据/审查/修复、隔离 worktree | typed/async/batch、Hub、steer/revive/kill | provider seam，实验性 roster/board/mailbox | **治理强，监督弱** |
| 代码模式 | 持久 JS/Python，但无工具桥 | 多语言持久 eval + tool/subagent bridge | `run_code` 嵌套 dispatch 并入日志 | **明显缺口** |
| 安全 | policy、sandbox、approval、receipt、危险动作门禁 | 强调开发者效率，权限面更宽 | scoped guard、插件隔离 | **Napier 不应退让** |
| 评估 | 有 harness metrics/comparison/release gate | 有实战能力，公开比较口径有限 | 仍在快速演进 | **基础好，样本不足** |
| 代码可维护性 | 多个超大热点文件 | 同样有数千行至近万行热点 | 包/插件边界清楚但数量很多 | **选择性借鉴** |

### 4.2 oh-my-pi 值得借鉴的最新变化

在固定提交 `96f4280` 上，oh-my-pi 提供模型角色、重试 fallback chain、持久多语言代码执行、工具/子 Agent 回调、统一 URI 资源读取、typed subagent 和 Agent Hub。尤其值得注意的是，当前 README 已把稀有能力放到 `xd://` 设备后面，而不是继续把全部工具 schema 常驻上下文；这比旧版 BM25 工具发现更接近一个稳定的“能力目录”。详见其[固定版本 README](https://github.com/can1357/oh-my-pi/blob/96f42809764f0907f7d6b115eab5710de28941de/README.md)、[模型角色实现](https://github.com/can1357/oh-my-pi/blob/96f42809764f0907f7d6b115eab5710de28941de/packages/coding-agent/src/config/model-roles.ts)、[fallback chain 实现](https://github.com/can1357/oh-my-pi/blob/96f42809764f0907f7d6b115eab5710de28941de/packages/coding-agent/src/session/retry-fallback-chains.ts)和[代码执行说明](https://github.com/can1357/oh-my-pi/blob/96f42809764f0907f7d6b115eab5710de28941de/docs/tools/eval.md)。

另外，它显式记录供应商 endpoint 在 session、prompt cache、tool dialect、可见输出后的 retry、计费归因等方面的差异。这提示 Napier 当前仅按模型 family 调整 cache retention/output token 还不够，供应商兼容不应全部散落进 `AgentRuntime`。参考[供应商约束文档](https://github.com/can1357/oh-my-pi/blob/96f42809764f0907f7d6b115eab5710de28941de/docs/provider-endpoint-constraints.md)。

### 4.3 DeepSeek Harness 值得借鉴的协议

DeepSeek Harness 的核心价值不是工具数量，而是“模型可见即必须可由 session log 重建”的事实源，以及明确的 turn/start、prompt/tools、pre-step、step/start、request、tool pipeline、step/end、stopping、turn/end 流程。其插件 effect 在卸载时可逆，profile/bundle 负责有序组合。参考[架构说明](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/architecture.md)和[Core 子系统](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/subsystems/core.md)。

它的 Tool 子系统把参数 schema、规范化输出 schema、模型可见字段、pre/around/post execute、最终 result 与 presentation 分开；Subagent 则通过 provider seam 支持进程内、SDK、Codex、Claude 和 ACP 等实现。参考[Tool 子系统](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/subsystems/tools.md)、[Compaction 子系统](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/subsystems/compaction.md)与[Subagent 子系统](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/subsystems/subagent.md)。

DSH 的 Agent Team 仍被标为实验性，Napier 可以借其 durable roster/task board/mailbox 语义，但不应把“多 Agent 团队”直接提升为默认执行模式。参考[Agent Team 文档](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/subsystems/agent-team.md)。

## 5. 缺陷与优化设计

### A1. 缺少 Model Route Plan、角色模型与安全回退

**优先级：P0**

#### 现状

当前模型注册表最终解析出一个选中模型；model harness profile 主要决定 guidance、激活工具和有限重试提示。研究、规划、视觉、快速小任务、代码实现等角色没有独立的模型选择；429、5xx、网络失败、区域故障、凭证配额等也没有统一的跨供应商 fallback 计划。

#### 风险

- 单一供应商故障直接变成运行失败；
- 为迁就某一模型而加入的静态 prompt/tool 规则可能损害其他模型；
- Subagent 全部继承父模型，成本、延迟和能力无法按角色配置；
- 没有“第几次尝试用了谁、为什么切换、是否产生可见输出”的可靠归因。

#### 设计

新增 `ModelRouter`，输出不可变的 `ModelRoutePlan`：

```ts
interface ModelRoutePlan {
  role: ModelRole;
  candidates: ModelRouteCandidate[];
  retryPolicy: RetryPolicy;
  fallbackPolicy: FallbackPolicy;
  evidencePolicy: RouteEvidencePolicy;
}

interface ModelRouteAttempt {
  routePlanId: string;
  attempt: number;
  providerId: string;
  modelId: string;
  credentialSlotId?: string;
  startedAt: string;
  visibleOutputProduced: boolean;
  sideEffectState: "none" | "known" | "unknown";
  outcome: "success" | "retryable" | "terminal";
  failureClass?: RouteFailureClass;
}
```

首批角色建议只保留 `default`、`fast`、`reasoning`、`vision`、`subagent` 五类，避免一开始复制过多 OMP 角色。角色只参与路由，不得改变 Policy/Sandbox/Approval。

必须先定义安全重试边界：

- 尚未产生用户可见增量、尚未执行副作用工具时，可以按 failure class 重试或回退；
- 已产生可见输出时，默认禁止切换模型续写，除非供应商支持可证明等价的 resume；
- 工具副作用状态未知时必须终止并请求确认，不能自动重放；
- 每次 route attempt 必须写入 Ledger，最终消息必须归因到实际 serving model；
- 凭证只记录槽位标识和健康状态，不写入秘密。

### A2. Step/Tool 生命周期不是完整的可组合协议

**优先级：P1**

#### 现状

`AgentTurnPipeline` 已能编译 prompt、tool registry 和 policy adapter，model-call pipeline 也支持 `prepare/finalize/around`。但 `AgentKernel.runPrompt` 仍主要委托给 `AgentRuntime.runPrompt`，实际 step 循环、流式展示、工具结果处理、进度治理和停止条件仍在 Runtime 中集中完成。

此外，工具候选集合通常在一次 `runLive` 开始时编译；“Turn Pipeline”因此没有真正覆盖每一个 step 的动态能力变化。Policy adapter 当前适合单调地追加 block，但不等于完整的 tool pre/around/post/result pipeline。

#### 风险

- 新模型 dialect、fallback、tool discovery、code nested dispatch 会继续侵入 `AgentRuntime`；
- 扩展只能改模型调用外围，无法安全控制 step 边界和工具结果规范化；
- Runtime 越来越难做局部测试，错误恢复也容易跨层重复实现。

#### 设计

引入四条有序扩展链：

```text
TurnPipeline
  ├── ContextPipeline: collect → project → compact → validate
  ├── StepPipeline: prepare → request → stream → finalize → decide-next
  ├── ToolPipeline: resolve → validate → authorize → execute → normalize → present
  └── CompletionPipeline: reconcile → persist → expose → summarize
```

统一扩展接口：

```ts
interface LifecycleExtension<TContext> {
  id: string;
  order: number;
  prepare?(ctx: TContext): Promise<void>;
  around?<T>(ctx: TContext, next: () => Promise<T>): Promise<T>;
  finalize?(ctx: TContext): Promise<void>;
  dispose?(): Promise<void>;
}
```

关键约束：

- 内建 safety extension 永远位于外部扩展之外，外部扩展只能缩小权限，不能放宽；
- 一个扩展注册产生一个可撤销 effect，卸载后不留下 handler；
- 每个 step 重新解析动态 capability view，但缓存不可变 schema；
- Ledger 是 model-visible surface 的唯一事实源，扩展不能直接拼接未记录消息；
- `AgentRuntime` 最终只负责状态机推进、取消、资源预算和不可绕过的安全边界。

### A3. 工具裁剪会造成能力不可达，协议粒度也过细

**优先级：P1**

#### 现状

Napier 已按模型和任务阶段裁剪 active tools，这有效降低了 schema token。但当前规则依赖最新用户消息的正则判断和静态工具优先级。多个模型族的 `maxActiveTools` 为 20，而 `safe_automation` 预设可配置 45 个工具。被裁掉的 MCP 工具可通过部分 deferred 机制补回，但第一方工具没有统一发现协议。

同时，read/search/inspect 以及 preview/apply 等工具的协议入口较多。它们对 UI 和治理有意义，但全部作为独立模型 schema 常驻会加大选择错误和上下文成本。

#### 风险

- 模型知道任务需要某能力，但该工具不在本 step 的 schema 中，形成隐性死路；
- 最新用户消息中的短语、内部 steering 或任务阶段切换会使静态 phase 误判；
- 继续增加工具只会放大 schema token 和错误调用率；
- preview/apply 的配对状态主要依赖模型自己维持。

#### 设计：Tool Protocol v2

将工具分为三层：

1. **Essential Core**：始终可见，控制在 6–10 个稳定工具；
2. **Capability Catalog**：通过 `cap://` 或现有 URI read surface 查询能力；
3. **Resolved Tool View**：当前 step 真正注入模型的短期 schema。

建议的核心入口：

```text
read(uri, range?)
search(query, scope?)
edit(target, patch, protocol?)
execute(command_or_code, mode?)
capability(query | uri)
delegate(task, role?, output_schema?)
```

这不是立即删除所有现有工具。第一阶段保持现有 tool ID 和 receipt 兼容，只新增 `CapabilityCatalog`，让裁掉的第一方工具可被发现并在下一 step 激活。随后再把多个底层工具映射成统一模型面。

`ToolDefinitionV2` 应分离：

```ts
interface ToolDefinitionV2 {
  id: string;
  version: string;
  capabilityUris: string[];
  inputSchema: JsonSchema;
  canonicalOutputSchema: JsonSchema;
  modelVisibleOutputSchema: JsonSchema;
  concurrency: "safe" | "serialized" | "exclusive";
  sideEffect: "none" | "reversible" | "irreversible" | "unknown";
  policyTags: string[];
}
```

编辑协议不应硬编码为全局唯一方言。Router 可按模型选择 hashline、structured patch 或现有 preview/apply dialect，但最终都必须归一到同一个 `EditIntent`、Policy、Workspace Boundary、Receipt 和 Ledger。

### A4. Code Mode 与工具系统相互隔离

**优先级：P1**

#### 现状

`javascript_kernel` 支持持久会话，并主动禁止 `process`、`require`、动态 import、网络与工作区写入。这一默认面是安全的；问题不是“限制太多”，而是代码无法通过一个受治理的 callback 调用 Napier 工具。

#### 风险

- 数据整理、批量检索、并行查询等任务产生大量模型往返；
- 代码运行得到的中间值和工具结果难以形成统一 provenance；
- 若未来直接开放宿主能力，反而会绕过现有 Policy/Sandbox/Receipt。

#### 设计：Governed Code Bridge

向内核注入能力受限的 `napier` 对象：

```ts
interface CodeBridge {
  call(toolId: string, input: unknown): Promise<CanonicalToolResult>;
  capability(query: string): Promise<CapabilityDescriptor[]>;
  delegate?(request: SubagentRequest): Promise<SubagentOutcome>;
  emit?(value: unknown): Promise<void>;
}
```

每次 `napier.call` 都必须作为 nested dispatch 走完整 Tool Pipeline：参数校验、Policy、Approval、Sandbox、预算、Receipt、Ledger、结果裁剪一个不少。代码会话本身只拿短期 capability token，不拿原始凭证，也不能继承宿主进程权限。

首期仅开放无副作用和可逆工具；并行调用需要 respect `ToolDefinitionV2.concurrency`。不可逆调用仍应在代码会话外产生明确 approval checkpoint。

### A5. Subagent 有治理，但缺少持续监督面

**优先级：P1**

#### 现状

Napier 的 `delegate_task` 已具备固定角色、结构化 outcome、证据/审查/修复、数量与并发限制，coder 还能使用隔离 worktree 和显式 apply。这些能力优于很多简单的递归 Agent。

但当前 child 通常使用父级选定模型，在进程内执行，父任务以一次工具调用等待结果；缺少 provider seam、逐调用 output schema、live steering、durable mailbox、revive/kill 语义和跨实现的统一状态机。当前工作区中在研的失败上下文哈希可以抑制同一 provider schema failure 的重复重试，但它只修复一个失败循环，不替代监督协议。

#### 设计

定义统一 provider 与任务状态：

```ts
interface SubagentProvider {
  start(request: SubagentRequest, ctx: SubagentContext): Promise<SubagentHandle>;
  send(handle: SubagentHandle, message: SubagentMessage): Promise<void>;
  inspect(handle: SubagentHandle): Promise<SubagentSnapshot>;
  cancel(handle: SubagentHandle, reason: string): Promise<void>;
  collect(handle: SubagentHandle): Promise<SubagentOutcome>;
}
```

状态机建议为：

```text
queued → starting → running ↔ waiting_input → reviewing → completed
                         └──────────────→ failed / cancelled / orphaned
```

必须满足：

- 父子消息、steering、tool activity 与 worktree apply 全部写 Ledger；
- 调用方可提供 `output_schema`，provider 负责验证并在有限次数内修复；
- role 可以绑定 Model Route Plan，而不是继承父模型实例；
- 隔离写入默认不自动合并，保持当前显式 apply 安全语义；
- Agent Team/共享 task board 先作为 workflow 上层能力，不进入默认单任务主循环。

### A6. Token meter 是安全启发式，不是真实 tokenizer

**优先级：P2**

#### 现状

当前 token meter 使用 `calibrated_utf8_bytes_plus_framing_v1`：按 provider/model 采用约 2.8–3.2 bytes/token 的估算并加入 framing。这足以驱动保守的 pressure/overflow recovery，但对中文、代码、JSON schema、图片/多模态和不同供应商 tool framing 会有系统误差。

#### 设计

- 保留现有估算器作为永不失败的 fallback；
- 新增 `TokenMeterProvider`，支持官方 tokenizer、本地兼容 tokenizer 和远端 usage 校准；
- 每次模型返回 usage 时记录 `estimated_input_tokens`、`actual_input_tokens`、误差比，但不记录敏感内容；
- 按 provider/model/content class 维护滚动校准系数；
- compaction 阈值使用误差分位数而非单一固定 safety factor；
- 多模态 token 估算必须由 adapter 提供，不以 UTF-8 字节代替。

验收不应要求估算完全精确，而应要求 P95 低估误差受控，且 overflow recovery 不增加重复副作用风险。

### A7. Store、Server 与 Contracts 的职责集中

**优先级：P2，但应立即停止继续堆积**

#### 现状

`LocalStore` 同时持有巨大 `PersistedState`、SQLite 权威写入、兼容 JSON、快照、全局串行队列和大量领域操作。当前性能基准仍通过，但大量 mutation 经由同一个 state queue，未来并行 run、Subagent mailbox、route attempt 和 nested code dispatch 都会增加竞争面。

#### 设计

按领域拆分 repository，而不是按数据库表机械拆分：

```text
LedgerRepository       GoalRepository
RunRepository          ConversationRepository
ToolReceiptRepository  SubagentRepository
ModelRouteRepository   ReleaseEvidenceRepository
```

`LocalStore` 暂时保留 facade，旧 API 逐个委托到领域 repository，以兼容测试和调用方。事务边界按业务不变量设计，例如“append event + update run cursor”必须是一个事务，而不是两个 repository 独立成功。

Server 拆为 composition root、transport adapter、auth middleware、domain handlers；Contracts 则拆成 versioned protocol modules，由 `index.ts` 只做薄导出。目标不是追求更多文件，而是让模型路由、工具协议和 Subagent 状态分别拥有清晰的所有权。

### A8. 有评估基础，但缺少持续的决策闭环

**优先级：P0 的前置工作 / P2 的平台化工作**

#### 现状

Napier 已能记录 Harness effect metrics 并比较运行，也有 prompt regression 与强 release attestation。但当前缺少足够的同模型、同输入、多 seed A/B 样本；旧的少量竞争对比无法支撑“整体更好”的结论。另一方面，很多 release artifact 与源码哈希强绑定，适合作为发布证据，却不适合日常快速 Harness 实验。

#### 设计

建立两层证据：

1. **Experiment Evidence**：快速、可重复、允许候选策略迭代；
2. **Release Evidence**：固定源码、配置、模型、凭证类别和完整门禁，不降低现有强度。

新增 `HarnessExperiment`：

```ts
interface HarnessExperiment {
  id: string;
  baselineProfile: string;
  candidateProfile: string;
  caseSetDigest: string;
  modelRouteLock: ModelRouteLock;
  seeds: number[];
  primaryMetrics: string[];
  guardrailMetrics: string[];
  decisionRule: ExperimentDecisionRule;
}
```

比较必须锁定实际 serving model；发生 fallback 的样本单独分层，不能混入同模型质量结论。

## 6. 目标架构

```text
                         ┌──────────────────────────────┐
                         │     Durable Safety Shell     │
                         │ Ledger / Goal / Policy /     │
                         │ Approval / Sandbox / Receipt │
                         └──────────────┬───────────────┘
                                        │ cannot bypass
┌───────────────────────────────────────▼──────────────────────────────────────┐
│                               Run Orchestrator                              │
│ cancel · budget · recovery · route attribution · durable completion         │
├──────────────────────────────────────────────────────────────────────────────┤
│ Turn Engine                                                                  │
│  Context Pipeline → Step Pipeline → Model Router → Completion Pipeline       │
│          │               │               │                                   │
│          │               └──── Tool Pipeline ◄──── Capability Catalog        │
│          │                              ▲                                    │
│          └──── Conversation Surface     └──── Governed Code Bridge           │
├──────────────────────────────────────────────────────────────────────────────┤
│ Subagent Supervisor: providers · mailbox · steering · typed output · review │
├──────────────────────────────────────────────────────────────────────────────┤
│ Evidence Plane: route attempts · harness effects · A/B · release evidence   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 6.1 不可破坏的不变量

1. **Durable before present**：任何模型或用户可见信息都必须先可由 Ledger 重建。
2. **Safety monotonicity**：扩展可以阻止或收窄，不能扩大 Policy/Sandbox 授予的权限。
3. **No blind replay**：可见输出后或副作用未知时，不自动 fallback/retry。
4. **Serving attribution**：每一步都能回答实际由哪个 provider/model/credential slot 服务。
5. **Discovery is not authorization**：发现能力不代表被授权；动态工具仍走完整治理链。
6. **Nested dispatch parity**：Code Bridge、Subagent、Workflow 内的嵌套调用与顶层工具使用同一协议。
7. **Deterministic recovery**：重启后能从 Ledger 恢复到明确 step，而不是依赖进程内闭包。
8. **Bounded autonomy**：循环、Subagent、代码会话和 fallback 都有独立预算与明确终态。

## 7. 分阶段实施路线

### Phase 0：证据与失败分类（1–2 周）

交付物：

- `RouteFailureClass` 与现有 provider error 的归一化；
- `ModelRouteAttempt` Ledger 事件，但暂不启用跨模型 fallback；
- 10–20 个代表性 case、每个至少 3 个 seed 的同模型 Harness 实验模板；
- serving model 锁定与 fallback 样本隔离；
- dashboard/CLI 能显示工具裁剪率、估算 token 误差、重复调用和 no-new-information step。

退出标准：能证明一个 Harness 变更是改善、无差异或回退，而不是凭少量主观 transcript 判断。

### Phase 1：Model Router v1（2–4 周）

交付物：

- 五类 ModelRole；
- 同供应商备用模型、跨供应商 fallback、credential cooldown；
- 429/5xx/network/context/auth/billing/tool-dialect failure taxonomy；
- retry-before-visible 与 no-blind-replay；
- provider dialect adapter，承接 cache/session/tool streaming 等差异。

先在只读 research case 和无副作用 coding case 灰度，再进入允许写入的任务。

### Phase 2：Lifecycle Pipeline 与 Runtime 收缩（3–5 周）

交付物：

- Step、Tool、Completion 三条扩展链；
- 可撤销注册和确定性 ordering；
- tool result canonicalization 与 presentation 分离；
- 每 step 动态 capability view；
- `AgentRuntime` 中模型/工具特例逐步迁出。

迁移采用 strangler 模式：旧路径作为内建 extension 运行，先行为等价，再逐项拆分；不进行一次性重写。

### Phase 3：Tool Protocol v2 与 Code Bridge（4–6 周）

交付物：

- Capability Catalog 与 URI 查询；
- 被裁掉第一方工具的动态激活；
- ToolDefinitionV2 canonical/model-visible output；
- 编辑 dialect adapter；
- JS 首个受治理 `napier.call`，随后再扩展 Python；
- nested dispatch 的 Ledger、Receipt、Approval 与并发语义。

### Phase 4：Subagent Supervisor（3–5 周）

交付物：

- in-process provider 先接入统一接口；
- typed output schema、mailbox、steering、cancel、inspect；
- role-based model route；
- orphan recovery 与 durable terminal state；
- 保持隔离 worktree 显式 apply。

外部 Agent provider 和 Agent Team 放在接口稳定后，不作为首期交付。

### Phase 5：存储拆分与长期治理（持续）

交付物：

- repository 领域拆分；
- Server composition root/handler 拆分；
- Contracts versioned modules；
- 逐版本减少架构豁免；
- 实验趋势、回归归因和 release evidence 自动串联。

Phase 1–4 可部分重叠，整体建议按 10–14 周做首轮落地，不建议开启一场覆盖 Runtime、Store、Server 的“大爆炸重写”。

## 8. 验收指标

以下数值是初始门槛，Phase 0 应用基线数据校正：

| 目标 | 建议门槛 |
| --- | --- |
| 模型容错 | 注入 429/5xx/network 故障时，无副作用 case 的受控恢复率 ≥ 95% |
| 重试安全 | 可见输出后自动跨模型续写为 0；未知副作用自动重放为 0 |
| 路由归因 | 100% step 有实际 serving model 与 route attempt 记录 |
| Harness 决策 | 每个目标 profile 至少 30 个代表 case、3 seeds；主要指标非劣，guardrail 无显著回退 |
| 工具可达性 | 因 active schema 裁剪导致的能力不可达率 < 1% |
| 工具成本 | 常规任务 tool schema token 中位数下降 ≥ 35%，成功率不降 |
| 无效循环 | repeated/no-new-information tool call 较基线下降 ≥ 20% |
| Code Bridge | 100% nested call 经过 Policy/Sandbox/Receipt/Ledger；0 个权限扩大路径 |
| Subagent | 100% child 有 durable terminal state；取消/steering 可在下一安全边界生效 |
| Token 估算 | 各主力模型输入 token P95 低估误差 < 10%，且永远保留保守 fallback |
| 架构债 | 行数豁免从 94 逐步降至 ≤ 60；新增核心文件不得申请无截止日期豁免 |
| 热点文件 | `store.ts` < 4,000 行、`server/app.ts` < 3,000 行、`contracts/index.ts` < 2,000 行作为中期目标 |

质量 A/B 不应只看任务成功率，还应同时观察：总 token、首 token 延迟、总时长、工具调用数、重复调用、无新信息 step、人工确认次数、错误恢复次数、不可逆动作数和最终证据完整度。

## 9. 风险与非目标

- **不复制 oh-my-pi 的宿主权限面**：Napier 的安全定位不同，Code Bridge 必须复用现有治理，不能直接开放 `process`、文件系统或网络。
- **不复制 DSH 的包数量**：借鉴其 lifecycle/effect 协议，但按 Napier 领域拆分，不为“插件化”制造大量微包。
- **不把静态 prompt 规则继续当作主优化手段**：任何新的 model-specific guidance 都应带 profile 版本、实验结果和回滚条件。
- **不让 fallback 隐藏错误**：身份、计费、权限、内容安全和未知副作用错误通常应终止，而不是换供应商重试。
- **不默认启用 Agent Team**：多数任务用单 Agent + 有界 Subagent 更可控；团队协作应由明确 workflow 触发。
- **不一次性替换 Store**：先建立 repository facade 和事务契约，再迁移领域，确保 Ledger 顺序与恢复语义不变。
- **不宣称当前 benchmark 已证明优于 OMP/DSH**：现有证据基础值得保留，但外部比较必须锁定版本、模型、任务集和统计口径。

## 10. 建议立即启动的第一条竖切

第一条竖切建议命名为 **Route Evidence & Safe Failover v1**，范围控制在：

1. 归一化 provider failure；
2. 写入 `route_plan_created`、`route_attempt_started/ended` Ledger 事件；
3. 保持默认仍为单模型，不改变当前成功路径；
4. 对无可见输出、无工具副作用的 429/5xx/network failure 启用一个显式备用候选；
5. 用固定 serving model 的 case set 做 baseline/candidate A/B；
6. 在 Web/CLI 展示实际 serving model、fallback 原因和尝试次数。

这条竖切同时解决可靠性、证据和未来角色路由的数据契约问题，并为后续 Step Pipeline 提供一个真实迁移用例。相比继续增加模型正则或扩大工具列表，它更能提高系统上限，也更容易用故障注入客观验收。

## 11. 参考基线

### 本地实现

- `packages/runtime/src/agent-runtime.ts`
- `packages/runtime/src/agent-kernel.ts`
- `packages/runtime/src/agent-turn-pipeline.ts`
- `packages/runtime/src/conversation-surface.ts`
- `packages/runtime/src/model-context-token-meter.ts`
- `packages/runtime/src/model-context-token-pressure.ts`
- `packages/runtime/src/model-harness-profile.ts`
- `packages/runtime/src/model-call-pipeline.ts`
- `packages/runtime/src/model-registry.ts`
- `packages/runtime/src/model-adapters.ts`
- `packages/runtime/src/subagents.ts`
- `packages/runtime/src/store.ts`
- `docs/architecture-budget.json`

### 外部固定版本

- [oh-my-pi 固定提交](https://github.com/can1357/oh-my-pi/tree/96f42809764f0907f7d6b115eab5710de28941de)
- [oh-my-pi Task/Subagent](https://github.com/can1357/oh-my-pi/blob/96f42809764f0907f7d6b115eab5710de28941de/docs/tools/task.md)
- [oh-my-pi Eval/Code Mode](https://github.com/can1357/oh-my-pi/blob/96f42809764f0907f7d6b115eab5710de28941de/docs/tools/eval.md)
- [oh-my-pi Provider Constraints](https://github.com/can1357/oh-my-pi/blob/96f42809764f0907f7d6b115eab5710de28941de/docs/provider-endpoint-constraints.md)
- [DeepSeek Harness 固定提交](https://github.com/deepseek-ai/deepseek-harness/tree/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e)
- [DeepSeek Harness Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/architecture.md)
- [DeepSeek Harness Tools](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/subsystems/tools.md)
- [DeepSeek Harness Compaction](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/subsystems/compaction.md)
- [DeepSeek Harness Subagent](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/subsystems/subagent.md)

