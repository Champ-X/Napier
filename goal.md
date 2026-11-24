# Napier 优化目标与实施路线

> 将执行、恢复、任务完成和成果交付连接成一致闭环，让 Napier 成为可信、可持续使用的长任务 Agent 工作台。

## 1. 文档范围与证据基线

- 调研与审查日期：2026-10-28。
- 文档整理日期：2026-10-30。
- 项目目录：`/Users/champ/orca/Napier`。
- 审查基线：`main @ 171e4752fdaf46c1cbfc53e6e5cad086224df458`，包含审查时已有的未提交前端与文档改动，并非仅审查该提交。
- 本文来源：当前代码审查、离线纯函数反例、正在运行的工作台观察，以及前沿 Agent 的一手资料。
- 本文状态：**实施中**。复选框仅在对应实现与验收证据齐备后勾选；局部通过不代表整体交付。
- 验证边界：前轮审查未运行全量测试、付费模型对照实验或新故障注入实验；不据此宣称成功率、性能或成本已经改善。

证据分为四类，实施时必须保留区别：

| 标记 | 含义 | 当前示例 |
| --- | --- | --- |
| 已复现 | 当前源码的确定性输入得到可检查输出 | 评测将容忍范围内的退步判为 improved；任务状态与成果选择的纯函数反例 |
| 界面观察 | 当前界面展示的真实记录，不等同于重新运行原任务 | 历史 Hermes 会话同时显示“已结算”和计划“进行中 0/5” |
| 静态判断 | 根据代码路径判断边界，尚未做完整运行复现 | 子代理使用不同调用链、整树复制限制、Web 单活跃工作区 |
| 待验证 | 优化假设，需要基线与实验支持 | 增量投影降低开销、不同模型适合不同 Harness 策略 |

审查时执行的轻量检查：

- `node scripts/check-architecture.mjs`：失败 11 项，涉及行数、复杂度和耦合；其中 `use-workspace-view-model.ts` 为 2317 行，预算为 1884 行。
- `node scripts/check-public-api.mjs`：Runtime root semantic exports 为 1897 / 1896，并有 compatibility digest 不匹配。

以上是审查快照。开始实施时重新检查，不能将其直接归因于某一项现有改动，也不能把历史检查结果当成最新状态。

2026 年 10 月各轮实现、失败样本和验收记录可在[历史实施日志](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/goal.md)查阅。G01–G07 的待办项与验收条件见第 4 节。

## 2. 保留的基础与实施原则

当前已有的能力应继续复用：

- Contracts / Runtime / Server / Web 分层，以及 SQLite 持久化事件账本。
- 主运行链的上下文编译、compaction、预算、动态工具选择、steering / follow-up 和 lifecycle。
- 工具执行的 durable journal、并发租约、权限与副作用边界、结果捕获和重放。
- 子代理 supervisor、mailbox、typed output、写入范围和结果校验。
- 记忆的 provenance、新鲜度检查和 FTS 检索。
- 真实 paired campaign、失败样本保留、配置和源码指纹、独立 grader、OpenTelemetry。
- 现有视觉语言、语义 token、活动分组、文件预览 / 源码 / diff、键盘交互与窄窗口重排。

实施原则：

1. 先修正确定性错误，再用可信评测选择架构优化。
2. 保持执行内核与事实记录稳定，将模型、上下文、规划和验证策略做成可配置、可消融的外围能力。
3. 运行结束、模型自述完成、计划状态、产物存在、独立验证通过必须分别表达。
4. 不要求所有任务创建计划；不把规划、评审或人工确认变成普遍的串行门槛。
5. 每项变化尽量形成可独立验证的纵向切片，不等待整套架构改造后才验证收益。
6. 不以调高架构预算、删除兼容检查、绕过产物完整性校验或换框架作为完成依据。
7. 保留用户已有工作区改动。隔离、合并与恢复必须显式处理脏工作树和环境漂移。

