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

### 实施进度（2026-10-29）

- 启动时基线为 `main @ 171e4752`；保留已有 Web、设计文档和启动脚本改动。启动核对时服务端 `8788` 与 Web `5173` 均有监听进程，尚未作为功能验收证据。
- 重新执行架构和公开 API 检查，仍为上述 11 项架构失败及 Runtime root 1897/1896、compatibility digest 不匹配；不提高预算或重写旧证据消除失败。
- 从 G02 开始：启动核对时源码确认 `passed && delta !== 0` 存在。先修方向判断、预声明统计协议和证据分级，再让后续优化复用；G01、G03–G07 的全部目标保留。
- 验收记录将逐项补充当前命令、结果与适用边界；已有历史 fixture 不作为 live-model 质量提升证据。
- G02 协议切片已实现：指标规则入实验摘要；按 case / task family 的 paired cluster bootstrap（多指标区间校正）；方向正确的 improved / non_inferior / regressed / inconclusive；AB/BA 执行与顺序校验；失败单元留存；任务族报告与证据分级。实现说明见 [harness-experiment-analysis.md](docs/harness-experiment-analysis.md)。
- 验证：`npm run test -w @napier/harness-eval` 28/28 通过（含 180 个真实 Runtime 调用、fixture provider，非真实模型质量实验）；随后增加边界浮点用例并拆分协议校验职责，`npm exec -w @napier/harness-eval -- vitest run test/harness-experiment-analysis.test.ts --maxWorkers=1` 17/17 通过；Contracts/Harness Eval build、Runtime typecheck、`git diff --check` 通过。
- 90/90→89/90 反例在新协议中为 `inconclusive`（区间越过 0.02 边界），历史协议重算为 `non_inferior`，均不再为 improved。重复同 case 的 seed 不缩窄聚类区间。零差异、方向、最小有效差异、缺失数据、分区串用、fixture 伪装 live、篡改 AB/BA 顺序均有回归覆盖。
- 旧 `harness-experiment-release-evidence-0.1.3.json` 原样校验通过；当前 CLI 显式报告 `historical_contract_only` / `promotionReady: false`。新 fixture 生成器改用新文件名，未重写历史收据。
- 最新架构检查仍为基线 11 项失败，新增统计模块的复杂度问题已修复；公开 API 仍为原有两项失败。G02 尚需接入真实 campaign 调度/报告与 Casebook 失败案例，未宣布 G02 或全目标完成。
- 本地语义提交 `32f295e4` 保存评测协议切片，未 push。
- 后续核对确认真实 campaign 的 `harness-paired-schedule.mjs` 已有 AB/BA、逐对停止和失败/缺失记录，继续复用。当前 `harness-suite` 增加任务族与 partition 的快照保留及跨分区拒绝。
- 已通过现有 `buildFailureCase` 将真实失败 `run_cef83d950d1c416096e2` 导出到 `benchmarks/harness-failures/bounded-queue-false-completion-v1`，原始报告 SHA-256 与历史证据一致。保留初始 fixture 和历史失败 observed 两份不同快照，加入 `harness-failure-regression-suite-v1.json`，保留原 case ID，不充当新增独立任务或 holdout。
- 当前离线重放确认：保留的模型输出被原 grader 判失败，现有 reference 被同一 grader 判通过。`harness-retained-failure`、`harness-suite`、`harness-paired-schedule`、`harness-paired-suite-cli`、`harness-campaign-evidence` 共 5 文件 41 测试通过；未调用付费模型，未把历史输出重放当作当前模型改进证据。
- G02 下一步：将新分析协议/证据等级接入现有 `run-harness-optimization-suite.mjs` 和 `evaluateCampaignQuality`（目前后者仍只有原 scoped quality gate）；补齐预声明统计与实际 campaign 报告绑定。G01、G03–G07 尚未验收。

### 后续推进：G02 campaign 接入

- 上一轮归类为 **progress**：已提交 `32f295e4`、`93c1081e`，本轮开始时现场确认存在且未 push。
- 现有 suite 新增 `--analysis-protocol`：在模型请求前冻结输入、模型/profile、分析规则、评测器源码摘要及既有 AB/BA 调度。真实 campaign 子进程在模型调用前校验调度位置与输入/profile/model，报告绑定原计划；保留缺失、失败和漂移，禁止把历史报告补贴标签当作预声明实验。
- `evaluateCampaignQuality` 升为 schema v2，原门槛改名 `qualityGatePassed`，单独不再给出推广资格。只有现有质量门槛与新统计/证据/分区校验同时通过的 suite 才能 `promotionReady`；fixture、未声明协议和包含 tuning 分区的结果均不能用于 live-quality claim。原 convergence/recovery 继续使用样本门槛判断收集进度，不增加审批流程。
- 新 report 使用 Runtime 共享投影记录 interventionCount；按任务族报告成功率、每成功任务的已对账模型 USD 用量成本、P95 时间、干预率和独立验收失败的 completed Run 比例。未知成本不填零，不将模型用量视为外部账单。
- 验证：8 文件 79 测试通过，包括实际 suite CLI / 文件系统 / 子进程协议的 30 case × 3 trial × 2 arm（180 个显式模拟子运行，0 模型请求）；包含绑定篡改、评测器漂移、旧报告、不平衡顺序、缺失数据、真实失败形状、tuning 分区与 fixture 冒充的回归。Harness Eval build、3 个相关 release 测试、旧收据当前 CLI 校验、`git diff --check` 通过。架构检查仍为原 11 项，无新增超限。
- 预声明规则示例：[harness-analysis-protocol-v1.json](benchmarks/harness-analysis-protocol-v1.json)。这是未执行的规则模板，不是 live-quality 改进证据。G02 仍需与 G07 一起固定真实任务族的 tuning/regression/未参与调参划分；当前不能把已有调参任务重新命名为 holdout。继续推进 G01 共享任务事实投影。

### 后续推进：G01 共享任务事实切片

- 将既有任务叙述投影收敛到浏览器安全的 `@napier/contracts/task-narrative`：Runtime 发布、Web 兼容回放和 CLI 使用同一语义。移除 Web 约 300 行重复状态推断；新增 execution / objective / remainingItems / processItems。completed Run、恢复结束、计划完成和模型 goal 自评均不自动验收整个目标；工具次数只进入过程详情。
- 修复 completed Run 掩盖 pending plan、旧 completed Run 掩盖较新的取消/失败、空 outputPaths 屏蔽产物及仅保留两件产物的问题。正式交付物跨计划去重并保留已有版本身份；当前回答明确引用的已登记产物优先。新版缺失时不回退旧 verified 文件；模型链接只影响匹配正式产物的排序，不成为新产物或验收证据。
- task.narrative 缓存版本升为 2，保存每个 Run 的显式输出引用。真实 SQLite 测试覆盖 warm/cold 与完整 detail 一致，以及无新叙述事件时 run/plan 事实变化。Web 顶部、Task 概览和结果摘要区分执行结束与目标验收；CLI 人类输出显式打印 execution/objective。文件完整性记录与目标验收分开表述，保留原预览/导出校验链。
- 验证：Runtime 2 文件 15 测试、CLI invocation/resume 2 文件 20 测试、Web 7 文件 47 测试通过；最终摘要文案调整后相关 3 文件 19 测试再次通过。Contracts/Runtime/Server/Web 构建、Web design contract、Impeccable detector、diff check 通过。架构仍为基线 11 项失败，公开 API 仍为 1897/1896 与原 compatibility digest 不匹配。
- 当前构建的隔离服务 / Chromium 检查：1440px 下点结果卡一次、320px 下开成果栏后点结果卡共两次，均打开 `interactive-report.html` 正确主产物；完整正文与 bound preview 请求确认，0 横向溢出、0 page error、未显示目标 accepted。HTML 脚本采用既有 fixture helper 同类的程序化 DOM click 验证，不声称物理指针在 iframe 内点击已验收。收据：[task-outcome-ui-2026-10-29.json](docs/artifacts/task-outcome-ui-2026-10-29.json)；复现脚本：[check-task-outcome-ui.mjs](scripts/check-task-outcome-ui.mjs)。该证据包含保留的原有 Web 工作区改动，不能当作干净 commit 的发布验收。
- 边界与后续：这是 G01 局部切片。无计划的工具/最终回答产物仍需真实路径、存在性、来源校验；跨绝对/相对路径和同 manifest 覆写的版本关系仍需补齐；accepted/rejected 尚无独立验收生产者；继续修改入口未接通。实现说明：[task-outcome-projection.md](docs/task-outcome-projection.md)。G01 全体验收及 G03–G07 保持未完成。

### 后续推进：G01 无计划候选与继续修改

- 上一切片已提交 `ad4337c5`，未 push。继续复用同一投影，缓存版本升至 3，绑定显式引用所在的 assistant message / Run。Runtime 检查工作区词法及真实路径、文件存在性与类型、符号链接、descriptor/inode/size/mtime 一致性，并读取有界内容摘要。单文件 8 MiB、总量 32 MiB、最多 30 个引用；不扫描全工作区。候选仍为 candidate/unverified，不把文件存在或摘要当作目标验收。
- 无计划、计划工具失败时的显式文件引用可以进入结果栏。绝对引用匹配已登记路径时保留正式 Artifact 绑定；缺失、越界、外部 URL、符号链接和未引用工作区文件不会被提升为成果。Web 打开候选前校验 Runtime 观察到的摘要，漂移时拒绝显示旧版本。真实文件系统变化在 warm/cold 投影均重新观察。
- 两类预览均新增“继续修改”：追加文件引用并保留已有草稿，关闭预览后将焦点放回当前线程输入框，不自动发送。原用户新 `WorkspaceEvidenceResults.tsx` 保留，只增补一行共享 narrative 属性；该文件原本未跟踪，未连带收进实现提交。
- 验证：Runtime 2 文件 17 测试、Web 7 文件 53 测试通过，Runtime/Web typecheck 及 Contracts/Runtime/Server/Web 构建通过。当前构建的正式产物、无计划/计划工具失败候选两个场景各在 1440/320px 下完成 1/2 次点击打开、正文与摘要链验证、草稿保留和焦点恢复；0 page error、0 横向溢出、0 模型请求。新收据：[task-deliverable-review-ui-2026-10-29.json](docs/artifacts/task-deliverable-review-ui-2026-10-29.json)，旧收据未覆盖。Web design contract 为 84 CSS 文件，0 色值/小字债；架构仍为原 11 项失败。
- G01 仍未整体通过：工具账本对部分路径作了隐私裁剪，尚未新增 tool-only 成果源；独立目标验收生产者、manifest 覆写的完整版本历史、超出候选发现限额的明确处理仍待补齐。G02 分区与 G03–G07 全部保留，未宣称全目标完成。

### 后续推进：G04 已结算补丁与后置条件检查

- 启动时核对 `main @ caf37eaf` 和 5 个本地提交，保留已有用户改动及 G01 未跟踪文件中的 narrative 集成行，未 push。当前先完成 G04 一种本地写工具的纵向切片，G01/G02 的剩余项及 G03/G05–G07 全部保留。
- 自动恢复不再仅按“出现过 apply_patch”阻断：要求唯一调用、完整 execution authority 日志、成功结算与终态、结果摘要及私有路径绑定。复用私有胶囊存储；恢复创建新 Run 前核对工作区、调用/input、文件后置条件和同文件连续版本链，拒绝漂移、符号链接、证据缺失或篡改。仍只允许原有 safe_read_only continuation，不扩大写权限。
- 真实进程断点暴露并修复旧 effect_indeterminate 恢复记录遗漏 `failureDefinitionSha256`、导致 descriptor hash 校验失败的问题。副作用已发生但尚未结算时仍明确为 blocked_safety，不把不确定结果当作成功。
- 当前 Runtime/SQLite/文件系统的 8 个独立进程场景通过，外部模型请求 0。固定旧 `caf37eaf` 评估器在同一实际事件流上仍因 unsafe_tool_effect 拒绝；当前已落账补丁恢复成功，内容/inode/mtime 未变、0 重复写入。四类 claim 后漂移均在模型请求前停止；另外三个早期断点仍明确停止，未冒充全矩阵自动恢复通过。单次重启/续跑耗时及源码摘要见 [settled-patch-recovery-2026-10-29.json](docs/artifacts/settled-patch-recovery-2026-10-29.json)，实现与边界见 [operation-recovery.md](docs/operation-recovery.md)。
- 相关 6 文件合计 38 个不同测试通过；Runtime typecheck、build:compile、diff check 通过。操作观测独立职责提取后将 automatic-recovery 行数预算从 807 下调为 710，架构仍为原有 11 项；公开 API 仍为 1897/1896 与 compatibility digest 不匹配。完整 Runtime build 被 release source manifest 不匹配拦截，未重写旧 manifest，也不将编译通过称为发布验收。
- G04 仍需：确认未执行的操作自动继续、未结算写操作的对账、结算后响应丢失的完整结果复用、答案/审批 continuation 幂等衔接，以及统一恢复操作区。该切片不代表 G04 或全目标完成。

### 后续推进：G04 结算后的响应丢失

- 上一轮为 **progress**：`b31d9d9a` 保存已落账补丁对账切片，本轮已现场核对，未 push。继续补齐同一 G04 矩阵，没有缩减其他目标。
- 补丁返回前复用私有胶囊存储保存精确结果，用 operation journal 已有的 effectSha256 寻址。响应尚未落账时，校验调用、完整结果、路径/input 绑定及当前文件，再继承结果事实进入恢复上下文。不会补造旧 tool.completed，不扩大通用 resultReplay 权限，仍沿用原 safe_read_only 策略。
- 当前 10 个真实进程故障场景通过：终态已落账与结算后响应丢失均能继续，文件内容/inode/mtime 保持不变、0 重写；原版本在相同事件流上仍拒绝恢复。新增结果缺失和篡改均在模型请求前停止。外部模型请求 0；当前收据：[settled-patch-result-recovery-current-2026-10-29.json](docs/artifacts/settled-patch-result-recovery-current-2026-10-29.json)。保留前两份中间收据及其类型/导入环失败边界，详见 [operation-recovery.md](docs/operation-recovery.md)。
- 本轮 5 文件 32 个不同用例通过；Runtime typecheck、build:compile、diff check 通过。修正新增类型问题、文件职责与导入环后，架构检查回到原 11 项，公开 API 仍为原 1897/1896 与 compatibility digest 不匹配；未提高预算，未重写发布 manifest。
- G04 下一步仍是未执行/未结算操作的对账、答案/审批 continuation 幂等及恢复操作区；写权限策略未扩展。G01–G07 总目标继续保持 active，不以该局部通过代替整体验收。

### 后续推进：G04 已保存答案与幂等 continuation