## 3. 优先级与依赖

| ID | 优先级 | 目标 | 主要收益 | 依赖与并行方式 |
| --- | --- | --- | --- | --- |
| G01 | P0 | 统一任务状态与交付物投影 | 用户能判断是否完成并找到成果 | 与 G02 独立，可并行 |
| G02 | P0 | 修正评测结论与证据类型 | 优化决策不被错误结论误导 | 先修语义，再用于质量与性能比较 |
| G03 | P1 | 主代理与子代理复用可恢复执行内核 | 能力一致、长子任务可续跑 | 先统一管线，再扩展 child 恢复 |
| G04 | P1 | 操作级对账与恢复 | 已完成工作不因后续中断被迫重做 | 可先针对一种写工具验证，无需等待 G03 完成 |
| G05-A | P1 | 可合并的子代理隔离工作区 | 真实仓库内的并行开发 | 可独立于 Web 多工作区推进 |
| G05-B | P1 | Web 多工作区后台运行 | A 项目工作时可切到 B 项目 | 与 G05-A 分别实现和验收 |
| G06-A | P1 | 线程草稿与可管理的干预队列 | 不丢意图、不串线程、干预可追踪 | 草稿可与 P0 工作并行 |
| G06-B | P2 | 统一下一步操作区与成果审阅布局 | 降低恢复、审批和成果审阅成本 | 复用 G01 的状态和成果投影 |
| G07 | P2 | 上下文、记忆与策略的测量和消融 | 在质量保持的前提下降低成本 | 质量结论依赖 G02，性能采样可提前 |

## 4. 优化目标

### G01：统一任务状态与交付物投影

**现状与依据**

- [task-narrative-projection.ts](packages/runtime/src/task-narrative-projection.ts) 审查时 L133–153：在相应分支中，存在 completed plan 或 completed run 即返回 completed；当前 active plan 尚未完成并不必然阻止该结果。
- [ConversationPlanCard.tsx](apps/web/src/ConversationPlanCard.tsx) L29 起：计划状态与完成步骤数独立展示，因此可能与顶部状态不一致。
- [task-completion-output-paths.ts](apps/web/src/task-completion-output-paths.ts) L24–43：存在 active plan 时直接返回其 outputPaths，空列表不回退；否则只取单个计划最新两项产物。
- [TaskCompletionSummary.tsx](apps/web/src/TaskCompletionSummary.tsx) L31–35：优先将 completedItems 的首项作为主要成果标题；该内容可能来自工具调用统计。

已验证的两个纯函数反例：active plan 有 pending step、run 已 completed 时返回 completed / Settled；计划已有 verified artifact，但 activePlan.outputPaths 为空时，成果列表返回空。

界面观察：历史 Hermes 分析会话的顶部、计划与成果栏呈现上述不一致；成果栏展开只有工具统计，HTML 入口留在长回答中。历史回答提到的 `Plan not found` 尚未在当前运行版本重新复现。

**目标设计**

由 Runtime 发布共享的任务结果与交付物投影，Web、CLI 和其他消费端保持同一事实口径。具体字段基于已有 contracts 收敛，不再添加一套相互独立的状态机。

- 执行状态：排队、运行、等待输入、暂停、结束、失败。
- 目标状态：未验证、部分完成、验收通过、验收失败、无法判定。
- 交付物：身份、版本、来源 Run、路径或资源引用、可访问性、验证状态与证据。
- 未完成事项：剩余要求、阻塞原因和可执行的下一步。

运行退出但目标未闭环时，明确显示“本轮结束，仍有待完成事项”；不要自动把计划勾完来消除视觉矛盾。工具次数进入过程详情。产物候选可以来自正式 artifact、工具输出和最终回答的显式交付引用，但必须经过工作区边界、存在性和来源检查；不能把所有工作区文件或任意 Markdown 链接认定为已验证成果。

**实施任务**