- 上一轮为 **progress**，现场确认 `9ba6ed3d` 和保留的用户改动，未 push。当前将新 Run/租约和 operator.decision.continued 放入同一次 SQLite 事务；保留原 Agent revision/模型/权限校验，复用状态队列与 revision CAS。
- 同答案重试返回既有记录，不重复追加事件；不同答案仍冲突。继续请求的竞争失败者及完成后重试只观察已绑定的 Run，不重放模型/工具、不重发租约、不重复 onRunCreated。观察者等待真实终态，避免 SSE 提前 done；观察者取消不取消原执行。
- 真实子进程断点覆盖答案保存后、关联事务提交前和提交后。提交前无孤立 Run，提交后 Run 与关联一同保留。后者重启时保持真实 interrupted，显式 Run 恢复会从匹配的父决策继承原答案，模型实际读取 customText 后完成；普通重试不暗自另起执行。
- 固定旧 `9ba6ed3d` 的 Store/交互仓库在子进程中复现重复答案被拒绝和未关联 Run 间隙；不是完整历史发行版对照。两个独立 Store/Runtime 并发及真实 HTTP/SSE 请求均只产生一个 continuation 和一次补丁写入，0 外部模型请求。收据：[operator-decision-recovery-2026-10-29.json](docs/artifacts/operator-decision-recovery-2026-10-29.json)，复现：[check-operator-decision-recovery.mjs](scripts/check-operator-decision-recovery.mjs)。
- 兼容检查发现并修复前一切片的 Workflow 严格输出 schema 回归：私有恢复字段保留在原完整结果，typed output 投影回公开补丁收据并验证摘要，不放宽 schema。原有 Workflow 写入测试及结果篡改回归通过。
- 相关 12 文件 150 个不同测试通过，Runtime typecheck、build:compile、diff check 通过。决策 gate 提取后 Store 行数/复杂度预算降至 3766/96；架构仍为原 11 项，公开 API 仍为 1897/1896 与 compatibility digest 不匹配；不重写历史发布 manifest。
- 此切片不等于 G04 全部验收：Workflow 审批进程故障矩阵、未执行/未结算写操作对账、统一恢复操作区及 G06-B 浏览器回答并继续仍待实现/验收；G01–G07 总目标保持 active。详细行为与限制见 [operation-recovery.md](docs/operation-recovery.md)。

### 后续推进：G06-B 普通问题回答并继续

- 新增普通问题的“回答并继续”主操作与“仅保存答案”次操作。前端先保存，再使用已有 decision 身份启动幂等 continuation；Workflow 问题仍只保存，继续执行遵守其自身协议。
- 草稿、请求状态与错误按 workspace root/dataRoot、threadId、decisionId 隔离，同一渲染中的重复点击也只发一次请求。保存失败保留输入；保存响应丢失后查询持久化记录，确认同一答案后提供继续入口；续跑失败保留已保存答案，重试不重复保存。Workspace 变化后旧操作不继续发起写入或提交旧结果。
- 使用隔离的真实 HTTP、Runtime、SQLite、apply_patch 与 Chromium 验证 8 组观察：正常提交、保存请求失败、保存响应丢失、续跑请求失败、续跑响应丢失、仅保存、后台续跑和会话切换。每个执行场景仅一个答案事件、一个 continuation、一次工具写入；6 次续跑共 18 次 fixture 模型调用，0 外部模型请求。B 会话仍可编辑，A 完成后不切回 A、不污染 B 草稿或错误。
- 107 项相关 Web 测试（5 文件）、Web typecheck/build、check:web-design、diff check 通过。七种窗口尺寸检查无页面级横向溢出，主操作通过实际点击可达性检查；320px 下 Enter 提交真实续跑成功。截图受现有滚动区域和固定壳层裁剪，不将其当作全屏内容、读屏或完整窄屏可用性验收；G06-B 的统一交互原语/可用性测量保持待办。
- 收据：[operator-decision-ui-2026-10-29.json](docs/artifacts/operator-decision-ui-2026-10-29.json)，绑定相关源码、实际服务构建摘要和七张截图；复现：[check-operator-decision-ui.mjs](scripts/check-operator-decision-ui.mjs)。详细边界见 [operator-decision-ui.md](docs/operator-decision-ui.md)。不将脚本模型当作 live-model 质量证据。
- API 决策职责移至已有 thread-run-api 模块，主 ViewModel 从本轮开始前 2317 行降至 2238；API 行数预算随实际职责提取从 1204 降至 1180。架构仍为原 11 项，未提高任何预算。问答草稿仅在挂载期间跨会话保留，刷新持久化、普通 Composer 干预队列、浏览器确认隔离、统一恢复区仍待后续；G01–G07 保持 active。

### 后续推进：G06-A 干预消息稳定身份

- 实际检查确认原 queueRunControlMessage 每次都生成新 control ID，HTTP 也不接受客户端身份；不能仅凭前端保留输入保证断网重试不重复排队。本轮先补服务端边界，普通 Composer 和发件箱前端接入仍待后续。
- QueueRunControlMessageRequest 增加可选 clientMessageId；Thread/Run/clientMessageId 共同确定稳定 control ID，规范化文本与 mode 同时核对。相同请求返回原 queued/delivered/cancelled 收据，不追加事件；即使 Run 已终止或队列已满也只返回既有状态。内容或 mode 冲突返回 HTTP 409，非法身份返回 400；新请求仍受 active Run、Workflow/demo、数量和文本大小限制。旧客户端不传身份时保持原行为。
- 真实子进程在入队持久化后、响应前 process.exit(73)，重启对账返回原 interrupted-run cancellation，没有新排队。并发重试只投递一个用户消息；模型集成确认同一 follow_up 只出现一次、两轮对话加一次记忆抽取，共 3 次 faux 模型调用。严格进度投影最初拒绝新字段的兼容缺口已修复，继续验证身份格式和内容摘要，不放宽未知字段。
- 最终 10 文件共 101 个实际执行测试通过（Runtime 61、Server 40，未运行的过滤用例不计入）。Contracts build、Runtime typecheck/build:compile、Server typecheck/build、当前 OpenAPI 生成检查、292/292 历史 HTTP operation 兼容检查和 diff check 通过。架构仍为原 11 项，公开 API 仍为原 1897/1896 与 compatibility digest 问题；没有提高预算或改写历史兼容收据。
- 绑定源码的收据：[run-control-idempotency-2026-10-29.json](docs/artifacts/run-control-idempotency-2026-10-29.json)；复现：[check-run-control-idempotency.mjs](scripts/check-run-control-idempotency.mjs)；协议说明：[run-control-idempotency.md](docs/run-control-idempotency.md)。HTTP 检查使用真实 Hono app.request 路由，不宣称是浏览器或 TCP 故障注入；0 外部模型请求。
- G06-A 的草稿刷新持久化、附件生命周期、客户端身份保存、发件箱状态/撤回/编辑、跨线程异步归属仍未整体完成，因此不勾选该目标实施项。G01–G07 总目标保持 active。

### 后续推进：G06-A 按会话保存草稿与失败归属

- 上一轮为 **progress**，现场确认本地 `cdb3bed1`、`3260775e`，未 push。本轮把普通 Composer 的文本和 steering/follow_up 模式移到 workspace root/dataRoot + 实际 threadId 对应的浏览器持久存储；新会话使用其新 threadId 的独立空草稿，未选中会话时不写入临时全局草稿。
- 切换会话和刷新保留文本/模式。延迟失败只恢复原会话；原会话已有新输入时，将失败文本保留为可恢复草稿，不覆盖新内容。恢复某份草稿时也保留当前文本，用户可显式丢弃；存储拒绝或额度不足时保留内存输入并提示复制保存。
- 图片仍只在当前会话视图内存中保存，不写入 localStorage；切换会话或 workspace 清空。带 scope generation 的 setter 阻止 A→B→A 之后旧文件读取/发送失败重新注入图片。排队响应合入线程详情前检查 threadId，错误提示也核对选中线程；完整发件箱的持久化身份/状态仍未接入。
- 7 文件共 45 个不同 Web 用例通过（含 7 个新存储/Hook/异步归属用例）。真实 HTTP 服务 + Chromium 验证多行草稿和模式刷新保留、A/B 独立、延迟队列失败保留 A 新旧文本、恢复草稿刷新保留、存储拒绝提示；7 种窗口尺寸无页面横向溢出且恢复操作可达，0 模型调用。截图修正了新增恢复区被旧布局压缩的问题，并增加显式 grid area，未覆盖用户原有 Composer 改动。
- 收据：[composer-drafts-ui-2026-10-29.json](docs/artifacts/composer-drafts-ui-2026-10-29.json)；复现：[check-composer-drafts-ui.mjs](scripts/check-composer-drafts-ui.mjs)；说明：[composer-drafts.md](docs/composer-drafts.md)。Web typecheck/build、设计契约和 diff check 通过。新增耦合由复用已有 next-run 输入组合入口消除，架构仍为原 11 项；主 ViewModel 2238→2226 行，未提高预算。
- 本轮仅勾选 G06-A 的草稿归属与既有附件生命周期两项。普通干预发送仍未使用上一轮新增的 clientMessageId；持久化发件箱、可靠重试、消费状态、撤回和取消后编辑仍待推进。G01–G07 总目标保持 active。

### 后续推进：G06-A 持久干预发件箱

- 上一轮为 **progress**，现场核对 `baf8a50e` 和保留的用户改动，未 push。普通 Composer 的运行中输入在发送前保存 workspace/thread/原 runId/clientMessageId、正文和模式；存储失败不清空输入、不发新请求。同渲染重复提交与相同身份并发重试被抑制。
- 刷新后只查账，不自动重发；网络不确定时保留原身份。重试和替换均指向原 Run，当前 Run 改变不导致转发。收据按事件序号合入，晚到 queued 不覆盖 consumed/cancelled。消费显示为“已消费”，不把执行器取走消息等同于指令已完成。
- 未消费消息可撤回；先确认取消才允许编辑。编辑稿和预分配的新身份跨刷新保留，发送替换复用新身份；消费抢先发生时拒绝撤回/替换。旧消息正文仅从与收据绑定且摘要匹配的 queued event 恢复，缺失时不伪造。查账复用原 Run 消息列表接口，不重复拉取全会话。
- 最终 7 文件 73 个 Web 测试通过（含 15 个存储/动作测试和 5 个 Hook 测试）。真实 Chromium/HTTP/Runtime/SQLite 覆盖发送与取消响应丢失、撤回编辑刷新、跨线程延迟失败、消费与撤回竞争、新 Run 开始后的旧请求重试、旧客户端撤回和 quota failure。4 次排队、3 次取消、1 次消费；fixture 模型实际只看到一次替换指令，共 3 次模型调用，外部请求 0。
- 运行中消息不再恢复成普通草稿，因而同步把原草稿检查脚本改为普通 Prompt 失败；当前新旧草稿保留、刷新、存储错误与 7 种尺寸均通过，模型调用 0。两组浏览器均无页面横向溢出，相关按钮可达；桌面/320px 截图已检查，但不宣称完整读屏/窄屏可用性或 G06-B 用户测量通过。
- 证据：[control-outbox-ui-2026-10-29.json](docs/artifacts/control-outbox-ui-2026-10-29.json)、[composer-drafts-prompt-ui-2026-10-29.json](docs/artifacts/composer-drafts-prompt-ui-2026-10-29.json)；说明与复现：[control-outbox.md](docs/control-outbox.md)。Web typecheck/build、设计契约、diff check 通过；架构仍为原 11 项，主 ViewModel 2226→2175 行，API 行数预算因职责提取下调 1180→1155。历史收据与发布 manifest 未改写。
- G06-A 实施项及上述验收已覆盖；workspace generation 隔离来自 Hook 测试，不替代 G05-B 多工作区后台运行验收。G01/G02 剩余项、G03/G04/G05、G06-B 与 G07 继续保持原范围，总目标 active。

### 后续推进：G04 未结算文件提交的独立对账

- 启动核对 `main @ f6dc602d`，原有 Web/文档/启动脚本改动保持原样，未 push。当前补齐了“文件已经提交、操作尚未结算”的窗口，包括 atomic link/rename 后、任何返回或结果胶囊保存之前的真实进程退出。
- 主 Agent 的 apply_patch 在路径锁内先保存写前意图及账本绑定，再重新检查前置条件并提交目标。意图包含原 Run/call/input、私有路径摘要、临时文件 dev/ino 和实际执行 PID；存储失败不提交文件。重启要求原执行进程已退出，取得目标锁，核对内容及文件身份。仅同内容的新文件、证据缺失/损坏、符号链接、工作区漂移和活跃锁均不能冒充已提交操作。
- 原 executor 的 effect_indeterminate 封锁记录、独立文件对账证明和 Run interrupted 状态在一个 SQLite 事务中提交；后续旧结算/结果/续租仍被拒绝，不补造 tool.completed。恢复创建新 Run 前再次检查意图、最新文件及版本链，保持 safe_read_only 权限，明确写后诊断可能缺失。
- 真实 Runtime/SQLite/文件系统 26 个进程场景通过（原 10 + 新 16，0 外部模型请求）：create/replace 原子提交后可继续且文件 inode/mtime 不变、0 重写；写前未提交仍停止；活跃 writer 释放文件锁后仍不能对账，进程退出后才通过；事务回滚及重复启动、claim 后同内容替换均有覆盖。收据：[unsettled-patch-recovery-current-2026-10-29.json](docs/artifacts/unsettled-patch-recovery-current-2026-10-29.json)，复现与具体边界见 [operation-recovery.md](docs/operation-recovery.md)。旧收据未覆盖，固定旧评估器对照不声称完整历史版本或 live-model 改善。
- 相关 11 文件 104 个不同用例通过；最终工具配置收敛后重跑进程矩阵和受影响兼容检查。Contracts build、Runtime typecheck/build:compile、diff check 通过；架构仍为原 11 项，公开 API 仍为 1897/1896 与 compatibility digest 两类失败。tools.ts 预算从 1776 下调为 1766；未提高预算或重写旧发布 manifest，编译不等于发布验收。
- G04 仍需确认未执行操作的自动继续、Workflow 审批进程矩阵、统一恢复说明与操作区；其他工具没有获得自动写重放权。G01–G07 总目标保持 active，未降低或删减验收标准。

### 后续推进：G04 Workflow 审批原请求重试