- [x] 梳理 Runtime 与前端已有状态投影，统一优先级和语义，覆盖无计划任务。（共享事实切片已验证；独立验收生产者仍是 G01 待办。）
- [ ] 统一成果来源、去重、版本关系和主次排序，修复空 outputPaths 屏蔽已有产物的问题。（当前文件观察、正式声明与事件metadata版本绑定已验证，晚到旧代际不回退；无计划tool-only来源、实际operation幂等／当前版本选择及非Plan预览状态传递已验证，完整历史字节仍未完成。）
- [ ] 让顶部、计划、Task 页和结果栏消费一致投影，移除重复推断。（Task validation、主要artifact卡、Task Changes和预览/下载已绑定共享当前事实与选中版本，EN/ZH窄屏验证通过；完整跨端收敛仍未验收。）
- [x] 主成果提供打开预览、下载或复制路径、验证状态、继续修改入口；辅助证据渐进展开。（已登记产物与通过边界/摘要检查的显式引用候选均完成浏览器验收；候选发现范围限制另列待办。）
- [x] 将本轮发现的状态和成果反例纳入回归用例。（含真实 SQLite、Web/CLI 与隔离浏览器检查；不代表全部 G01 验收通过。）

**验收**

- 同一任务在各界面对“执行是否结束”和“目标是否通过验收”表达一致。
- 无计划、计划工具失败、多产物、续跑产生新版本四类场景均有正确结果。
- 缺少验证证据时，不通过绿色完成标识暗示已验证成功。
- 目标：用户从当前任务界面两次点击内找到正确版本的主成果；记录测试路径及失败样例。

### G02：修正评测结论，建立可信的优化反馈

**现状与依据**

[harness-experiment-definition.ts](packages/harness-eval/src/harness-experiment-definition.ts) L197–199 将 `passed && delta !== 0` 判为 improved，而 L270–282 的 passed 允许非劣容忍范围内的退步。

已离线复现：90 对观测，baseline 成功 90/90，candidate 成功 89/90，非劣容忍度 0.02，其余指标相同，仍返回 `improved`。这是结论方向错误，不是统计显著性的争议。

另需明确证据范围：[harness-experiment-release-evidence-0.1.3.json](docs/artifacts/harness-experiment-release-evidence-0.1.3.json) 的 fixture/fixed 路由及 test_fixture 能证明合同路径；其中的 promotionReady 不能作为真实模型能力提升证据。项目已有真实 campaign，应继续复用。

**实施任务**

- [x] 按指标方向区分 improved、non_inferior、regressed、inconclusive；非零差异不等于改进。
- [x] 为主指标声明单位、方向、非劣边界和最小有效差异；在看结果前确定规则。
- [x] 增加按 case / task family 聚类的 paired bootstrap 区间，避免把同任务重复运行视为独立任务。
- [x] 将固定 baseline→candidate 顺序改为记录在案的平衡 AB/BA 顺序，控制环境与缓存影响。（通用 executor 已修复；真实 campaign 复用已存在的 paired schedule，并通过当前 CLI/调度测试。顺序平衡本身不证明缓存因果。）
- [x] 显式区分 contract_fixture、deterministic_integration、live_model、production_task，绑定可支持的结论范围。（通用实验与现有真实 campaign 均接入；旧报告仅保留其历史/描述性范围。）
- [ ] 保留失败与缺失结果，不以重试后的最佳结果替换；划分调参、回归与未参与调参的任务族。（失败留存及跨 suite 暴露 catalog／frozen binding／发布消费者门控已实现；真实目录仍为零 holdout，独立未见任务族和 live-quality 观察尚未验收。）
- [x] 将真实使用中的失败案例纳入现有 Casebook / campaign，而非另建重复系统。（保留异步队列真实失败，现有 exporter / suite 可加载，历史失败与 reference 均经当前 grader 重放。）

**验收**

- 上述 90/90→89/90 反例不再返回 improved。
- 零差异、容忍内退步、真实改进、越界退步、缺失数据具有正确结论。
- 置信区间跨越预设决策边界时，不能宣称已证实改进。
- fixture 证据不能满足 live-quality claim；结论可追溯到任务、模型、源码、策略、环境和 grader。
- 按任务族报告成功率、每个成功任务的成本、P95 时延、人工介入率、错误声称完成率。

### G03：统一主代理与子代理执行内核

**现状与依据**

- 主代理在 [agent-runtime.ts](packages/runtime/src/agent-runtime.ts) L1350 起进入统一 model-call 与 lifecycle 管线。
- 子代理在 [subagent-task-runner.ts](packages/runtime/src/subagent-task-runner.ts) L144 起单独创建 Agent，经 [subagent-model-stream.ts](packages/runtime/src/subagent-model-stream.ts) 直接调用 streamSimple；已有治理与预算，但未复用主链同一套上下文压缩和调用捕获机制。
- [run-interruption-recovery.ts](packages/runtime/src/run-interruption-recovery.ts) L275 起将重启时仍活跃的子任务标记 failed / orphaned。

**目标设计**

提取共享 RunEngine / ExecutionSession，使 child 成为独立、持久化的执行单元，拥有 runId、parentRunId、checkpoint、预算与控制消息。Supervisor 保留角色、依赖、写入范围、typed outcome 和结果验收职责。共享运行机制，不无差别复制主代理系统提示或全部权限。

**实施任务**

- [x] 列出主子调用链的能力差异和当前语义，确定最小共享执行接口。（当前能力、Run／计量／mailbox 依赖及内部 ExecutionSession 边界已成文；工具权限与调用归属反例已修复，后续共享模型／恢复实施项仍未完成。）
- [ ] 先统一模型调用、上下文编译、计量、事件与工具生命周期；保留角色专属策略。（共享模型 invocation／capture／deadline、child repair／compaction、私有 checkpoint、持久物理用量与迟到对账已完成本地功能回归；普通child compiler／extension／meter／harness及compaction编译证据已接入，普通回合thinking和overflow不确定调用停止／legacy有界恢复已验证；原生overflow成功恢复、repair完整parity、child记忆检索有效性和内部接口18/16门禁仍待完成。）
- [ ] 建立 parent-child Run 关系、控制消息寻址和父子预算核算，避免重复计费统计。（真实 child Run、单次 Task 汇总、child token／cost 后续调用检查、mailbox 稀疏消费持久化与共享父名义额度原子准入已实现；额度的适配器覆盖及取消／重启／恢复完整验收仍待完成，不将名义额度表述为物理token／invoice硬上界。）
- [ ] 持久化 child 的恢复所需状态，并接入现有 supervisor/mailbox。（私有 source／capsule-first CAS／消费证明、安全恢复授权、严格 tail 校验、原生只读 continuation 和具备完整原生证明的历史 v1 候选受限对账已实现；coder／工作区重建、未覆盖尾部及缺失证明的历史记录仍待完成。）
- [ ] 覆盖父取消、子失败、父重启、结果返回与合并期间中断的语义。

**验收**

- 主子代理产生一致可追溯的模型与工具记录，且预算和权限边界不扩大。
- 长子任务在触发 compaction 后仍可完成指定任务。
- 重启后可恢复的 child 保留有效进度；不可恢复原因明确，不仅统一标 orphaned。
- 父子并发、取消、失败和恢复不会重复交付结果或重复核算消耗。

### G04：按操作对账后恢复

**现状与依据**

[automatic-recovery.ts](packages/runtime/src/automatic-recovery.ts) L115–166 将 Run 中出现过的写操作列为自动恢复阻断因素，包括已经结算的写入。典型场景是补丁已成功落账，后续模型连接中断，整个 Run 仍不能自动续跑。