- 上一轮为 **progress**：现场核对 `main @ 610a8ef5`，保留原有 Web/文档/启动脚本改动，未 push。沿用底层已完成的答案规范化去重和 Run/continuation 原子事务，补齐嵌入式审批接口只接受 pending 导致的重试缺口。
- `answerAndResume` 接受绑定的原始、已回答或当前决策快照；同答案原请求在 answered/continued 状态可继续，不同答案冲突。及时保存的答案过期后仍可重试，已过期的 pending 答案拒绝保存。复用 Workflow ledger 校验 manifest、Agent revision、节点 input/schema/attempt、requestedEventSeq、requestSha256 与期限；不因重试放松审批证据。
- 真实独立进程重试暴露了实例内 activeThreads 无法阻止多个驱动者的问题。现在同一 SQLite ledger 按 Thread 原子认领进程锁；恢复请求等待并可取消，其他 Thread 和同一 Workflow 内并行节点保持运行。仅在原 PID 不存在时接管，先复用 Run 对账再重读上下文。无 TTL 抢占活进程；PID 复用可保守阻塞，范围仅本机。schema 7→8 新增锁表，事件不改写，旧 Runtime 不能直接读取升级后的数据库；初始化 busy_timeout 前移到首次 schema 查询之前。
- 已执行 approve/reject 各 7 个真实进程退出断点、barrier 同步的跨进程竞争、SIGSTOP 活 owner 等待与 SIGKILL 后接管，以及固定旧 `610a8ef5` 审批 API 的同一已保存答案对照。没有丢失答案、孤立 continuation 或重复下游写入；拒绝分支不写文件。空模型注册表，外部模型调用 0。当前收据：[workflow-approval-recovery-verified-2026-10-29.json](docs/artifacts/workflow-approval-recovery-verified-2026-10-29.json)，复现：[check-workflow-approval-recovery.mjs](scripts/check-workflow-approval-recovery.mjs)。单次重启/续跑采样不作为模型质量或生产延迟改善证据。
- 提交前新增反例还发现已回答快照在 continued 后重试会误报 stale，已修复并保留前一份中间收据。一次早期证据封装 exit 1 未保留具体失败项，已改进失败输出；最终验证与边界见 [operation-recovery.md](docs/operation-recovery.md)。
- 验证：当前收据 3 文件 29 测试通过，连同 Workflow 执行/恢复/重试/并行节点、实验/断点/循环/成果结算和 SDK 回归，共 14 文件 156 个不同测试通过。Runtime typecheck / build:compile、diff check 通过；架构回到原 11 项，公开 API 仍为 1897/1896 与原 compatibility digest 不匹配。未提高预算，未重写 release source manifest；本轮不是完整发布验收。
- G04 仍需 before-effect / before-target-commit 的确认未执行后继续、任意下游工具中断的适配与统一恢复操作区。G01–G07 其余目标全部保留；本切片不代表 G04 或全目标通过。

### 后续推进：G04 确认未提交后执行原补丁

- 从 `1671a715` 和前轮未提交草稿继续，保留用户 Web/文档/启动脚本改动。新增显式 `verified_patches` 策略；旧 `safe_read_only` 不扩大写权限。精确输入进入私有胶囊，账本只保存摘要；v2 prepared 后必须先持久化 commit_started 才能提交目标。原 Run fence 与 not_committed 证明原子落账，不用“文件没变化”推断从未执行。
- 恢复计划与新 Run/租约原子保存，按原调用和最近执行继承未开始工作或已结算结果；确定性补丁阶段走共享 authority/并发/结算链，再让模型用只读工具继续。冻结定义、原权限与当前权限、文件前置条件及所需 Sandbox 状态必须一致；原调用不补造成功终态。补充死进程资源租约清理，只接受本机 owner 的 ESRCH 证据，不提前回收活/未知 owner。
- 当前 [31 用例故障收据](docs/artifacts/verified-patch-recovery-verified-2026-10-29.json) 覆盖创建/替换的早期断点、恢复自身五种再次中断、响应丢失、双进程竞争、同文件版本链和环境/权限/输入拒绝。0 重复目标提交，0 外部模型请求；有界 fixture 模型只读 continuation 通过，不作为 live-model 质量提升。保留此前 [30 用例源码快照](docs/artifacts/verified-patch-recovery-2026-10-29.json)，其后补上 Sandbox 门槛。复现脚本和边界见 [operation-recovery.md](docs/operation-recovery.md)。
- 相关 13 个 Runtime 文件共 125 个不同用例通过；Server 8 个、Web 10 个配置/投影用例通过。Contracts、Runtime 编译/typecheck、Web/SDK/Server typecheck、Web build/design contract 通过。架构现为 10 项既有失败，原 run-config 超限随职责收敛消除，预算仅下调；公开 API 仍为 1897/1896 与原 digest 不匹配，未重写历史发布 manifest。
- G04 尚需统一恢复操作区和全分类验收；此能力限于精确捕获的主 Agent apply_patch，模型后续仍只读，Workflow 待执行写入、自定义 lifecycle 扩展和其他写工具尚未完成。G01/G02 剩余项及 G03/G05–G07 全部保留，总目标仍为 active。

### 后续推进：G04 恢复操作记录与受限核查入口

- 从 `c0671ae1` 继续，保留用户已有 Web/文档/启动脚本改动。本轮 Runtime 发布 `recoveryCheckpoint`，使用已有严格补丁证明区分已结算、确认未提交、需要对账和不可自动重放。历史账本事实与当前文件验证分开；不返回私有补丁正文/路径。最多展示 128 条、统计覆盖完整检查范围；超过 10,000 事件或事件身份冲突停止分类。
- Web 恢复区展示分类、停止原因和检查点收据，连接执行轨迹、已有决策区与计划概览。含副作用或证据不足时提供“只读核查”；新增可选 `readOnly: true` 请求在 Runtime 使用受限工具表，待执行写入不会自动执行。原手动 API 默认行为及 `verified_patches` 自动恢复策略保持独立。
- 核查结束以既有 `failed / partial` 协议保存，保留原操作父链，不把核查结束当作任务完成；不触发原目标评估/自动续跑，核查失败也不改写原目标。手动入口及创建 Run 事务均拒绝被后续运行取代的检查点。Web 抑制即时重复点击，失败后刷新原会话账目，延迟错误不转移到当前会话。
- 共 14 文件、101 个不同测试通过，包含原有自动/已验证补丁/未结算补丁/决策恢复回归、新投影的 5 个真实进程退出场景、只读工具拒绝、重复创建与目标状态保护。真实 HTTP/SQLite/Chromium 验证提交后退出的补丁保留、无目标重写、旧检查点重试拒绝、部分状态与父记录保留、键盘 disclosure 和 7 种窗口尺寸的实际按钮命中。当前收据：[recovery-operations-ui-current-2026-10-29.json](docs/artifacts/recovery-operations-ui-current-2026-10-29.json)，复现与边界见 [operation-recovery.md](docs/operation-recovery.md)。2 次 faux 模型调用，0 外部模型请求。
- Contracts/Runtime/Server/Web 编译或 typecheck、SDK typecheck、Web design contract 通过；OpenAPI 当前生成物及 292/292 历史 operation 兼容通过。主 ViewModel 2175→2148 行，架构仍为 10 项既有失败；公开 API 仍为 1897/1896 与既有 digest 不匹配。未提高预算、未改写历史 release manifest，构建不等同发布验收。
- 边界：尚未在此区接通完整 Workflow 恢复变更操作、通用写工具、自定义 lifecycle、SDK/CLI 新只读开关和历史活动卡终态统一；完整分类验收与 G04 总体验收未勾选。G01/G02 剩余项及 G03/G05–G07 原范围继续保留，整体仍为 active。本轮属于 **progress**。

### 后续推进：G04 持久定义与 Workflow 恢复入口

- 上一轮为 **progress**，本轮现场核对 `32b3e14a` 与 17 个本地领先提交，保留已有用户前端/文档/启动脚本改动，未 push。继续保持 G01–G07 全部目标，没有以恢复入口代替完整目标验收。
- 新 Workflow 在创建执行 Plan 和运行节点前，将验证后的原 manifest 保存到既有私有胶囊存储；按内容摘要寻址、0600 文件权限、有明确数量/容量上限。恢复时绑定原启动记录、Plan、Agent revision 与定义；旧定义缺失、篡改或证据冲突时停止，不推断重建。
- 新增 `GET/POST /api/threads/:threadId/workflows/:planId/recovery`。POST 只接收检查点摘要，在现有跨进程 Workflow 锁内复核并持久消费该检查点，再使用原节点恢复协议。并发和旧请求重试不会放行新的断点；已消费请求返回 409，客户端刷新真实进度，不宣称同请求结果重放。原带 manifest 的 Workflow API 保持兼容。
- Task 概览接通原定义恢复、保存审批后继续和断点继续；移除该区域的通用 Agent 提示续跑与重复待回答提示。Web 按 workspace/thread/plan 隔离异步结果，抑制即时重复点击，响应不确定时查询持久状态，保留步骤完成与任务验收的区别。
- 当前真实 HTTP/SQLite/Chromium 证据覆盖浏览器保存答案、提交成功后丢弃响应、两个断点间的旧请求重试、定义消失、键盘及 7 个窗口尺寸；写入各一次，重试不变更文件 inode/mtime，零模型调用。故障机制为浏览器 abort 已完成的 HTTP 响应，并非 TCP 丢包。收据 [workflow-recovery-ui-bound-2026-10-29.json](docs/artifacts/workflow-recovery-ui-bound-2026-10-29.json) 的 30 个源码摘要全部匹配；首轮中间截图中的重复提示已在最终确认中移除。复现与边界见 [operation-recovery.md](docs/operation-recovery.md)。
- 新测试还在 claim 与 Workflow completed 落账后 SIGKILL 独立子进程，重启保留答案并拒绝旧检查点；覆盖独立 Store 并发、定义缺失/篡改、跨线程/重复启动证据、目标文件后续漂移和复制账本后的工作区隔离。相关 Runtime 6 文件 107 用例、Server 2 文件 13 用例、Web 4 文件 21 用例、OpenAPI 1 文件 5 用例，共 **13 文件 146 个不同用例**通过；Contracts/Runtime compile/Server/Web build 与类型检查通过。
- Web design 为 89 CSS 文件、284 variables、0 色值/小字债，Impeccable detector `[]`。架构仍为原 10 项失败；公开 API 仍为原 root 1897/1896 与 compatibility digest 不匹配，未提高预算。当前 OpenAPI 包含 307 个路由，292/292 历史操作兼容；历史发布 manifest 未改，不作为发布验收。
- G04 仍需通用不确定副作用对账、完整操作分类矩阵、已完成 Workflow 写节点的通用后置条件核查和历史活动卡终态；新恢复入口与只读开关的 SDK/CLI 便利方法未接通。G01/G02 剩余项、G03/G05–G07 全部保留。后续继续修正恢复后的活动终态表达，并推进尚未实施的共享执行内核和隔离工作区等目标。

### 后续推进：G05-A 脏基线、可合并候选与结果保留

- 从 `main @ 3ba5bda7` 和 18 个本地领先提交继续，保留已有用户 Web／文档／启动脚本改动，未 push。G01–G07 原目标保持 active，本轮属于 **progress**。
- 隔离目录改为逐文件捕获与复制后校验；当前未提交／未跟踪内容和原 mode 进入独立私有基线，Git index 不修改。优先尝试 COW，不支持时普通复制；规模测量发现本机 Node 接口返回 `ENOSYS`，已将失败探测收敛为每源／目标设备组合一次，不把回退数据当作原生 COW 收益。
- 候选终结使用原基线，不再用主工作区当前内容重建基线。工具读取按单文件、目录内容或名称记录，命令／语义 LSP／调试器与未知工具按全可见源树保守记录。合并只检查依赖与写目标，支持基线／当前／候选三方文本合并；重叠冲突保留结果。诊断前固定合并文本，诊断后仅复核，不偷偷再次 rebase；保留原多文件事务、回滚、诊断和关联测试。
- 候选在回收隔离目录之前持久保存，绑定真实 workspaceRoot／dataRoot，跨进程及路径别名共用应用锁。冲突不消费候选；已结算重试复用历史收据且不写文件，明确不代表当前文件重新通过验证。提交前持久 applying，SIGKILL 后保留待对账而不重放；完整 durable 回滚允许重新检查后重试。7 天申请窗口、30 天保留，128 个／1 GiB 总量与 80 MiB 对象上限；不确定状态不自动清理。
- 源树策略为 50k 文件、512 MiB、单文件 16 MiB、50k 目录／64 层；可写文本仍为单文件 1 MiB，上限 32 文件与原事务对应，委派／replay／生命周期诊断同步。源树只保留元数据与有界可写文本，新增大仓库支持没有取消资源上限。补充了混合大小写路径的事务排序，避免合法多文件候选在提交适配层被拒绝。
- 累计 **13 文件、64 个不同用例**通过：脏 Git／index 保留、两个不相交候选、同文件三方合并与冲突重试、正负依赖、目录发现、未知工具、symlink／摘要篡改／跨工作区拒绝、过期回收、诊断后漂移、真实独立进程 commit 前后 SIGKILL、进程竞争和响应未知后的历史收据复用。最终 29 个交付／mutation 用例覆盖最后的路径锁与排序修正；验证顺序边界保留于 [交付收据](docs/artifacts/subagent-workspace-delivery-2026-10-29.json)，不是单次全量 release 验收。
- 真实 Napier 仓库中同时创建两个候选，第一份经过真实 TypeScript LSP、语义 rename、Node 调试器、命令和关联 Vitest；其合并后第二份仍可交付并保留后来发生的无关文件修改。此 smoke 使用直接子进程 adapter，验证工具链集成，不重证 OS Sandbox 强制边界；0 模型请求。首次 smoke 发现旧 fixture 借用了已结束 Run，已改为现有活动 Run fixture。
- [规模收据](docs/artifacts/subagent-workspace-scale-2026-10-29.json) 绑定 17 个实际源码／编译模块摘要，测量前后稳定且提交前匹配。每方案每规模三次独立进程，5k／20k 自动路径中位数 2.444／9.127 秒，观测峰值 RSS 94.8／178.9 MiB，candidate + baseline 块统计 20.60／82.36 MiB。Git + 脏内容覆盖和强制复制原始结果均保留；共享主机温缓存、小样本和无原生 COW 不支持宣称方案速度／物理空间收益。旧 fork 函数两个规模均触发 2k 上限；该比较不代表完整旧版本或 live-model 质量实验。
- Runtime compile/typecheck、Server／SDK typecheck、diff check 通过。架构仍为原 10 项失败，mutation 职责收敛后耦合预算仅从 140 下调至 126；公开 API 仍为原 1897/1896 与 compatibility digest 两项失败，历史 release manifest 未改。
- 实施与复现见 [subagent-workspace-delivery.md](docs/subagent-workspace-delivery.md)。仍需后续处理缺失父目录的事务创建、待对账候选的自动核查、精细命令 read-set、候选管理界面与 G03 子代理执行续跑；本轮不以局部覆盖替代全部 G05／G01–G07 验收。G05-B 多工作区后台运行以及其余目标继续推进。

### 后续推进：G05-B 持久注册表与按工作区寻址的基础

- 上一轮为 **progress**，已现场核对 `659097d3`；本轮保留用户前端／文档改动，未 push。新增按规范化 workspaceRoot + dataRoot 生成的稳定身份、SQLite 注册表和无“当前选中工作区”状态的 Runtime Registry。自定义数据目录、符号链接别名、活跃进程 ownership 和清理失败隔离均有明确行为。
- Runtime 请求租约覆盖准备、响应与 SSE；活跃／后台义务由显式策略保护，普通 LRU 不能淘汰。并发冷启动合并且计入容量；无空闲资源时背压，不停已有任务。POST 执行 SSE 在客户端断开后保留执行租约并有界丢弃后续输出，关闭“Run 尚未建账时断开”的回收窗口。
- 新增 `/api/workspaces/<workspaceId>/…`／显式请求头路由适配器。地址与头不一致会拒绝；旧无绑定请求固定归属启动工作区，避免随 UI 选择漂移。响应保留原内容／证据摘要并带工作区身份。独立进程持有同一 catalog 的 runtime 时拒绝接管，SIGKILL 后可以重新领取。
- 19 个不同测试／4 文件通过，包含实际 loopback HTTP、两套当前 Runtime/SQLite、真实定时器与重开账本。A 客户端断开后任务仍在运行，B 独立完成；A 定时任务继续，B 的停止请求不影响 A，同名文件分别返回 A/B 字节；空闲 B 可回收且活跃 A 保留。使用 demo 模型与既有 readiness-only sandbox fixture，外部模型请求 0，不作为浏览器验收或 OS Sandbox 证明。
- Server typecheck、diff check 通过；架构仍为原有 10 项失败，无新增超限。实现与限制见 [workspace-runtime-registry.md](docs/workspace-runtime-registry.md)，源码绑定收据见 [workspace-runtime-registry-2026-10-29.json](docs/artifacts/workspace-runtime-registry-2026-10-29.json)。
- **尚未接入生产 index.ts／Web 切换**；完整后台义务策略、全局执行／预算协调、预览与 HTML 子资源的归属、浏览器切换及进程恢复验收仍待完成。当前新增基础通过不等于 G05-B 交付，G01–G07 全范围继续保持 active。

### 后续推进：G05-B 生产入口、Web 绑定与导航

- 从 `main @ 647920e5` 继续，保留用户前端／文档／启动脚本改动，未 push。生产入口改为稳定 host，按持久身份恢复各工作区及自定义 dataRoot；UI 选择不再暂停／替换后台 graph。最近工作区与 catalog 使用同一 stateHome，启动校验失败关闭 catalog，恢复失败可查询并定时重试。
- Web 文档绑定 `?workspace=<id>`，所有 fetch、SSE、控制、预览、HTML 子资源、本地图片、截图和生成的 webhook 地址显式归属工作区。切换采用完整同源导航；旧文档异步回调仍绑定 A，连续选择只接受最后一次结果。显式工作区链接不跨 ledger 搜索；旧 thread-only 链接的 404 恢复遇到多个匹配时拒绝猜测。原有文本／mode 持久草稿与图片内存生命周期保持。
- 生命周期保护 queued/running Run、未来定时任务、活跃频道及待投递消息、恢复义务、浏览器任务和订阅；普通空闲 graph 可回收并从原账本重开。rotation 订阅／审批基线因缺少完整 pending 索引仍保守常驻，不宣称全部空闲资源均已可回收。
- Server 7 文件 33 测试、Web 17 文件 157 测试、Markdown／automation 渲染 2 文件 7 测试通过；Server/Web build、Web design contract、diff check 通过。架构保留原有 10 项失败，公开 API 保留原 1897/1896 与 compatibility digest 失败；app 行数预算随职责缩减降至 2978，未提高预算。
- 当前构建在 1440/320px 真实浏览器中：A 运行时从侧栏切到复制了相同 threadId 的 B 并提交新任务；B 完成时 A 继续，B 的 stop 不影响 A，A 自动化实际完成。B HTML 相对脚本和同名 Markdown 图片均来自 B；0 page error、0 成功响应身份错配、0 横向溢出。A 完成后独立生产 index 进程重开两边历史与自定义账本。外部模型请求 0；HTML 交互采用既有 DOM click 边界。收据：[workspace-runtime-integration-2026-10-29.json](docs/artifacts/workspace-runtime-integration-2026-10-29.json)，包含保留的用户前端改动，不是干净提交发布证明。
- G05-B 尚需全局并发／预算协调、运行中任务跨进程崩溃恢复、多工作区审批／review 浏览器验收及细化 rotation 回收。仅勾选注册表与显式寻址实现项，未宣称 G05-B 或 G01–G07 总目标完成。下一步继续资源协调与进程恢复验收。

### 后续推进：G05-B 多工作区进程崩溃恢复

- 暂停后恢复工作，现场核对 `8c14cf34`、21 个本地领先提交与保留用户改动；上一轮属于 **progress**。继续 G01–G07 全范围，未 push。
- 三个使用自定义 dataRoot、复制相同 threadId 的真实账本在一个 host 进程同时进入已持久化 `run.started`，随后 SIGKILL。新进程中 A/B 各保留 interrupted 原 Run，并各完成唯一一次自动恢复；C 的 manual 策略保留，0 自动恢复尝试。再启第三个独立进程不重复创建续跑；响应身份、答案归属、自定义根目录及持久 assessment/attempt 均核查。
- 复现脚本 `node scripts/check-workspace-runtime-recovery.mjs <new-output-path>`：1 个真实进程场景通过，严格测试类型检查及 diff check 通过。单次 SIGKILL 至 A/B 完成观测 3209 ms，不作为统计性能或成功率结论。源码／实际使用的 Contracts/Runtime 构建树绑定收据：[workspace-runtime-recovery-2026-10-29.json](docs/artifacts/workspace-runtime-recovery-2026-10-29.json)。
- 生产 host／recovery worker 真实执行，但 provider 和 readiness sandbox 是本地 fixture；断点在模型分派和工具副作用前，外部模型请求 0。尚不覆盖任意写操作、原样 index 活动恢复或审批 UI 隔离。全局资源／预算协调继续推进，G05-B 和总目标保持未完成。

### 后续推进：G05-B 模型额度与后台生命周期

- 从 `a057890c` 继续，保留用户 Web／文档／启动脚本改动，未 push。生产 host 新增同 stateHome 跨工作区／进程的 SQLite 模型准入，默认最多 8 个物理模型调用；可配置持久 invocation/token/名义 USD 额度和显式 epoch。预算不因重启或空闲回收重置，epoch 内策略不可静默改变，活跃 host 使用最小容量。
- 在 ModelRegistry 原始四方法处准入，主／子代理、compaction、review 与实验复用；不持有整 Run 许可，容量 1 下父子仍可完成。背压同步拒绝且不触发 provider fallback；外部 BrowserUse 或扩展自建网络不在此模型额度范围。invocation 不等于 HTTP 重试次数，冻结 SDK 价格只作名义估算，不保证外部账单上限。
- 成功、正数且一致的用量才释放预留差额；中断、缺失、零用量或不一致记录保留完整预留及更高观测。部分字段缺失不丢弃其余有效计数，cost 缺失仍记录冻结价格估算并保留不确定状态。未知费用为 null；超用变成债务。已结束 Run 的 provider 若忽略取消，物理调用仍占容量且 graph 不可回收；结算写入失败保留隔离并使 drain 明确拒绝。
- WorkspaceProcessManager 的 pending 覆盖准备、OS 执行、终态落账和补偿清理；shutdown 排空准备、终止晚注册进程并等待结算。BrowserTask 在首次 await 前预留，取消发生于凭据或初始落账阶段时不再启动后端；本地 BrowserUse 修复异步准备到 spawn 之间的取消竞态。两类义务均阻止普通空闲回收。
- 当前源码／实际构建树绑定的 **19 文件、170 个不同测试**通过（Runtime 110、Server 60），包括实际父子 Run、忽略取消、跨连接额度、SIGKILL 后不退预算、故障结算隔离、后台进程与浏览器准备／退出竞态。另复跑 1440/320px A/B 浏览器导航、后台自动化、预览资源与生产进程重开，0 page error、0 身份错配、0 横向溢出。外部模型请求 0。当前收据：[workspace-resource-coordination-current-2026-10-29.json](docs/artifacts/workspace-resource-coordination-current-2026-10-29.json)。首轮 167 测试收据原样保留；随后补齐 reasoning／长缓存子计数、部分费用和未分类 token 超用，并修正测试先观察 Run completed、尚未等到 schedule.lastRunId 的结算竞态，失败记录另行保留，未更改生产调度。
- Runtime/Server compile、严格测试类型检查及 diff check 通过。架构仍为原 10 项，公开 API 仍为 root 1897/1896 与原 compatibility digest 两项失败；未提高预算、未重写历史收据。实现／变量／边界见 [workspace-resource-admission.md](docs/workspace-resource-admission.md)。
- **G05-B 仍未完成**：尚需全局物理进程／浏览器容量、审批／review 浏览器验收、细化 rotation 回收。PID 复用保守阻断，不宣称通用崩溃资源回收；额度查询尚无统一暂停 UX。G01–G07 全范围保持 active，后续继续物理资源协调和其余共享执行／投影／恢复／交互／性能目标。

### 后续推进：G05-B 审批与扩展信任审查隔离

- 已本地提交 `b9b4f1b2` 保存模型额度与生命周期切片，未 push。新增真实 HTTP/生产浏览器验收，生产代码与用户前端不变。两份关闭后的 SQLite 副本保留相同 thread／decision／plan／extension ID，另设 A-only ID 反例；B 的 source approval、答案和 continuation 仅改变 B。
- 1 个 HTTP 集成场景覆盖三次 host 生命周期，严格 fixture 类型检查通过。浏览器实际侧栏 A→B 导航、三次原样生产 index 进程启动、自定义 dataRoot 重开；B 完成后 A 仍等待，重启后 A 正确继续。两边各保留一条答案、一条 decision continuation、一次 tool completion 和一次 workflow completion；同答案 202 不新增记录，旧 checkpoint 409 不重写文件（inode／mtime 保持）。extension review 不宣称幂等，source 未连接／启用。
- 1440/320px 共 12 个布局状态操作可达，0 横向溢出／page error／身份错配／外部浏览器请求；最终全局模型账本 invocation／active／token 均为 0。源码及 8 个 source/build 树已复核匹配；收据原字节保存于 [workspace-approval-review-2026-10-29.json](docs/artifacts/workspace-approval-review-2026-10-29.json)。
- **视觉验收未完整通过**：`b-trust-320.png` 确认 Settings 与 Workspace evidence 双弹窗叠层透字，按钮仍可操作。列入 G06-B overlay 整合，不把功能隔离当作视觉无缺陷。早期脚本对生成时间的比较、对遮挡控件的直接操作已按真实 UI 状态修正，未作为生产隔离故障。
- 本片只验证 Workflow approval 与 extension trust review，不扩称所有模型 review、崩溃恢复或 G05-B 全部通过。全局 Sandbox／浏览器资源协调、rotation 回收，以及 G01–G07 其余目标继续保持 active。

### 后续推进：G05-B Sandbox 生命周期边界基线

- 为后续全局进程容量明确计量边界，新增独立复现脚本，使用当前 Runtime dist 的真实 POSIX Guardian：目标进程返回 0 后，快速 detached 的子进程仍被独立观察为存活。随后按 fixture 发布的 PID、脚本、nonce 与出生身份校验，只清理该进程并确认消失，临时目录删除。不是新增生产回归，也未实现全局进程池。
- 最终 [sandbox-execution-lifetime-final-2026-10-29.json](docs/artifacts/sandbox-execution-lifetime-final-2026-10-29.json) 的 7 项源码／构建绑定已复核；保留清理加固前的初始收据。额外注入断言失败和输出 EEXIST，两种路径均确认清理。零网络／模型请求；单次进程观测不是性能统计。
- 下一片 Sandbox execution-slot 必须区分句柄生命周期和所有 OS 后代；启动前失败与清理未知需类型化证据，跨进程资源恢复需持久目标／容器身份与清理凭证。不能照搬模型 owner 死亡后释放容量，也不能用 child.exit 成功证明全部后代结束。此边界仍属 G05-B 未完成部分，其余 G01–G07 目标不变。

### 后续推进：G06-B 浮层挂起与审阅状态保留

- 上一轮为 **progress**：现场核对 `b9b4f1b2`、`c6eaa084`、`b326e7e5` 三个本地提交，启动时 `main` 为 0 behind / 25 ahead，未 push。继续完整 G01–G07；此次修复审批隔离浏览器验收已记录的窄屏双浮层缺陷。
- Settings／Developer Workbench 打开时挂起证据、文件／产物／Skill 预览和浏览器 rail，保留组件挂载、源码选择、iframe 与接管表单状态；关闭后先解除 inert，再恢复前景内有效焦点。背景 Escape 不再关闭证据或导航，旧延迟恢复不能抢走新浮层焦点。保留用户 CSS、WorkspaceEvidenceRail 与 Composer 改动。
- 首轮真实浏览器暴露移动导航搜索框在挂起时被卸载：草稿保留，但焦点落到首个按钮。保留 [失败收据](docs/artifacts/workspace-overlay-capture-failure-2026-10-29.json)，修复为隐藏导航而不改变其折叠偏好；未削弱原搜索焦点断言。
- 最终生产浏览器 5 场景、17 张 1440／320px 截图通过：两类 shell 的单层 Escape／Tab 循环、恢复后再次关闭证据、Raw source／HTML Step 2 保留、快捷键导航和搜索焦点。0 横向溢出／page error／外部浏览器请求，全局模型账本 invocation 为 0。9 个 source/build/script 树及截图摘要复核一致，28 个用户文件保持原摘要；[最终收据](docs/artifacts/workspace-overlay-ui-2026-10-29.json) 原字节保存。
- 5 文件／30 测试通过，新增 2 文件在 fixture 类型修正后再次 21／21；Web typecheck、严格 TSX、build、design contract 与 diff check 通过。新增复杂度／行数超限已修回，架构仍为原 10 项；未提高预算。本片未改 Runtime API，未重复运行其既有失败检查。
- 这是 G06-B 的 overlay 交互切片，未勾选整个 overlay／inspector 或 G06-B 验收。浏览器接管／Skill 只完成真实组件＋模拟 API 状态验证；主 iframe 点击仍使用已有 DOM helper。下一步继续 G05-B 的持久执行／浏览器容量及清理证据，并保留共享执行、成果版本、恢复操作区、深链接、分区和测量消融全部待办。说明见 [workspace-overlay-coordination.md](docs/workspace-overlay-coordination.md)。

### 后续推进：G05-B 持久执行与浏览器资源准入