工具级 journal、租约、捕获结果重放与部分专用恢复已经存在。此目标是将它们接入 Run 恢复判断。

**实施任务**

- [ ] 基于现有 operation 记录区分：尚未执行、已确认完成、结果待对账、不可自动重放。
- [x] 选择一种可验证的本地写工具做纵向切片：已结算操作继承证据，后续步骤继续运行。（apply_patch 终态或精确结算结果与私有绑定齐备时，重查后置条件并继续原有只读恢复；当前 26 场景进程故障证据已留存；有写前意图的未结算提交也可独立对账，精确捕获的未提交主 Agent apply_patch 已在显式 verified_patches 策略下继续；其他操作和统一恢复操作区仍待完成。）
- [ ] 对不确定操作增加 postcondition / reconciliation adapter，使用文件摘要、外部记录或稳定幂等键核对。（有写前意图的 apply_patch、原生普通文件 move、独立move／patch批量对账及锁争用后的周期失主重核已实现；原生写互斥下多个settled加最后一个unfinished已验证，目录move、外部副作用及全 G04 分类恢复矩阵尚未完成。）
- [ ] 对环境漂移、权限变化、证据缺失和不可对账操作保留明确停止原因。
- [ ] 将恢复建议与用户操作区接通，说明保留了什么、从哪里继续、哪些结果仍不确定。

**故障矩阵与验收**

| 中断位置 | 独立观测依据 | 预期行为 |
| --- | --- | --- |
| 副作用发生前 | 文件 / 外部服务尚无变更 | 确认未执行后继续 |
| 副作用已发生、结果未落账 | 外部状态、摘要或计数器 | 先对账，不盲目重放 |
| 已落账、响应尚未送达 | 操作记录与真实外部状态一致 | 复用结果，不再次执行 |
| 答案或审批已保存、continuation 未启动 | 决策记录及 continuation 身份 | 幂等继续，不丢答案 |
| checkpoint 后环境内容变化 | 当前环境与基线差异 | 重新验证或明确停止 |

在上述已覆盖矩阵中，要求无重复不可幂等副作用、不把不确定结果报告为成功。按断点记录恢复率、恢复耗时、丢失进度与人工介入次数；先建立基线再确定改善目标，不承诺外部系统的普遍 exactly-once。

### G05：支持真实仓库与多项目并行

#### G05-A：可合并的隔离工作区

**现状**：[subagent-worktree-files.ts](packages/runtime/src/subagent-worktree-files.ts) 使用整树快照复制，限制为 2000 文件、32 MB、单文件 1 MB、最多 8 个写文件；L105 起的源树摘要检查会因无关文件变化而拒绝结果。

**实施任务**

- [x] 比较 Git worktree 与写时复制快照的适用条件；为非 Git 项目保留明确后备方案。（本机 Node COW 接口不可用，已实测普通复制回退与 Git + 脏内容覆盖，不声称原生 COW 收益。）
- [x] 保留并明确纳入用户未提交改动的基线，不默认只复制 HEAD。（独立私有基线；脏 Git / index / 未跟踪内容测试和真实仓库候选验证。）
- [x] 以 read-set / write-set、基线摘要和三方合并判断冲突，避免无关变更废弃整个结果。（工具读取作用域已记录；任意命令和语义工具采用保守全树依赖，非系统调用级精确追踪。）
- [x] 延续写入范围、沙箱、诊断和相关测试校验；将资源限额改为可解释的策略，不直接取消上限。（策略与实际 5k / 20k 资源曲线已记录；未改变生产 Sandbox 权限。）
- [x] 设计候选结果的持久化、合并失败处理与隔离目录回收。（冲突可重试；提交中断保留待对账而不重放；持久结果与 owner 目录分离并有保留期／容量约束。自动对账与缺失父目录事务创建尚未实现。）