- 从本地 `faf9d777` 继续，未 push。新增 `execution-resources.sqlite`，以 Sandbox execution handle、原生 browser session、BrowserUse task 为明确计量单位；默认容量分别 32／4／4，同一 stateHome 的 Host 遵守各类最小 live-host 配额。同步准入先于异步准备／物理 dispatch；所有未 released 状态占槽，已 dispatch 的 owner 死亡只能 quarantine。
- Sandbox 等待 child exit 与独立 cleanup 证据后释放；Guardian 私有 ACK、PTY nonce 回执、进程组检查、scratch／projection 清理和 OCI 补偿均参与。原生浏览器保留启动／操作／关闭生命周期，复用不多占槽；BrowserUse local 要求 bridge 关闭 ACK 加 child close，cloud 要求独立 GET 确认同一 task terminal。未知启动、错误凭证、缺失 ACK、未确认 stop 和持久化失败均不释放。
- 真实并发首次打开暴露的 WAL 初始化锁冲突已以有界幂等初始化重试修复；真实 Guardian 强杀暴露的继承输出管道滞留已改为等待私有状态管道。BrowserTask 无效 scope／status 在进入账本前抛错导致 drain 挂起的问题已修复为持久 unknown；新增真实 Local Runtime／SQLite 用例验证有界拒绝且 store 仍可查询。随后三个账本反例确认 regex 隐式转换会接受非字符串 reason，已修复并保留失败报告引用。
- [广泛回归快照](docs/artifacts/execution-resource-unit-regression-2026-10-29.json) 为 42 文件／296 测试；它在最后两项校验修复前运行，原字节保留。[最终针对性回归](docs/artifacts/execution-resource-final-regression-2026-10-29.json) 在最终源码上通过 4 文件／44 测试，含两真实进程竞争、错误凭证和关闭后账本边界；不将旧快照冒充最终全套重跑。Runtime compile、Server build、严格测试 TS、diff check 通过；架构降为 9 项既有失败，public API 保留原 2 项，未增加预算／root exports。
- [最终物理收据 v2](docs/artifacts/execution-resource-physical-coordination-2026-10-29-v2.json) 在两个实际 WorkspaceRuntimeHost、真实 Guardian 目标及安装的 Chromium 上通过 11 项断言：跨 Host 容量 1 的 dispatch 前拒绝、清理后释放、浏览器复用、活跃资源防 LRU、Host shutdown、SIGKILL 后目标停止及重开账本 quarantine 保留。3 张 A／B／A 预览截图已检查；6 个 source/build 树与脚本独立绑定，无运行中漂移，28 个用户文件摘要保留。模型 invocation 0；Chromium 向本地代理的 22 次后台请求全部拒绝，关闭后的 destination／成功 CONNECT／传输字节均为 0，不宣称系统级网络抓包。
- 首次捕获误将 proxy requestCount 当作实际外连，保留 [失败收据](docs/artifacts/execution-resource-physical-coordination-2026-10-29.json.failure-ed910cc3-9893-479e-85f2-d66d075dd8fc.json)。[v1](docs/artifacts/execution-resource-physical-coordination-2026-10-29.json) 已通过资源断言，但网络快照早于 close；v2 增加每个真实代理 close 后最终计数与全部被动请求日志对账，不覆盖旧证据。
- 本片不声称全 OS 后代、CPU／RSS、真实 OCI／BrowserUse provider 或跨机器容量验收；HostDirect 无 OS 隔离。跨重启资源自动对账尚未实现，unknown 必须持续占槽。下一片推进 rotation 后台义务与受控空闲回收，再验证资源释放→回收→冷启动；G01／G02／G03／G04／G06／G07 的剩余目标全部保留，总目标 active。实现和复现说明见 [workspace-resource-admission.md](docs/workspace-resource-admission.md)。


### 后续推进：G07 调用准备性能基线

- 资源准入已本地提交 `6ea6638e`，未 push，提交后 0 behind／27 ahead。本轮先测量现有热路径，未改模型策略或声明质量／成本收益。新增 benchmark-only observer，采样 SQLite 主线程／真实 read worker 的返回行数、每 32 次 JSON 解码的线程 CPU／wall time、文件读取、RSS 和既有 FTS 复用回执。
- 使用现有 LocalStore 写入 10k／100k 确定性事件，并通过生产循环检测和 `prepareAgentInvocationContext` 处理 1k／10k 已审阅 fixture 事实；0 provider dispatch／模型调用。100／50 smoke 与完整 12 次采样通过，源文件子集／全部消费的 Runtime＋Contracts JS／脚本绑定前后一致。工作区同时保留正在进行的 rotation 回收实现，已编译快照在采样前固定；不当作 clean release 验收。
- [当前基线](docs/artifacts/harness-preparation-baseline-2026-10-29.json)：10k 循环检查 15.86–20.28 ms，100k 为 192.38–217.36 ms；100k 事件＋10k 事实准备冷索引 4,301.21 ms，暖索引 1,255.28–1,277.26 ms。暖索引复用 9,000 条事实，但每次仍读取 10,000 次依赖，实际唯一源文件 32 个。100／1,000 条过期摘要及三个越权／未审阅／过期事实均被排除，冷暖上下文摘要一致。
- 该采样含 observer 开销；SQL 为返回行数而非扫描行数，JSON CPU 为实际样本而非全量归因。RSS 含历史阶段、worker clone 与未强制 GC，不能据约 266→1,185 MiB 的进程观测声称内存泄漏。调用准备目前覆盖 working-state／memory 入口和单独 loop guard，尚非完整模型管线。下一片引入 Run 内 typed-event cursor 与保持新鲜度的依赖复用，并用完整 replay 作基准；mailbox、增量索引与模型／任务族消融仍待完成。说明见 [harness-preparation-profiling.md](docs/harness-preparation-profiling.md)。


### 后续推进：G05-B rotation 义务与受控空闲回收

- G07 当前基线已保存为本地 `0560f009`，未 push。本片用内部 pending-work 计数取代 rotation 订阅／历史 approval baseline 的永久保留：active polling、persisted refresh claim、待执行 approval／policy apply 和当前 worker 操作继续保留；paused 且已结算的历史可回收，公开投影仍隐藏私有 claim／queue。
- worker 现在在 manual／scheduled claim 准备前登记生命周期，并覆盖 discovery、结算和 audit 持久化。关闭拒绝新工作，等待所有已启动 sibling 后才报告错误；持久化失败保持图与真实 SQLite 可用。固定旧 `6ea6638e` 源码上两个延迟 sibling 用例均复现 stop 提前返回；当前同一用例通过，旧／恢复源码及 fixture 摘要已核对。
- [回归收据](docs/artifacts/rotation-reclamation-regression-2026-10-29.json) 去重后 7 文件／38 测试通过，包括新 14 个义务／manual／失败排空用例及既有信任 HTTP、registry、host、process 和 Runtime 订阅行为。Runtime compile、Server build、严格新测试 TS、diff check 通过；架构仍 9 项既有失败，server subscription 行数预算仅从 919 下调至 909；public API 仍原 2 项。
- [真实回收收据](docs/artifacts/workspace-resource-reclaim-2026-10-29.json) 通过 10 项：真实 Guardian 与 Chromium 资源先保留 A，确认清理后 maxIdle 0 只回收 A，旧 A SQLite 明确关闭；实际 loopback TCP scoped HTTP 冷开第二代 A，复用原自定义 dataRoot 与完全一致的 seeded events。B 保持第一代图、活动的未来 automation 及可查询 store；此处两次 tick 均无到期任务，不冒充 due automation 执行。7 次 Chromium 代理尝试全部拒绝，最终外连计数／字节和模型 invocation 为 0；6 source/build 树、脚本和截图复核一致，28 个用户文件原摘要不变。
- 受控空闲回收与 UI 切换保留后台义务这一实施项已有当前及先前 workspace 证据；跨重启资源自动对账仍未实现，owner 丢失后的 unknown 容量不能清空。G05-B 总体验收和 G01–G04／G06–G07 剩余要求继续保持，不以本片代替整个目标完成。

### 后续推进：G07 增量调用准备与固定版本对照

- rotation 回收已本地提交 `2aaf959f`，未 push。本片让每个活跃 Run 的主循环与工具 preflight 共用 typed-event cursor，只查询 watermark 之后的相关事件；仍用原完整 replay 函数投影相关历史，失败不推进游标。记忆依赖按单次 invocation 的精确路径复用，逐 fact 比对预期摘要，并在索引后重读被复用路径；漂移时排除全部依赖事实并清理索引。无跨调用 freshness cache。
- [回归收据](docs/artifacts/incremental-preparation-regression-2026-10-29.json)：8 文件／127 测试通过，含生产主循环／preflight、真实 SQLite、迟到终态、策略变化、并发／失败游标以及记忆权限／来源边界。Runtime compile、Server build、严格新增测试 TS 和 diff check 已通过；架构仍原 9 项，public API 仍原 2 项，主 runtime 行数预算只从 3135 下调至 3118。
- [固定旧版本对照](docs/artifacts/harness-preparation-comparison-2026-10-29-v2.json) 从 `0560f009` 原 Git blob 转译完整 84 模块引用闭包；8 个独立进程执行 probe on/off 各 AB/BA，168 次采样、84 对完整语义一致。9 个独立文件系统／SQLite 案例中，8 个等价；索引期间共享源变更的预声明差异保留旧错误输出，新实现排除两个陈旧事实并清空相应索引。0 模型请求。[独立核验](docs/artifacts/incremental-preparation-verification-2026-10-29.json) 确认 source/build/script/lock、Git blobs、原始 worker、16 个 trigger 阶段和全部 28 个用户文件摘要。
- Probe-off 100k 事件循环检查冷态从 190.78–191.27 ms 到 22.60–23.13 ms，未变化暖态从 192.63–194.92 ms 到 1.51–1.57 ms；此合成语料每百条仅两条相关事件，不扩称密集事件工作负载。100k 事件＋10k 共享事实暖准备从 1,231.71–1,252.33 ms 到 296.74–309.94 ms；1k／10k 事实共享 32 路径时读取从 1,000／10,000 到 64。1k 独立文件对照仍读取 1,000 次，冷态 380.55–383.76→386.60–386.99 ms 略慢，暖态范围重叠，保留不利结果。
- [首次完整采样失败](docs/artifacts/harness-preparation-comparison-2026-10-29.json) 原样保留：脚本错误的 loop-trigger category 被生产 registry 拒绝。修正脚本并将 smoke 扩至实际触发该分支后另存 v2，不覆盖旧基线或筛选最快试验。详细曲线、observer／RSS／冷缓存边界见 [harness-preparation-profiling.md](docs/harness-preparation-profiling.md)。调用上下文仍全量读取事件；mailbox、完整 pre-call、增量索引与模型／任务族消融未完成，G07 及全部剩余目标保持 active。

### 后续推进：G03 主子边界审计与工具权限／调用归属

- G07 增量准备已本地提交 `a14c60e3`，未 push。主子执行能力与最小共享接口已按当前源码梳理，见 [subagent-execution-session.md](docs/subagent-execution-session.md)：模型 admission 和工具 durable authority 已共享；模型生命周期／压缩／capture、child Run、mailbox checkpoint 和恢复仍有独立缺口。不能在父 `model.response` 复制 child usage 制造双计，也不能绕过同 Thread 单活跃 Run 约束伪造 child Run。
- 子工具集现在受有效父 profile 的能力快照约束，role baseline 和 inherited callback 均不能恢复已禁用工具；保留 coder 私有工作区及 `candidate_file`／`skill_resource` 的既有派生条件。兄弟／父子相同 provider call ID 改为稳定的 child invocation 身份，贯穿 gate、admission、底层 execute、journal 和 terminal；原 provider ID 独立保留。重复调用、参数变化、账本重开及旧 child claim 仍受 fencing。
- 验证同时复现并修复 candidate 读取依赖包装器丢失工具协议 identity 的问题；复用原 identity-preserving decorator 机制，真实 coder 私有 patch/read、父内容不变、read-set 和越界写拒绝均验证。结构检查对该透明 decorator 使用精确函数豁免，不增加独立绕过 admission 的执行入口。
- [当前回归收据](docs/artifacts/child-execution-boundaries-regression-2026-10-29.json)：10 文件／78 测试通过，0 外部模型请求。旧源码红测分别有 9 个权限断言失败、最初 6 个归属用例中 5 个失败，以及 2 个协议 identity 失败；权限测试中另有两个 coder 在协议缺陷处先失败，未重复计为权限反例。最终源码／测试摘要、原始红绿报告、拆分前后证据均留存。
- Runtime compile／最终 TypeScript emit、严格测试 TS、diff check 通过。新增测试行数与 runner 复杂度超限通过共享 fixture、独立权限测试文件和直接 optional 参数传递消除，未提高预算；仍为原 9 项架构及 2 项公开 API 失败。28 个用户文件保持不变。
- 本片仅勾选 G03 的能力审计与最小接口设计；没有宣称共享 model session、child compaction、持久 child Run 或重启恢复完成。主子仍共享父 ledger，故意选择另一个 child 内部 ID 的父调用会 fail closed；旧 claim 快照也不构成混合版本并发恢复承诺。继续推进共享调用机制、资源完整清理凭证对账及全部其他未完成目标。

### 后续推进：G05-B 完整清理凭证跨重启对账

- G03 工具边界已本地提交 `1b6db1a1`，未 push。本片只恢复“完整 owner 清理已完成、SQLite 释放未提交”的窗口：reserve 同事务保存不可变 nonce ticket，affirmative settle 先持久发布完整 receipt，再释放容量。unknown／仅 Guardian 或 bridge ACK／UI terminal 不升级成完整清理证明。
- 私有凭证采用 no-follow、单链接普通文件、8 KiB 上限、严格 schema、fatal UTF-8、nonce／资源 identity／内容摘要匹配及文件／目录 fsync。原 owner 只有明确 ESRCH 才视为死亡；缺 host 行、存活／复用 PID 或观察失败继续保留。恢复事务重查并 CAS，两个独立恢复 host 只释放一次；不探测／终止后端、不重发 provider create，历史无 ticket 行仍保留。
- 启动固定至多 768 项初始集合（3 类容量各最多 256），每 128 项 yield，并在同一次 open 内处理后页合法凭证；revision CAS 的持久 cursor 支持显式续扫，pending 部分索引排除已完成历史。代码审查发现的“一页启动遗漏后页”先保留真实 red，再修正并验证；污染超出合法上限时保留余项，不无限扫描。
- [当前证据](docs/artifacts/resource-complete-receipt-recovery-2026-10-29.json)：4 文件／57 测试通过，其中恢复 27 项；真实 Node owner／target 子进程与 SQLite 故障注入覆盖清理后结算失败、存活 owner、损坏／缺失／越界文件、两进程 CAS、重试和分页。最初旧代码 2 fail／2 pass、首次新实现的 startup red／green 均留存。该进程夹具不充当新的 Guardian／PTY／OCI／Chromium／BrowserUse provider 验收。
- Server build、Server noEmit、严格新增测试 TS、diff check 通过；最终 source／build／测试及 28 用户文件摘要已核验，仍原 9 项架构／2 项公开 API 失败。发布 receipt 会在 SQLite writer 事务内 fsync，慢 I/O 等待开销未测量；凭证历史不自动 GC。运行中遗留资源的安全清理、丢失 create 响应及完整 G05-B 验收仍未完成，其他 G01–G07 目标保持 active。

### 后续推进：G03 共享模型调用与取消结算