**验收**：两个 coder 修改不相交文件都能交付；同文件冲突明确呈现；主工作区无关改动不使结果失效；脏工作树内容不丢失；测量 5k / 20k 文件仓库的准备时间、磁盘和内存占用。

#### G05-B：查看状态与工作区运行生命周期解耦

**现状**：[apps/server/src/index.ts](apps/server/src/index.ts) L87 起只让 active service graph 运行后台 worker；忙碌时拒绝切换。SDK 可独立创建 runtime，缺口在统一 Web 的跨项目后台执行体验。

**实施任务**

- [x] 建立按 workspaceId 管理的 Runtime Registry，保持本地部署形态。（生产 host 已接入；持久身份、自定义账本与恢复失败重试已实现。）
- [x] HTTP、SSE、控制消息和产物访问显式绑定 workspace，前端选中项不再决定 worker 是否运行。（真实 A/B 浏览器、复制 ID、预览资源与后台自动化已覆盖；Workflow 审批／扩展信任 review 已验证功能隔离，窄屏双弹窗已另修复并验证；其他 review 流程仍有边界。）
- [ ] 全局协调并发、预算和资源；活跃任务不得被普通 LRU 淘汰。（持久模型准入／额度、执行／浏览器资源容量、活跃保护、rotation 义务及完整清理凭证跨重启对账已有证据；运行中遗留资源的安全对账仍待完成。）
- [x] 空闲 runtime 可受控回收；工作区 automation / recovery 不因 UI 切换而意外暂停。（资源释放→真实回收→scoped HTTP 冷开、自定义账本和 rotation 义务已有验证；重启后 unknown 资源自动对账仍属上一项待办。）

**验收**：A 项目长任务运行时可切到 B 提交新任务；A 后台任务和自动化继续；SSE、权限和成果无串线；重启后各工作区恢复；空闲资源能够释放。

### G06：保存用户意图，简化干预和成果审阅

#### G06-A：线程草稿与干预发件箱

**现状与依据**

[use-workspace-view-model.ts](apps/web/src/use-workspace-view-model.ts) L198 起的文本、附件与 mode 为全局 useState；[use-select-thread.ts](apps/web/src/use-select-thread.ts) L41 起未保存和恢复各线程草稿。即时纠偏与排队已经实现，但缺少专门的可管理队列；已有 cancelRunControlMessage API 可复用。

**实施任务**

- [x] 按 workspace / thread 保存文本草稿与发送模式，明确新会话草稿归属。（本地浏览器持久化；真实浏览器刷新/切线程与 Hook workspace 隔离已验证。）
- [x] 遵守当前附件保存约定；如需持久保存图片，单独明确生命周期和清理机制。（图片仍只保留当前视图内存，切换/刷新清空；不新增图片持久化，延迟读取不能跨视图回填。）
- [x] 发出的消息绑定 threadId、runId、clientMessageId，复用现有服务端控制语义。（发送前持久化；真实浏览器/HTTP 丢失响应后稳定身份重试不新增排队。）
- [x] 展示发送中、已排队、模型已读取、取消或失败；不要把“已读取”暗示为“要求已完成”。（额外展示待确认；delivered 标作执行器“已消费”，不推断指令履行。）
- [x] 未消费的跟进可撤回；编辑采用明确的替换 / 取消后重发语义。（真实取消响应丢失、编辑刷新、新身份替换及消费竞争已验证。）
- [x] 异步返回先核对目标线程，断网重试使用稳定身份，避免串写和重复发送。（实际 A/B 导航、新 Run 下重试旧请求及 Hook workspace generation 覆盖。）

**验收**：刷新不丢文本草稿；切线程不带入其他任务的输入；快速切换时响应不会改错线程；断网重试不重复排队；用户可确认消息是否被消费并撤回尚未消费的消息。

#### G06-B：统一下一步操作区与成果审阅布局

**现状**：审批、浏览器确认、恢复卡与 blocker 已存在，但入口分散；部分普通问题需要先回答、再另找继续按钮。宽屏正文保持约 760px 行宽，额外空间尚未充分用于成果审阅。