- 主 Agent、child 正常循环、typed repair 和普通 outcome repair 实际复用 `ModelSession.open`。精确请求捕获、截止时间和中止隔离共用机制；主上下文准备、prompt compiler、thinking／overflow recovery 与 compaction 策略保持原职责。只使用已有 admitted models，不增加一层额度准入。
- 请求快照隔离异步 capture 期间的 context／model／option 数据漂移，只保留 provider 工具 schema；通过可信进程内来源保留 runtime-tail 消息身份，不能用相同文本或其他 Run 冒充。child 收据显式绑定 parent ledger、task、execution、phase、invocation index，缓存按 session／phase 分开；不写父 `model.response`，不进入主调用实验选择器，`SubagentTask.usage` 仍是唯一 child 汇总源。
- 修复 route-selected apiKey／onResponse 丢失；endpoint headers 原本已被 adapter 保留。两类 repair 移除可继续循环的 Agent，只接受第一条响应，拒绝任意 toolCall，限制一次 route provider 调用并关闭 SDK retries。普通 child 的未知工具回路也在下一次调用入口阻断；主机未派发的预算拒绝由私有身份标记，不把 SDK 合成错误当成新模型轮次，也不靠错误文本跳过真实用量。
- 同一绝对 deadline 贯穿初始化、模型调用、repair 和结算。请求／响应／accepted 的 awaited 边界后检查取消；最终检查位于串行 SQLite 终态写入内部。初始化工具异常也进入同一失败结算和清理；已提交 completed 不因后续交付事件失败被改写。取消期间生成而未交付的候选会被显式撤销，保留 inspection 证据并阻止 apply，已 applying／settled 的候选不被覆盖。
- 验证使用实际主 Agent、provider、子任务 runner、SQLite 与候选文件系统，模型响应全部为本地 fixture。[最终收据](docs/artifacts/shared-model-session-regression-2026-10-29.json)：27 文件／250 测试通过，0 skipped；1,971 个源码／测试／配置文件前后哈希一致。独立 13 项实际调用集成检查另绑定 2,246 个文件。Contracts build、Runtime build:compile、Server build、新增测试严格 TypeScript 通过；Runtime 完整 build 仍因既有 release source manifest 不匹配失败，未改写清单。架构仍为原有 9 项、公开 API 仍为 2 项；只下调 store 行数／耦合和 runner 复杂度预算。旧版失败、实现期间暴露的 clone／runtime-tail／启动窗口问题均保留，不用重跑覆盖失败。
- 边界：这里没有 child Run、child compaction、mailbox 消费 checkpoint 或重启续跑。忽略 abort 的物理请求仍占用原 lease 至真正结束；迟到物理用量到 child 的精确归属仍未完成。复制／捕获的额外耗时和内存未测量，不宣称端到端性能或模型质量改善。G03 与 G01–G07 总目标继续 active，全部剩余验收保留。

### 后续推进：G03 独立 child Run 与原子结算基础

- 现有 supervisor／semaphore 准入后，在同一事务中创建持租约的 child Run 并绑定 Task；Task.runId 保留父身份，childRunId 指向执行。冻结父配置的进程内授权限定角色工具、并发／总数及模型选择；普通 createRun、伪造 parentRunId 或通用终态方法不能绕过。child 工具、route、调用捕获、进程与候选清理按自身 Run 归属，不借用父进程／浏览器资源。
- 每次物理调用前持久化 reservation；canonical model.response、context envelope／adapter、child Run 与 Task 用量原子结算。相同结算幂等，冲突拒绝。父汇总只消费 Task 一次，benchmark 排除 child 的重复总计。未知用量显式 incomplete 并传播到终态父 Run，成本证据拒绝不完整账本；未派发预算拒绝不制造额外 turn 或零用量响应。子任务复用 RunBudgetTracker，限制已知消耗后的下一次调用，尚无并发共享父 token／cost 原子额度预留。
- 子 Run token、执行 revision、父权限与独立 heartbeat 围栏覆盖派发／进度／完成。父 lease 丢失时拒绝新工作，已知用量仍可结算。启动保留有效 lease；不可续跑 child 明确记录 continuation unavailable。未决工具副作用保持 blocked_safety；父丢失证明在 SQLite writer 事务内读取既有持久 lineage 和标准化父 lease，不能由拟写入快照伪造。
- 主任务／恢复／成果／计划选择器排除 child。实际流式 reducer 修复子 route／tool／model／terminal 事件抢占父 currentRunId、清空待显示正文的问题，trace 继续保留 child 事件。Chrome 中实际 TaskNarrativeBar 与生产 reducer 的隔离 harness 已检查父→5 个子事件；无截图，窄窗口／主题／父终态尚未浏览器验收，也不替代完整应用验收。
- [最终收据](docs/artifacts/subagent-child-runs-foundation-final-2026-10-29.json)：57 文件／381 测试通过，0 failed／skipped；Contracts／Runtime／Server 编译、Benchmark／Web 类型检查、新增测试严格类型检查通过。4,100 个源码／测试／配置、67 个 emitted module 前后哈希一致，用户已有 28 文件完整保留。[首轮收据](docs/artifacts/subagent-child-runs-foundation-2026-10-29.json) 保留严格检查命令缺失 exactOptionalPropertyTypes 等仓库选项的失败，未用重跑覆盖。公开 API 恢复原 1,897／1,896 与 digest 两项历史失败；架构 8 项既有失败，预算只下调；完整 release build 仍因原 manifest 不匹配失败，未重写清单。[独立证据索引](docs/artifacts/subagent-child-runs-evidence-index-2026-10-29.json) 区分冻结源码行为红例、fixture 前置缺陷和测试环境失败，不叠加重合测试数。
- 后续仍需私有 transcript／working set、capsule-first checkpoint CAS、mailbox 消费 cursor、tool／invocation frontier、同一 ModelSession 内 compaction 和安全 child 重启续跑；忽略 abort 后迟到物理用量归属与完整增量 Run 元数据投影仍未实现。全部模型响应为本地 fixture，零外部付费模型请求；不宣称模型质量、性能或 G03／全目标验收完成。实现边界见 [subagent-child-runs.md](docs/subagent-child-runs.md)。

### 后续推进：G03 私有工作集、消费证明与共享压缩（2026-10-30）

- 从 `139fc062` 继续。child 在模型调用前和完整 turn 后 awaited 保存完整私有 source；保留原始工具结果、图片、模型签名与 raw prefix，压缩只改变 provider 投影。先 durable capsule、后 opaque prepared capability，Store 在事务中复核父／子 lease、execution revision、原 pointer、账本 head、调用／用量／工具 frontier，再原子提交 checkpoint、Task 消费计数和事件。导出不包含私有正文，导入明确 `not_imported`；尚不授予续跑权限。
- mailbox 接受按 ID／内容原子幂等，delivered 仍只表示 enqueue；实际入 source 的消息对象才产生消费证明。持久 sparse consumed IDs 与连续 cursor，覆盖 B 先消费而 A 未消费，不能通过同文副本冒领。私有 source 的 assistant／SDK tool-result 哈希绑定真实 child 响应／工具记录，授权工具表与后续 schema 固定；schema 错误与重复 tool ID 拒绝后仍能按 SDK 语义修正。
- child 在所选 route candidate 内、普通调用预留之前使用共享 `RunContextCompactor`／`ModelSession`。摘要使用同一 capture、deadline、abort 与原子用量结算，aux 不算普通 turn，不重试失败摘要；保留全部 raw 工具 source。覆盖长工具上下文、primary503 后小窗口 fallback、预算与取消边界。角色 prompt 保持原样；完整 child prompt compiler／overflow／thinking／extension parity 尚未实现。
- 私有存储增加有界 descriptor／UTF-8／身份校验、不可变安装和支持平台的目录同步；子 checkpoint 强制 durability capability，仅明确不支持能力时记录 unavailable 并继续普通执行，保留此前 pointer／cursor。EIO／ENOSPC／权限／损坏仍失败。真实 Darwin 文件／进程与 capability 注入不是 Windows 或断电验收；stale-lock takeover 竞态和 hostile ancestor 不在本轮保证内。
- 联合验证发现并修复两处问题：异步 supervisor 测试误把完整 handle.kind 传为消息类型；主调用在 capture 完成后的取消窗口遗漏 terminal envelope 绑定。后者补充两个精确持久化边界的零 provider 调用／有效 replay 测试，保留 dispatch 取消门槛；绑定不表示 provider 已收到请求。partial ledger 写失败与跨 route attempt 结算另列边界。
- [最终收据](docs/artifacts/subagent-working-set-regression-final-v2-2026-10-29.json)：**68 文件／473 测试通过，0 failed／skipped**；Contracts／Runtime／Server 编译、Benchmark／Web 类型检查、新增测试严格类型检查通过。4,119 个源码／测试／配置及 39 个 emitted module 前后哈希一致，用户已有 28 文件完整保留。首轮 464 passed／2 failed 与下一轮 473 passed 但新增测试 JSON 类型检查失败均原样保留；[独立证据索引](docs/artifacts/subagent-working-set-evidence-index-2026-10-29.json) 区分 fixture 错误、行为红例与演化后的测试，重叠用例不叠加。架构仍为 8 项既有失败，公开 API 仍为 1897／1896 与 digest 两项，历史 release manifest 仍失败；没有改写预算或发布证据。
- 下一步采用新的 continuation Task／execution／child Run 和明确 recovered-parent grant，旧账本保持不可变；严格拒绝 checkpoint 后未覆盖的 model／tool／review tail，保留 inherited prefix、逻辑预算／原 deadline、稀疏 mailbox 来源，并实现终态 assistant 的无额外普通调用结算与结果／候选幂等。安全父恢复、workspace／schema 重验证、coder 工作集恢复、迟到物理用量、并发共享父额度及完整增量投影仍未完成。全部模型响应为本地 fixture，零外部付费请求；G03 与 G01–G07 整体继续 **active**。实现与边界见 [subagent-working-set.md](docs/subagent-working-set.md)。

### 后续推进：G03 安全 child 续跑与持久完成（2026-10-30）

- 实现已本地提交 `f06ec79d`，随后 `f95eb544` 仅去除两个文件末尾空行，未 push。新的 continuation Task／execution／child Run 绑定明确 recovered parent，旧执行不复活；事务内重查 source frontier、当前角色／工具／skill 授权与父 lease，唯一 predecessor 只发一份新执行租约。显式 inspection 不恢复 child；自动只读恢复仍不开放普通委派工具。
- 原始私有 source 与稀疏 mailbox provenance 完整继承，只重排未消费输入；原始绝对期限与逻辑预算不重置，canonical Run／Task 用量继续按物理 attempt 分开。最终合法 assistant 可零普通模型调用交付；截断 tail 在 claim 前拒绝。每次修复／压缩／route 派发前同步父级已知用量，耗尽额度后不产生新物理调用；这仍不是并发 token／cost 原子预留。
- 当前仅支持有原生私有证据的只读恢复：无已执行依赖或可用私有 SDK 路径／hash／size 验证的 `read_file`。成功的 list／search／LSP／skill 依赖、coder／worktree、未知用量／副作用及未覆盖 model／tool／review tail 仍明确 unavailable。claim 后首个 checkpoint 前崩溃可沿持久 source alias 恢复，保存 native checkpoint 后改用继任来源；缺失／损坏源不会静默退回公共步骤。导出可校验，含 continuation 的 replay 导入在持久化前拒绝，尚无迁移私有权限的承诺。
- 完成 reservation／receipt 与 Task／Run 终态绑定稳定结果／候选身份，commit 后 publication 中断可从持久状态 collect；未完成、revoked、applying 和导入候选不因此获得 apply 权限。旧 native 无 completion binding 的候选目前仅可检查，尚需依据原始完成事件＋私有候选进行受限迁移；不能仅凭 Task completed 或文件存在升级。
- 真实独立进程 SIGKILL 覆盖 claim 前、首个 checkpoint 前后、invocation reservation 后及 response 已结算但 source 未保存；两进程竞争只产生一个 successor／token。完成阶段覆盖 stage 后、terminal commit 后与两进程重复完成。独立复查修复截断 tail 遗留 running、父预算被 final repair 绕过、导入后无法 reopen、重算 hash 后的谱系矛盾及 inherited mailbox 计数遗漏。
- [最终联合收据](docs/artifacts/subagent-safe-continuation-regression-final-2026-10-30.json)：**80 文件／566 测试通过，0 failed／skipped**；Contracts／Runtime／Server 编译、Benchmark／Web 类型检查与新增测试 strict 全通过；4,158 源码／测试／配置及 65 emitted module 哈希稳定，用户 28 文件保留。首轮同样 566 行为测试通过但 strict 揭示进程 fixture 的 usage 参数被忽略；最终显式设置并先断言 10 tokens／USD 0.03，再验继承仅一次。旧报告不支持该非零用量结论，原样留存。[证据索引](docs/artifacts/subagent-safe-continuation-evidence-index-2026-10-30.json) 记录独立重叠测试、失败演化和最终纯空行修正，不累加测试数。
- 架构仍为 8 项既有失败，公开 API 仍为 1897／1896 与 digest 两项，历史 release manifest 仍失败；只降低已过时架构 allowance，没有改写发布证据。全部模型为本地 fixture、零外部付费调用，无平台／断电／质量／性能泛化。下一步继续迟到物理用量持久归因、native 历史候选迁移与 G02 跨 suite／campaign 的任务族暴露分区；coder 恢复、完整编译管线、并发共享额度及 G01–G07 其余要求均保持 **active**。详见 [subagent-safe-continuation.md](docs/subagent-safe-continuation.md)。

### 后续推进：G03 原生历史候选受限对账（2026-10-30）

- 本地实现提交 `24909ead`：保留原完成 Task／child Run／accepted／completed／terminal 证据和同一真实 data root 的私有 v1 capsule，分别验证 outcome 与 typed output，新增独立 migration 收据；不伪造旧 completion，不修改原 capsule／ID／到期时间。导入证据不授予本地写权限；导入之后新产生的原生执行可凭自己的证据验证。
- 独立审计复现了旧事件不绑定精确 capsule ID／read-set 的限制，已明确记录 `current_private_capsule`，以原始完整 source snapshot 约束迁移及每次实际 merge preflight（包括 diagnostics 之后）。因此历史候选连无关源变更也保守阻断；不宣称历史精确字节认证。首次写入和 rollback retry 保留原 expiry；已验证 settled applied 结果可在到期后只读复用，不追加授权或写入。
- 最终 [回归收据](docs/artifacts/subagent-legacy-candidate-regression-2026-10-30.json)：81 文件／594 测试，required compile／strict types 全通过；4,179 源码／配置摘要、22 个本次变更 emitted modules 和 28 个用户文件无漂移。独立旧 `8f2a26c` producer 的 outcome／typed 两条真实 apply→reopen→repeat 通过，原 Task／Run、父发布事件、child terminal、capsule／expiry 保持，重试 inode／mtime／ctime 不变；另有 6 项边界审计。测试集合存在重叠，不相加计算独立覆盖。
- [证据索引](docs/artifacts/subagent-legacy-candidate-evidence-index-2026-10-30.json) 保留 rehashed capsule 反例和首次 root 把 `typed_output` 误写为 `typed` 的失败；最终用新 fixture 重做。现有 8 项架构、公开 API 1897／1896 与 digest、历史 release manifest 失败保留。零模型调用；文件摘要 fixture 不代表 LSP／模型质量、断电或其他平台验收。详见 [实现边界](docs/subagent-legacy-candidate-reconciliation.md)。G03 与全目标继续 active。

### 后续推进：G02 跨 suite 任务族暴露与发布资格（2026-10-30）

- 本地实现提交 `ead04871`：版本化 catalog／family map、不可被 supplement 擦除的已知暴露下限、精确 task／source／family 绑定进入 frozen analysis plan 和 child reports。holdout seal 绑定完整 family membership 与原始声明字节，校验规范路径／realpath／实体文件；真实发布 audit 和 acceptance generator 统一使用 corpus qualification，旧 promotion flag 不能直接授权发布，历史 receipt 字节不变。
- 当前真实盘点：52 source roots（49 optimization）、15 suites、41 精确 task identities、35 canonical families、184 campaign references、166 不同 Runs、25／25 raw reports 摘要已验证。suite membership 为 **206 tuning／1 regression／0 holdout**，207 行包含版本化别名，不是 207 个独立任务；没有将已有任务改名为 unseen。
- 最终 [回归收据](docs/artifacts/harness-corpus-regression-2026-10-30.json)：12 文件／125 测试，含 4 个实际生产消费者测试；compile／strict types／inventory／新旧 receipt verifier 通过，4,532 源码／配置与 4,227 emitted 文件无漂移，28 用户文件保留。独立边界审计 16／16。新 [0.1.5 contract receipt](docs/artifacts/harness-experiment-contract-evidence-0.1.5.json) 仅含 360 本地 faux Runs，明确 contract_only、不可 promotion，零外部模型请求。
- [证据索引](docs/artifacts/harness-corpus-evidence-index-2026-10-30.json) 原样保存 121 pass／50 fail 的早期 aggregate；50 个旧 release tests 在 fixture construction 失败，精确旧 HEAD `31e9edb9` 的独立 checkout／五包编译后复现相同名称／状态／错误／完整栈（仅归一化路径），不计为通过。临时 OCI fixture 修正已撤销，没有改写历史 stage11–22 证据或提高预算。
- **G02 仍未完成**：真实独立 curator cohort、研究／候选范围的 tuning exclusion、首揭示与后续使用记录，以及目标模型的有效 live-quality 观察仍缺失。合成 sealed-family 只证明机制，声明时间只证明内部一致性，不是外部认证或 universal non-exposure。详见 [语料来源与暴露边界](docs/harness-corpus-provenance.md)。后续继续 G03 持久迟到用量、coder 恢复／完整编译管线／共享额度，以及 G01–G07 所有保留目标；未 push。

### 后续推进：G03 持久物理用量与迟到对账（2026-10-30）

- 实现本地提交 `58e61c30`，未 push：原生归属／source outbox／Store 原子 claim 覆盖主子及辅助调用、独立评审、Host 非执行恢复与 standalone source。正常和迟到响应同路计费；Task／parent 汇总不双计，逻辑取消不交付迟到内容，已封存完成／续跑证明不能被计量改写。`physicalId` 只代表一次 admitted Models API 调用，不宣称 SDK 隐藏 HTTP 重试已逐次计量。
- [冻结回归](docs/artifacts/model-physical-usage-regression-2026-10-30.json) 为 **78 文件／601 测试通过**。Contracts／Runtime／Server 编译、Web／Harness／Benchmark 类型检查及新增／其余修改测试严格检查通过；4,004 源码／配置、4,811 emitted 和 28 用户文件摘要无漂移。原始 `agent-runtime.test.ts` 的 48 个严格类型错误在旧 HEAD 精确复现，仍保留为未通过检查，不计作通过覆盖。
- [证据索引](docs/artifacts/model-physical-usage-evidence-index-2026-10-30.json) 保留首次冻结 590／592 失败、复制零值 DTO 绕过证明反例与夹具错误。修复了双 replayer 启动的混合 revision 读取、stale finish、未知总额抹掉已知费用下界、advisor 导入哈希、续跑加权／计价准入；确定性并发／损坏专项 9／9，最终真实 SIGKILL／双进程 replay 通过。仅本地 faux／loopback HTTP，零外部付费调用。
- **门禁仍不完整**：8 项既有架构失败、根 API 1897／1896 与 digest、历史 release manifest 失败保留；新增 5 项生产必需 internal 接口带来 21／16 与内部 digest 门禁失败，尚未通过接口验收。没有提高预算或宣称发布完成。完整 child compiler／thinking／overflow、coder 恢复、并发共享预留额度及其他目标继续推进；详见 [实现边界](docs/model-physical-usage-accounting.md)。G03、G02 与 G01–G07 总目标保持 **active**。

### 后续推进：G03 thinking 恢复的主子共享规则（2026-10-30）

- 实现本地提交 `250c55f1`，未 push。主、子普通回合共用位于 route candidate 内的 thinking guard，避免路由缓冲遮住停滞；一次逻辑 open 跨候选最多一次 thinking 重试。检测后恰好一次结算逻辑 attempt，仅等待本次物理调用的持久 receipt／Store 投影／ACK，以原剩余寿命和既有 5 秒宽限的较小值为限；根取消、真实时钟超时和计量失败均停止。
- 原生 handle 来自真实 admitted 调用；缺失／伪造／失配不能降级到 legacy。重试重新检查 owner／预算／turn／admission并生成新 capture／physical ID。child 抑制响应需要 guard 私有证明，绑定逻辑响应、证据、归属及首次消费 fence；通用 append 不能绕过。迟到 raw 文本／工具只参与计量，不发布或执行；最终 unknown／partial 与 checkpoint 完整性规则不放宽。
- [最终联合收据](docs/artifacts/native-thinking-recovery-regression-2026-10-30.json)：**99 文件／777 测试通过，0 failed／skipped**；Contracts／Runtime／CLI／Server 编译、Web／Harness／Benchmark 类型检查和新增／修改测试严格检查通过。独立 HEAD＋G03 staged 快照排除并行 G04 和用户原改动，4,009 源码、5,051 emitted 摘要稳定，原工作区 28 用户文件完整保留。提交前仅去除一处 EOF 空行，重编译的 5,051 文件逐字节相同，实际 staged diff 检查通过，没有为此重复行为测试。
- [证据索引](docs/artifacts/native-thinking-recovery-evidence-index-2026-10-30.json) 保留 route-buffer 反例、取消误分类和首轮冻结 773／774。唯一冻结失败是按预算检查次数注入的旧 fixture 提前触发；改为 durable capture 后耗尽预算，保留一份 reservation、known-zero response、零派发／turn／step及顺序断言。新增实际路由主／子用例验证 thinking 重试不随 fallback 重置；不完整原生 child receipt 仍阻断后续调用。
- 隔离快照有 **7 项既有架构失败**（此前包含用户工作区改动的收据为 8 项，范围不同）；API 仍为 root 1897／1896、internal 21／16 与两项 digest 失败，旧测试 48 个严格类型错误与 `d2e33ac3` 完全一致。历史 release manifest 未重写，零外部付费请求。不宣称完整 compiler／overflow／extension parity或质量／性能改善；并发 owner 额度、coder 恢复与其余 G01–G07 目标继续 **active**。详见 [实现边界](docs/native-thinking-recovery.md)。

### 后续推进：G04 原生文件移动的独立对账（2026-10-30）

- 本地实现提交 `0d269b64`，未 push。原生 `workspace_file_apply` 的单个普通文件移动新增私有写前意图与持久 commit gate，绑定 source inode／摘要、workspace／父目录、call／operation／input。writer 死亡后，在规范路径锁下核对；源消失且目标仍为原文件才证明完成，缺 gate 且完整原生 journal／原始文件状态一致才证明未执行。对账 proof、原执行者权限隔离与 Run interrupted 原子提交，不重放 rename 或补造工具成功。
- 已完成移动仅允许剩余只读工作，continuation 前再次检查文件；未提交事实不授予自动重试。精确锁冲突保留 unknown 并推迟核查，防止竞争者将正在对账的赢家封成 blocked_safety；赢家随后死亡时仍需后续 initialize／显式 lifecycle 对账，普通 RecoveryService sweep 尚未重核失主 Run。
- 审查发现严格目录持久化能力不支持时会阻止原本可行的普通移动，已修正：仅 intent 存储抛出明确类型的 unsupported 错误时，先持久记录绑定原调用的 `recovery_unavailable` 再执行普通移动；标记失败、EIO／ENOSPC／EACCES、文件 sync 失败及同名伪造错误均阻止移动。该标记不产生恢复／未执行／自动续跑权限。能力故障在真实工具链的 intent 存储点注入，未宣称 Windows 实机验收。
- 最终冻结快照 **47 文件／411 测试**全部通过（Runtime 393、Server 11、Web 既有组件 7）；编译、相关类型与新测试 strict 检查通过，4,020 源文件与 5,069 构建产物哈希稳定，28 个已有用户文件不变。旧 `agent-runtime.test.ts` 的 48 项 strict 诊断与 `d2e33ac3` 归一化基线完全一致。
- v1 的 Web reason 类型遗漏和两项新架构失败、无效中断的 v2、修正后但尚无兼容 fallback 的 v3 402/402，以及最终 v4 全部留存。当前隔离快照仍有 7 项既有架构失败，API root1897/1896、internal21/16 与两份 digest 失败；不包含并行 Host 收敛候选，历史 release 失败保留。只降低 manager 旧行数 allowance746→701。EN/ZH 文案、既有组件测试和静态渲染不代替新浏览器验收。
- 范围仍限同文件系统、已有安全父目录、目标缺失、至多32MiB的单普通文件；外部非协作写入的无覆盖原子保证、混合／多移动链、目录／copy／trash／restore／外部副作用、周期失主重核和完整分类矩阵未完成。见[实现说明](docs/workspace-file-move-recovery.md)、[最终收据](docs/artifacts/workspace-file-move-recovery-regression-2026-10-30.json)与[证据索引](docs/artifacts/workspace-file-move-recovery-evidence-index-2026-10-30.json)。G04 与全部剩余目标继续 **active**。

### 后续推进：G03 Host 记账边界收敛（2026-10-30）

- 本地实现提交 `7ce8097f`，未 push。Runtime 的 `HostModelAccounting` 统一拥有 Host 生命周期的 spool、物理用量规范化、workspace scope、delivery／replay／ACK；Host 仍持有可信同步预算策略及 SQL 更新。reservation／receipt／物理槽的原子关系保持：先 Store commit，再 source ACK，ACK 与退额度处于同一 Host 事务；迟到计量不改变执行终态或恢复正文／工具。
- 移除 Server 低层 source adapter，将5个低层 internal exports收敛为显式类与policy type，internal21→18，仍未通过16的门禁。native admission与Store／repository用私有身份绑定；真实SQLite receiver、源配置和持久化回调使用运行时私有边界。审查中发现的公开repository替换与source泄漏已在startup／live／drain／undispatched全部路径修正，故障注入改用真实SQL和提交后的测试barrier，保留旧回归与审查发现，不以隐藏失效mock当作通过。
- 最终构建快照 **99 文件／788 测试**通过（Runtime742、Server46，含真实loopback／SIGKILL／并发重放）；编译、相关类型检查通过。首轮strict因`/tmp`与`/private/tmp`混用产生5个nominal类型诊断，统一验证器路径后通过；源码和产物未变，未重复行为测试，失败及修正收据分别留存。旧agent-runtime的48项strict诊断与原始基线一致。4,026源文件／5,081产物哈希稳定，28个已有用户文件不变。
- 仍有隔离快照7项既有架构失败、root1897/1896、internal18/16和两份digest不匹配，未修改预算或digest；历史release失败保留。该边界不宣称抵抗任意可信进程内Store对象图修改。完整child compiler／overflow／extension、共享父token／cost原子预留、coder恢复及G01–G07剩余目标继续 **active**。见[边界说明](docs/host-model-accounting-boundary.md)、[最终收据](docs/artifacts/host-model-accounting-boundary-regression-2026-10-30.json)和[证据索引](docs/artifacts/host-model-accounting-boundary-evidence-index-2026-10-30.json)。

### 后续推进：G01 成果候选特殊文件阻塞修复（2026-10-30）

- 检查G01成果候选时复现：最终回答显式引用工作区FIFO，`getDetail`在只读open等待writer，无法到达已有regular-file检查，连带阻塞整个任务详情。原始反例失败已留存，清理阶段主动打开非阻塞peer以释放旧调用。
- 本地提交 `1ecf0f43` 对候选descriptor增加`O_NONBLOCK`，特殊文件可立即到达类型检查并被排除；原有路径、摘要与未验证候选语义保持。真实Store与缓存projection的FIFO用例、原有正常文件/越界/重复/版本等 **6/6** 测试通过，Runtime/Contracts编译和严格测试类型检查通过，28个已有用户文件不变，模型调用0。
- [复现与验收收据](docs/artifacts/task-output-special-file-regression-2026-10-30.json)保留前后证据；这是本机POSIX文件系统检查，不是Windows或浏览器验收。未完成的独立目标验收生产者、成果来源/版本完整性、发现限额表达等G01任务仍保留，未 push。

### 后续推进：G04 锁争用后的周期核查与共享锁修正（2026-10-30）

- 本地提交 `663a5f5b`，未 push。仅实际`move_target_busy`产生生命周期调度提示，绑定原Run／lease generation／effect boundary；RecoveryService每轮最多重核8项、退避上限30秒。每次经Store刷新/CAS、确认原生PID死亡、重获路径锁与重新读取证据；状态变化即丢弃提示，不扫描重试普通失败Run或扩大移动重放权限。赢家后续死亡可在同一服务内重新核查。
- 共享路径锁新增私有SQLite元数据协调，仅同步保护创建/死owner回收，BUSY立即退避，不阻塞事件循环等待秒级超时。活着或不确定owner不接管；旧ownerless/malformed锁不再仅按年龄删除。自有释放以PID/token/fd/dev/ino验证，并利用协作方不回收活PID的不变量脱离协调器，消除正常BUSY造成的永久遗锁。混合旧二进制或外部非协作写入不在原子性保证内；其他unlink/storage失败仍可保守留锁。
- 首个冻结快照543测试虽通过，追加真实ordinary wrapper反例仍发现释放BUSY遗留当前PID锁，因此未提交；保留反例和修正后的同进程重获锁证据。最终隔离快照 **62文件／544测试**全部通过，含跨进程交接、失主重查及Git/LSP/subagent/capsule/Store共享消费者；编译和相关strict/type检查通过，4,032源文件／5,087产物哈希稳定，28个已有用户文件不变。旧48项strict诊断与原始基线一致。
- 7项既有架构、root1897/1896、internal18/16及两份digest失败保留，不改预算，历史release失败不重写。后续仍需混合/多操作版本链、已证明未执行move的显式续执行授权、更多adapter与全分类验收；G04及总目标继续 **active**。见[说明](docs/deferred-operation-reinspection.md)、[最终收据](docs/artifacts/deferred-operation-reinspection-regression-2026-10-30.json)与[证据索引](docs/artifacts/deferred-operation-reinspection-evidence-index-2026-10-30.json)。