**实施任务**

- [ ] 将需要选择、预算暂停、环境阻塞、可恢复和结果待对账状态聚合到清楚的下一步操作区。
- [x] 普通问题提供“回答并继续”，内部先持久化答案，再幂等启动 continuation；必要时保留仅保存答案选项。（真实浏览器/HTTP/SQLite/文件工具验证正常、请求失败、响应丢失和跨会话路径；不代表完整 G06-B 验收。）
- [ ] 恢复说明优先解释下一步行为，hash / run ID 等技术字段放详情，不增加普遍审批门槛。
- [ ] 保留阅读布局，增加可固定的预览、diff 和来源面板；宽屏空间用于审阅，不单纯拉宽正文。
- [ ] 支持定位任务、产物及版本的深链接，并恢复审阅位置。
- [ ] 延续键盘、焦点、读屏与窄窗口验证，统一 overlay / inspector 的交互原语。（Settings／Developer 对证据和导航的挂起、Escape 与焦点恢复已完成真实浏览器验收；更广泛的 inspector 交互一致性仍待完成。）

**验收**：用户能区分结束、等待选择、预算暂停和故障恢复；回答失败时保留输入且不重复 continuation；主成果可持续预览和比较版本；以真实浏览器任务测量找成果耗时、恢复成功率、干预反馈时间和误操作率。

### G07：通过测量与消融优化上下文和 Harness 策略

**现状与依据**

已有 [model-harness-profile.ts](packages/runtime/src/model-harness-profile.ts)、compaction、记忆来源与有效性检查。潜在热路径包括主循环的全 Run 事件扫描，以及 [task-memory-context.ts](packages/runtime/src/task-memory-context.ts) 和 [task-memory-index.ts](packages/runtime/src/task-memory-index.ts) 中的依赖校验与索引同步。主 invocation 准备现已完成固定基线的100k事件／1k和10k事实测量与输入游标切片，范围及不利样本见[说明](docs/invocation-context-cursor.md)；完整资源曲线、mailbox和模型质量仍未验收。

**实施任务**

- [ ] 先采样模型调用前处理耗时、SQLite 读行数、JSON 解码 CPU、RSS、文件读取次数和缓存命中。（主invocation固定smoke／100k及mailbox的100／10k／100k原生对照已记录wall／CPU／returned rows／边界RSS；SQL扫描及JSON解码CPU分项等完整范围仍待补齐。）
- [ ] 复用已有增量投影机制，为 loop guard、mailbox 等引入 watermark / typed-event cursor；保留完整 replay 作为校验基准。（沿用既有loop guard游标，主invocation新增Run级输入游标；mailbox已按类型查询并与完整replay比较，保留完整child frontier。mailbox增量cursor及更广泛负载尚未验收。）
- [ ] 记忆索引按变更维护，基于文件摘要缓存校验依赖；候选检索与有效性检查之间保持正确性。（已有按摘要更新的索引和调用内digest复用；本轮补齐唯一依赖与再次排名后的新鲜度复验，保留非原子观察及最坏读取成本边界；更广泛资源／质量验收仍待完成。）
- [ ] 按模型与任务族消融：计划开关、工具集合、上下文策略、独立验证强度、委派策略。
- [ ] 优先保留稳定提示前缀和按需工具发现，验证缓存收益与工具召回是否兼容。
- [ ] 语义 rerank 仅作为可测候选；在有证据前不增加新的向量数据库依赖。

**验收**

- 增量投影与完整 replay 的语义输出一致。
- 在 10k / 100k 事件及 1k / 10k 记忆事实规模下报告开销和资源曲线。
- 新鲜度、权限与 provenance 检查不能因性能优化失效；报告陈旧事实漏用和无关记忆注入。
- 质量与成本对比使用 G02 的协议，先定规则、再运行，保留不利结果。
- 仅在同等质量证据成立后宣称成本或延迟改善；策略不必对全部模型和任务统一启用。

## 5. 推进顺序与验证方式

### 第一阶段：修正事实表达与评测反馈

推进 G01、G02，以及可并行的 G06-A 草稿与消息归属修复。

完成条件：确定性反例已修复；任务状态与成果入口一致；评测正确区分改进和非劣；用户意图不因刷新或切线程丢失、串带。对已有历史记录提供诚实的兼容展示，不批量改写历史完成状态来制造一致性。

### 第二阶段：可恢复、可合并、可后台执行

推进 G03、G04、G05-A、G05-B。只按真实接口依赖排序；操作级恢复和隔离合并可以先做独立纵向切片。

完成条件：主子调用链一致；关键写操作通过故障矩阵；真实仓库并行修改能够合并；Web 多项目任务可持续运行，权限和事件隔离成立。

### 第三阶段：提升长期效率与使用体验

推进 G06-B、G07，使用前两阶段积累的真实失败与用户任务选择实验。

完成条件：质量保持有证据；性能变化有基线；用户更快找到成果、理解阻塞并完成恢复。CLI JSONL、文本哈希和浏览器功能回归继续保留，但不能替代真实 UI 可用性测量。

每项优化记录以下内容：变更假设、适用任务族、基线版本、模型与策略指纹、验证方法、成功与失败样本、收益和回退条件。运行与改动相匹配的检查；通过后不为形式重复全套验证。

架构维护随目标推进：按执行内核、任务投影、交互状态、工作区生命周期收敛职责；审查新增公开符号。不要仅拆小文件或更新预算数字。历史证据完整性、当前行为回归和外部环境验收分别展示其适用范围。

## 6. 一手参考资料与采用边界

| 来源 | 可采用的机制 | 采用边界 |
| --- | --- | --- |
| [Codex App Server](https://learn.chatgpt.com/docs/app-server) | thread / turn / item 协议，steering 的 expectedTurnId，事件与审批 | 借鉴寻址和生命周期，不要求替换 Napier runtime |
| [Codex as a platform，2026-08-19](https://developers.openai.com/blog/codex-as-a-platform) | 可复用 Harness 与应用产品上下文分工 | 接口能力不等于 Napier 的同条件性能证据 |
| [Anthropic Managed Agents，2026-04-08](https://www.anthropic.com/research/managed-agents) | 持久会话、Harness、执行环境分离；日志可重新查询 | 保留本地部署与现有 Ledger，不照搬云托管形态 |
| [Anthropic 长任务 Harness，2026-03-24](https://www.anthropic.com/research/harness-design-long-running-apps) | 独立验证；随模型进步移除不必要流程 | 不将多代理、多轮评审或上下文重置设为所有任务默认 |
| [Deep Agents 架构](https://github.com/langchain-ai/deepagents/blob/main/libs/ARCHITECTURE.md)与[实现](https://github.com/langchain-ai/deepagents/blob/main/libs/deepagents/deepagents/graph.py) | 同一底座上的 middleware、backend、profile 与增量状态 | 借鉴职责边界，不为对齐框架重写现有系统 |
| [Anthropic Agent 评测，2026-01-09](https://www.anthropic.com/research/demystifying-evals-for-ai-agents) | 区分能力与回归评测，重视真实结果、重复运行与 grader 校准 | 外部评测结果不能替代本项目真实任务实验 |
| [Anthropic Advanced Tool Use，2025-11-24](https://www.anthropic.com/research/advanced-tool-use) | 按需工具发现、程序化工具调用、缓存友好上下文 | Napier 已有相关基础，应做针对性消融，不重复建设 |

上述链接为 2026-10-28 调研时读取的一手资料。实施前核查对应接口和源码版本；正式实验需固定所用版本，不能将浮动 main 分支或厂商示例收益当作本项目验收结果。