### 后续推进：G03 普通回合 overflow 的记账就绪边界（2026-10-30）

- 本地提交 `672bdb7`，未 push。主／子普通回合共用 overflow guard，原生请求必须观察私有 physical-call handle 的 source→Store→ACK 完成与已知／未派发收据；partial／unknown、ACK失败、缺失handle、取消或到期均停止，不伪造零用量或放宽incomplete门禁。观察期限取原剩余时间与既有5秒取消宽限的较小值，异步回调后再次检查真实时间。
- 保留两个实际反例：原生主调用在用量仍incomplete时发起第2次请求并完成；混合`HTTP 500: context_length_exceeded`绕过内层停止继续route fallback。修复后均只调用1次并保留failed/incomplete；私有进程内终态身份同时阻断route fallback和same-candidate retry。显式legacy仍可一次压缩重试，后续thinking重试消费最新压缩上下文，不更换角色prompt／tools或覆盖child原始checkpoint。
- overflow事件改为无usage的诊断，最终response／child logical settlement持有用量；只有主重试实际开始才单独记录隐藏失败response。回调取消／超时使用另一个关联诊断，不重复终态或费用。独立附加6个本地探针覆盖路由子调用、取消／抛错回调和opaque身份，全部通过。
- 最终隔离快照 **105文件／831测试**通过（Runtime785、Server46），编译、相关类型与strict owned检查通过；4,036源文件／5,090产物摘要稳定，28个用户文件不变，旧48项strict诊断与原始基线一致。保留7项架构、root1897/1896、internal18/16及两份digest失败；未改预算或历史release证据，外部付费模型调用0。
- 本片完成原生不确定调用的安全停止及legacy有界恢复，**尚未证明原生overflow成功恢复**，不据此完成G03。完整child compiler／extension parity、并发父token／cost原子预留和coder恢复仍待实施；G01–G07总目标继续 **active**。见[边界说明](docs/overflow-recovery-safety.md)、[最终收据](docs/artifacts/overflow-recovery-safety-regression-2026-10-30.json)与[证据索引](docs/artifacts/overflow-recovery-safety-evidence-index-2026-10-30.json)。

### 后续推进：G01 当前成果事实与事件版本绑定（2026-10-30）

- 本地实现提交 `53e2eaf2`，未 push。正式文件成果在每次 detail／缓存 narrative 请求时重新检查，观察绑定完整 manifest、plan ID／revision、路径与摘要／字节数；metadata-only `verified` 不再直接使 Task validation 通过。当前 missing、drift 和 unchecked 分开；文件重现时历史 missing 声明不覆盖真实 available。纯 metadata 投影保持 accessibility unchecked，来源 Run 仅表示记录／验证者，不冒称创建者。
- 检查有界为最多64个文件、64段路径、单文件8MiB、总实际读取32MiB；拒绝符号链接、FIFO／非普通文件，核对descriptor／path的dev／ino／size／mtime／ctime。读中增长探针也受预算夹限；超限、不可读、竞态和不支持类型保持unchecked，不扫描全工作区。
- 从既有 `plan.artifact.*` 恢复 event identity／seq／revision／path／digest 绑定的 metadata history，明确为 recorded assertions 且始终不完整，不声称旧字节可下载或独立生产来源。当前event须精确匹配当前plan revision，修复同毫秒同metadata状态落盘而event失败时借旧event的问题；其它计划修订可将其降为历史，而当前字节重新匹配仍可通过完整性检查。不同artifact代际按创建／声明顺序选择，旧版本晚更新不能夺回新continuation，新版缺失不复活旧verified。
- 隔离逻辑候选 **47文件／279测试**通过（Runtime143、Server36、Web92、CLI8），声明emit、相关types／strict检查通过；4,040源码／5,096产物哈希稳定。实现侧16文件110测试和独立3探针另列且不累加，独立探针覆盖真实HTTP／SQLite提交间隙、缺size、旧revision、无event漂移／重现及warm／cold restart。7项既有架构、root1897/1896、internal18/16、两份digest失败及原48项strict诊断保留，不改预算。
- 初次browser v3虽raw receipt为passed，但截图发现窄屏证据／来源列及导航裁切，明确拒绝其视觉验收并保留原图／回执。最终追加 `workspace-shell.css` 修复，production Web v5在light Chromium／1440、390、320 CSS px／EN-ZH下通过6场景、9截图、刷新／键盘、单元格与tab水平范围和点击命中检查；root已查看panel及顶部截图。4,040源码／5,096emit／339Web产物前后稳定，28个已有用户文件不变，模型调用0；浏览器快照含精确保留的用户overlay，不当作纯commit发布或物理移动端／dark／读屏验收。
- 所有原始反例、中间测试／emit失败、同毫秒history、文件重现、预算越界、continuation回退以及browser误报均归档。见[说明](docs/task-artifact-facts.md)、[交付收据](docs/artifacts/task-artifact-facts-regression-2026-10-30.json)与[证据索引](docs/artifacts/task-artifact-facts-evidence-index-2026-10-30.json)。本片不新增人为验收关卡；whole objective仍为unverified／partial等既有语义。tool-only来源、完整历史字节、更多artifact卡消费者、独立整体目标验收来源及完整G01仍未完成，总目标继续 **active**。

### 后续推进：G07 主调用准备的事件输入游标（2026-10-30）

- 本地实现提交 `a056a3b1`，未 push。主模型 lifecycle 每个 Run 仅创建一次准备工厂／游标，以持久化 `findLatestEvent` 固定 head，再读取11类相关事件的有界 range；读失败、非法批次、head 回退及原投影拒绝均不推进。每次重新读取 Run／恢复链、记忆有效性、依赖文件、工作区成果与预算，不缓存最终上下文。分支一经发现永久回到完整 oracle；state-only 和无原生能力 adapter 保留原全量读取。
- 测量基线明确为 `5adf1d9`，候选只叠加精确6文件，两侧独立编译。AB／BA × 探针开关各8个新进程，smoke24组与100k事件正式36组配对输出及回执语义全等，前后 source／dist／scripts／lock 摘要稳定。cold返回事件行100001→1002（1001 typed＋1 head），warm100002/100003→1 head、0 typed delta；不是SQLite内部扫描行数。probe-off warm：共享1k事实245–271→27–48ms、共享10k事实300–325→74–78ms、独立1k文件331–337→113–116ms；cold10k事实仅3404–3460→3172–3227ms。
- 全部不利观察保留：smoke有1/24耗时比1.186、12/24 sampled peak RSS更高；没有挑选重跑。原18 pass／3 fixture failure、工厂收敛前新增两项架构失败、修正后报告与独立审查均归档。固定109测试与最终306回归重叠，不累加；独立审查核6源、82原始artifact与全部60组raw配对，没有重跑benchmark。
- 最终隔离集成基线为 `53e2eaf2`＋6文件tree `681b9726`，**33文件／306测试**通过（Runtime302、Server4），编译、相关types／strict通过；4,043源文件／5,099产物哈希稳定，28用户文件不变。7项既有架构、root1897/1896、internal18/16及两份digest失败保留，旧48项strict诊断与原基线一致，不改预算或历史release证据。测量0模型调用，集成仅本地fixture／loopback，外部模型请求0。
- 本片仅覆盖主 invocation preparation；mailbox、state-only／branch优化、完整10k／100k资源曲线、策略消融和目标模型质量仍未验收。typed历史与回放CPU仍随相关历史增长，batch完整性依赖原生append-only查询合同，不宣称生产端到端收益或完整G07。见[说明](docs/invocation-context-cursor.md)、[最终收据](docs/artifacts/invocation-context-cursor-regression-2026-10-30.json)及[含可移植核对脚本的证据索引](docs/artifacts/invocation-context-cursor-evidence-index-2026-10-30.json)。G07与总目标继续 **active**。

### 后续推进：G01 成果消费者的选中版本与当前事实（2026-10-30）

- 本地源码提交 `c3734a07f1abc93357f2becf8e255c35d60dbce3`，精确56文件，未push；保留28个用户文件原摘要及无关证据目录。
- 预览、下载、diff和manifest回执按选中plan revision、artifact身份、路径及适用的摘要/大小校验；缺失字段不能绕过校验，晚到响应不能落入已切换的选择。mutation仍是latest-ID操作，未新增写入CAS。
- Runtime和Web共享conversation artifact事件投影：当前manifest必须绑定原事件版本，保存事件Run与时间，重新判断当前/历史轮次；旧原生投影缺少来源字段时回退原始事件重放。无绑定事件不拼接成新成果卡；短事件窗口缺少共享intent时保持保守分类，不声称完整历史。
- Artifact卡、Task Changes及主成果入口消费当前观察；`Integrity recorded`仅表达历史声明，文件缺失/漂移不再复用旧的绿色验证状态。浏览器另外发现并修复关闭异步预览后焦点落到body，以及窄屏文件名/页签截断；局部CSS没有改动用户保护样式。
- 隔离整合验证去重后为71文件/503测试，构建、严格源/测试类型、Web设计检查通过；原架构7项及公共API4项失败保留。拆出download API测试后仅将其旧行数上限2488收紧为2393，未放宽门禁。
- 生产构建与用户28文件overlay完成7个EN/ZH桌面/320/390浏览器场景，审阅11张截图；实际原生current HTML、历史directory声明、missing file，以及具有有效传输摘要的版本错配回包测试缝隙均明确分开。源码2783/输出5227摘要在最终浏览器执行前后稳定，零外部模型调用。
- 说明和便携证据：[artifact-consumer-version-binding.md](docs/artifact-consumer-version-binding.md)。独立目标验收生产者、tool-only来源、完整历史字节/来源证明、写入版本前置条件及跨端全量收敛仍待完成；G01及G01–G07整体继续active，不以本片通过代替全体验收。

### 后续推进：G03 原生共享在途额度（2026-10-30）

- 本地源码 `1bf62ef299e9935dbc27f4d9caf46aa7f75f83d2` 固定17文件。Context UTF-8名义输入、adapter输出上限与费率随调用冻结，dispatch同一队列/SQLite CAS检查self、child及不可变predecessor的唯一额度；不将预留额写入canonical usage。
- 父预算1200、两个700上限的真实本地反例由两次provider进入/最终1400，改为一次进入/最终700及另一份affirmative undispatched凭证。unknown、取消和partial仍保留未结算维度；实际超额不截断。额度不是通用physical token或invoice硬上界，G03完整共享预算验收不勾选。
- 隔离原始193用例通过，受限Node网络重跑为同193而非新增193；独立探针5通过，另保留基线已有duplicate response revision旧值问题。后者已在独立源码提交 `bf3b1c7843811766c70b66625f59b872c8806b79` 修复，未改写原冻结证据。Host结算竞态只在账本revision变化时按已有有界CAS重试，稳定坏回执仍拒绝。
- 与已提交G01及G04精确冻结源码整合后，完整编译、Web类型和75项定向回归通过；原架构7/API4失败保留。便携证据：[shared-run-model-allowance.md](docs/shared-run-model-allowance.md)。零外部模型调用、未push，G03整体仍未完成。

### 后续推进：G03 重复回执的同快照 revision（2026-10-30）

- 本地源码 `bf3b1c7843811766c70b66625f59b872c8806b79` 固定2文件；duplicate reconcile 与 affirmative undispatched 从同一个原生 claim/snapshot 读取自身及父 accounting revision，避免识别新回执后返回旧 heap revision。canonical usage、事件和已持久化结果不因重复请求改变，无额外强制 heap reload。
- 四个确定性交错反例由4失败→4通过；最终197唯一用例严格为原193及新增4。独立补充6项与root当前基线集成31项分别报告，不叠加计数。完整Runtime/CLI/Server编译及新增测试strict检查通过，原架构7/API4失败保留。
- 受限网络重跑包含37进程/40个PID与threadId上下文、24个Unix与3个loopback连接，零非本地连接尝试；仅作为受控Node socket证据。原17文件历史归档默认便携核验仍通过，其workspace检查应使用 `1bf62ef299e9935dbc27f4d9caf46aa7f75f83d2`；新归档另外核验当前2文件。
- 说明、前后失败与源码提交绑定见 [model-accounting-duplicate-revision.md](docs/model-accounting-duplicate-revision.md)。此修复限定为返回的revision一致性，不代表通用物理token/invoice硬上界或G03整体验收。

### 后续推进：G04 独立文件操作批量恢复（2026-10-30）

- 本地源码 `bf6a34cdeede8e95e7932339de736f209954ecc5` 固定15文件。最多128操作/256路径/64MiB读取，整组已结算及未结算参与者共同锁定、核查、持久化authority fence，并在continuation前重新检查；保留既有纯patch版本链与原权限。
- 真实两次native move完成后退出的反例，重启证据0→2、自动恢复false→true，单个completed continuation实际只读2次，rename维持2次，inode/mtime/字节不变。六个混合/移动故障进程场景保留实际cut，未伪造tool terminal或重放授权。
- 最终133用例通过，独立四组探针验证全组锁、完整事务范围、跨线程seq和延期重检。原始emit使用noCheck与新增可达图strict检查分别报告；root跨G01/G03整合另外完成严格完整编译及75项定向检查，不将重跑数与133相加。
- native写工具仍互斥，真实证据仅支持多个settled加最后一个unfinished；不声称同Run多个同时未决native写、目录move、远程副作用或任意工具自动重放。说明和完整失败证据：[workspace-operation-batch-recovery.md](docs/workspace-operation-batch-recovery.md)。G04及全部G01–G07保持active。

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
- [ ] 统一成果来源、去重、版本关系和主次排序，修复空 outputPaths 屏蔽已有产物的问题。（当前文件观察、正式声明与事件metadata版本绑定已验证，晚到旧代际不回退；tool-only来源和完整历史字节仍未完成。）
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
- [ ] 先统一模型调用、上下文编译、计量、事件与工具生命周期；保留角色专属策略。（共享模型 invocation／capture／deadline、child repair／compaction、私有 checkpoint、持久物理用量与迟到对账已完成本地功能回归；普通回合 thinking 共享恢复、Host 记账边界收敛及 overflow 不确定调用停止／legacy有界恢复已完成；原生overflow成功恢复、完整 child compiler／extension parity 和内部接口18/16门禁仍待完成。）
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

- [ ] 先采样模型调用前处理耗时、SQLite 读行数、JSON 解码 CPU、RSS、文件读取次数和缓存命中。（主 invocation 的固定smoke／100k对照已记录wall／CPU／returned rows／RSS／文件读取与index telemetry，完整范围仍待补齐。）
- [ ] 复用已有增量投影机制，为 loop guard、mailbox 等引入 watermark / typed-event cursor；保留完整 replay 作为校验基准。（沿用既有loop guard游标，主 invocation新增Run级输入游标并与完整oracle比较；mailbox未覆盖。）
- [ ] 记忆索引按变更维护，基于文件摘要缓存校验依赖；候选检索与有效性检查之间保持正确性。
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
