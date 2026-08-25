# Napier 下一阶段目标：可组合执行内核与桌面任务工作台

> 状态：方向已确定，待持续推进
>
> 评审基线：Napier `2cd9a3c`（2026-08-19）
>
> 对照基线：[Oh My Pi](https://github.com/can1357/oh-my-pi) `8500092`、[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) `99f6f02`

## 1. 文档用途

本文定义 Napier 下一阶段值得持续投入的产品与技术方向，供 Codex 理解问题、选择高价值切入点并逐步实现。它不是逐文件改造清单，也不是带硬性数字的完成合同。实现者应以当前代码和真实任务反馈为依据，自主拆解阶段工作，并允许在实践中调整方案。

下一阶段不应继续围绕“已有能力的更多管理页面、回执或协议层”横向扩张。核心任务是把已经很强的可审计底座，转化为更强的 Agent 执行质量、更低的使用摩擦，以及真正成熟的桌面任务体验。

## 2. 当前判断

Napier 已经具备难得的工程底座：有序 Ledger、投影与回放、分支与恢复、最后时刻策略检查、Sandbox、审批、预算与收口、工具证据、CLI/Web/SDK/RPC 一致入口。这些是后续演进必须保留的优势。

但当前产品仍有四个结构性差距：

| 领域       | 当前实现                                                                                                                     | 与优秀项目的主要差距                                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agent 架构 | 已有 Service、Profile、Plugin 和 Hook，但 `AgentKernel.runPrompt()` 仍主要委托给大型 `AgentRuntime`；Hook 多由已落账事件反推 | DeepSeek Harness 的插件树直接组成实际执行路径，模型、工具、会话和 Agent Loop 都可替换；实时 waterfall 能在执行前改写、拒绝或包裹调用             |
| Harness    | 工具、策略、Prompt、进度、压缩、恢复能力丰富，但大量逻辑仍集中在 `runLive()`，默认工具面宽，模型适配主要停留在缓存与输出参数 | Oh My Pi 更重视模型族适配、流式守卫、精简工具协议、结构化读写、无效结果裁剪、多级压缩与任务中途 steering；Harness 更直接地服务于一次任务是否完成 |
| 产品闭环   | 功能覆盖和证据体系很深，但真实试跑仍暴露配置、Sandbox、Skill 缺失和重复失败等摩擦；现有小样本不足以证明普遍优势              | 优秀产品把环境协商、能力降级、错误恢复和模型差异消化在默认路径内，用户通常从一句任务直接进入有效执行                                             |
| 桌面 UI    | 已有清晰的三层导航和轻量视觉，但大面积空白、弱对比小字、泛化渐变视觉与密集管理面板并存；`styles.css` 和多个面板组件过大      | DeepSeek Harness 用独立 theme/layout/feature 包建立清晰样式所有权；成熟 Agent UI 会优先呈现任务、变更和验证，把轨迹、回执和配置渐进披露          |

关键结论：Napier 的短板已经不是“缺少更多能力”，而是执行主链尚未由 Kernel 真正拥有、Harness 没有足够压缩模型的选择空间、产品默认路径仍泄露过多内部复杂度。

## 3. 北极星

在桌面端，用户打开一个工作区、描述任务后，Napier 应能用最少的前置配置完成可验证的真实工作；用户始终知道它正在做什么、为什么停下、改了什么、验证是否通过，并能在同一上下文中批准、纠偏或恢复。

对开发者而言，新增或替换模型策略、工具策略、上下文治理、恢复行为或 UI 能力，不应继续修改 `AgentRuntime` 的中央流程，而应通过可检查、可组合、可卸载的 Kernel 能力完成。

## 4. 优化方向

### 方向一：让 Kernel 逐步接管真实执行主链

目标是从“Kernel 包裹 Runtime”演进为“Runtime 的行为由 Kernel 组合”。这不是为了追求插件化形式，而是为了让 Agent 的核心行为可以被替换、复用、测试和理解。

当前 `AgentKernel.runPrompt()` 仍然把执行交回 `AgentRuntime`，模型调用、工具准备、策略检查、进度治理、压缩和恢复等关键逻辑则集中在 `runLive()` 内。现有 Hook 主要观察已经写入 Ledger 的事件，因此适合审计，却很难承担执行前改写、执行过程包裹或策略替换。长远来看，每增加一种 Harness 行为，都可能继续扩大中央 Runtime。

建议围绕以下方向演进：

- 形成清晰而唯一的 turn / step / model / tool 生命周期，让模型请求、流式响应、工具执行、上下文维护和 turn 收口都有稳定的实时扩展位置。
- 区分可组合的行为与不可降级的安全守卫。插件可以改写 Prompt、调整工具、增加重试或补充上下文，但不能绕开权限、Sandbox、预算和 Ledger 一致性。
- 让 Model、Prompt、Tool、Policy、Context 和 Completion Adapter 真正参与调用路径，而不是只提供与现有实现同名的门面。
- 为 run、agent 和插件建立清晰作用域，使临时注册、资源占用和事件监听能够随作用域可靠释放。
- 让 Profile 表达一次 Agent 实际由哪些能力组成，并能检查最终解析结果，方便定位“为什么这次运行采用了这套行为”。
- 选择一项当前硬编码在 `runLive()` 的横切能力作为迁移样板，例如超时重试、上下文治理或工具后处理。先证明纵向链路成立，再逐步迁移其他能力。

理想状态是：以后新增一种模型策略、工具治理方式或恢复机制时，开发者首先考虑增加或替换一个 Kernel 能力，而不是继续修改中央循环。`AgentRuntime` 仍可承担协调职责，但不再是所有行为唯一可进入的位置。

### 方向二：建立真正的模型感知 Harness

目标是让不同模型获得适合自己的运行环境，而不是共享一套大而通用的 Prompt、工具和循环参数。模型能力差异不只体现在上下文窗口和最大输出，还体现在工具调用格式、并发倾向、推理方式、错误模式、缓存特征、流式稳定性和对提示语言的敏感度。

建议引入可检查的 Harness Profile，将以下内容作为一个整体解析：

- 模型族与 Provider 的 Prompt 结构、工具描述风格和消息转换方式。
- reasoning、并行工具调用、超时、重试、流式空转检测和不完整工具调用恢复策略。
- 当前模型适合直接看到哪些工具，哪些能力更适合按需加载或通过统一入口访问。
- 上下文压缩触发方式、保留重点和溢出后的恢复路径。
- 对特殊模型行为的修正，例如伪造工具结果、长思考无输出、重复参数修复或停止原因异常。

运行证据应能够回答最终采用了哪套 Harness 决策，但不需要把这些内部参数都推到普通用户面前。用户只需要看到简洁、可理解的模式摘要；详细配置留给诊断与高级使用。

这一方向可以参考 Oh My Pi 对 Provider 方言、流式守卫、工具协议和压缩策略的长期打磨，也可以借鉴 DeepSeek Harness 将 Model Adapter、Agent Loop 和其他能力放在同一组合体系中的做法。重点不是复制其实现，而是让 Napier 的模型支持从“可连接”提升为“针对性运行良好”。

### 方向三：压缩工具面与上下文负担

目标是减少模型每一步要理解的选择和历史噪声，让它更快进入有效操作，并在长任务中持续保留真正重要的信息。

Napier 当前工具能力非常丰富，这是产品优势，但默认 Profile 同时暴露大量搜索、编辑、进程、调试、计划、审批和预览/应用工具，会放大工具 Schema、选择错误与参数修复成本。工具结果、计划投影、记忆、里程碑和多种控制信息也可能共同挤占上下文。

建议重点优化：

- 建立工具面编译过程，根据任务意图、模型能力、环境状态和当前阶段生成更小的活跃工具集。
- 保留一组稳定的核心工具，把低频能力放入统一目录、挂载协议或按需激活机制。动态能力仍应经过相同的策略、审批、Ledger 和 UI 渲染流程。
- 收敛模型可见协议。用户侧需要保留预览、确认和可回滚性，但模型不一定需要理解大量成对的 preview/apply 工具及其内部状态。
- 强化“读—搜—改—验证”的连续契约：读取结果提供稳定结构锚点，编辑能识别过期上下文并引导恢复，搜索与命令输出给出紧凑摘要，完整内容通过可重开的 Artifact 保留。
- 优先用确定性规则裁剪空结果、已被取代的读取、重复错误和低价值大输出，再决定是否调用模型做摘要。
- 压缩时重点保护用户约束、计划进度、已修改文件、关键代码位置、验证结果、未决问题和恢复线索。长任务摘要应更像可继续工作的交接记录，而不是聊天内容概括。
- 从“完全相同的工具调用”扩展到“结果没有产生新信息”的停滞识别，减少参数轻微变化但实质无进展的循环。

这个方向的成效可以通过趋势观察：模型首轮看到的工具和 Prompt 是否变小、是否更快开始有效操作、无效调用与重复失败是否减少、压缩后是否仍能继续修改和验证。数据用于判断优化是否有效，不需要预先设成僵硬的发布门槛。

### 方向四：把 Web 重塑为桌面任务工作台

目标是让 Web 从“能力与证据控制台”转变为“围绕任务完成组织的桌面工作台”。本阶段只考虑桌面端，不包含移动端、窄屏或触控适配。

当前界面已经整洁，也建立了工作区、对话、轨迹和 Workbench 的基本结构，但首屏大面积留白、弱对比小字和泛化渐变让产品显得更像展示页；进入任务后，高级面板、内部术语和管理能力又带来较高信息密度。两种密度之间缺少一条稳定的任务主线。

建议从信息架构开始，而不是先换颜色：

- 将“选择工作区 → 描述任务 → 观察进展 → 处理必要决策 → 查看变更与验证 → 继续或结束”设为核心路径。
- 对话、当前动作、变更摘要、测试结果和待用户处理事项应属于主工作面。普通任务不应要求用户主动进入轨迹、Workbench 或设置面板才能完成。
- Ledger、原始事件、哈希回执、实验与诊断能力继续保留，但放入渐进披露层。默认状态使用用户语言解释进度、风险和结果。
- 重新设计空态：减少装饰性 Hero 和无效留白，让最近任务、当前工作区、输入区域和运行准备状态形成更有用的桌面首屏。
- 重新设计运行态：强调 Agent 当前在做什么、哪些工作已完成、是否正在等待，以及用户下一步可以采取什么动作。工具密集日志应可以折叠和概览，而不是与关键结果争夺注意力。
- 让完成态围绕结果组织：修改了哪些文件、关键 diff、验证是否通过、生成了哪些 Artifact、还有什么风险或未完成事项。

视觉与工程层面建议建立 `DESIGN.md` 和集中式语义 Token，明确主题、布局和 Feature 样式的所有权。逐步拆分 `styles.css`、`ContextPanel.tsx` 等热点，让组件样式就近维护，并形成稳定的字体、间距、色彩、阴影、动效和状态语言。

Napier 的视觉气质应当克制、可信、精确，突出“工作正在被可靠完成和验证”。可以学习 DeepSeek Harness 的模块化主题体系，但不应复制其蓝色渐变和界面表层。更重要的是形成自己的密度节奏、证据表达和任务状态设计。

交互上应继续强化桌面键鼠体验：清晰的焦点、可靠的快捷键、可预期的抽屉和面板、稳定的尺寸与上下文记忆，以及完整的空、加载、运行、审批、失败、恢复、完成和禁用状态。视觉评审应覆盖真实长对话和工具密集任务，而不只是判断页面是否溢出。

### 方向五：降低默认路径的环境与配置摩擦

目标是让用户尽可能从一句任务开始，而不是先理解 Provider、Preset、Capability、Sandbox、Projection 或 Receipt。

建议让启动和运行阶段主动协商 Provider、凭据、Sandbox、浏览器、Skill 与项目环境。某项能力不可用时，不必让整个默认模式失效；可以先保留可工作的部分，并在任务真正需要该能力时给出就地解释和修复入口。

错误处理需要从“记录得很完整”进一步走向“用户能继续工作”：

- 缺失 Skill、不可用工具、依赖未安装或权限不足时，先判断能否换路径或完成局部任务。
- 如果需要用户处理，集中说明原因、影响和下一步，不要让 Agent 反复尝试同一失败动作。
- 配置修复、审批、用户纠偏、断线和进程恢复后，尽量回到原任务连续体，避免用户重述目标或面对多个语义重复的 Run。
- 默认 Harness/Profile 可以自动选择，同时提供简短而透明的摘要；高级用户仍可检查和覆盖，但不把选择负担转嫁给所有人。

这一方向的理想体验是：环境复杂度由系统消化，只有真正需要决策或权限时才打扰用户，而且每次打扰都能明确推动任务前进。

### 方向六：让工程结构和评估方式服务于持续迭代

目标是减少“功能很多但越来越难改”的风险，并让优化效果更多来自真实任务，而不是来自回执数量。

`AgentRuntime`、Store、Server App、`styles.css` 和若干大型 Web 面板已经成为所有权热点。后续改动应顺带梳理边界：把稳定领域能力提取到有明确输入输出的模块，让中央入口主要负责组合与协调，避免创造新的大型 Barrel 或单文件中心。重构不必追求一次性清零，而应跟随真实功能切片渐进发生。

评估方面，继续保留 Napier 已有的基准、Ledger 和可复现实验优势，但把关注点转向任务结果：是否完成、多久开始有效工作、经历多少无效调用、用户为什么需要介入、压缩或恢复后是否还能继续。真实桌面走查、开发者日常使用和失败样本应持续反馈到 Harness 与 UI 设计。

对照测试应尽量保持同模型、同 Provider、同任务和相近环境预算。Oh My Pi 更适合用于编码结果、工具效率和恢复体验对照；DeepSeek Harness 更适合用于组合性、扩展点和 UI 工程组织对照。对照的价值是发现设计差距，而不是用少量样本宣称全面领先。

## 5. 建议的推进方式

以下顺序用于表达依赖关系，不是强制的完成关卡：

1. 先记录一组轻量基线，包括典型任务轨迹、工具与 Prompt 体积、常见重复调用、配置干预以及桌面空态/任务态截图。
2. 选择一个真实任务做 Kernel 纵向切片，让模型请求和工具调用真正经过新的实时扩展点，并迁移一项横切能力。
3. 在默认编码路径上优化 Harness Profile、工具面和上下文治理，确认方向有效后再推广到浏览器、数据和长任务。
4. 在执行语义相对稳定后调整桌面信息架构与视觉系统，并通过真实任务持续校正，而不是一次性完成整站换肤。
5. 持续运行真实任务与公平对照，把暴露出的失败、停滞和配置摩擦反哺前述方向。

每次实现更适合交付一个可使用的纵向改进：既包含真实路径接入，也包含必要的验证和体验呈现。避免长期保留两套并行执行逻辑，也避免只搭出抽象接口却不进入默认路径。

## 6. 范围与原则

- 采用渐进式演进，不追求 Big Bang 重写。
- 保留 Ledger、确定性投影、最后时刻策略、Sandbox、审批、回放和证据完整性等已有优势。
- 学习 Oh My Pi 与 DeepSeek Harness 已验证的设计，但不以复刻任何一个项目为目标。
- 本阶段不扩展分布式执行、团队协作、RBAC、插件市场或任意不可信进程内插件。
- 本阶段不考虑移动端、窄屏与触控适配，桌面工作流是 UI 优化对象。
- 新能力优先服务于任务主路径，谨慎增加一级导航、常驻面板和新的内部术语。
- 测试与证据应服务于设计反馈和回归保护，不把增加测试数量或生成更多回执当成独立产品目标。

## 7. 期望看到的变化

这些是判断方向是否有效的观察信号，不是严格的完成条件：

- 新增横切行为时，开发者可以通过 Kernel 能力完成，而不必继续扩大 `runLive()`。
- 模型看到的工具和上下文更聚焦，能够更早进入有效读、改、验动作。
- 长任务经过压缩、纠偏或恢复后，仍保留目标、改动和未决问题的连续性。
- 用户不需要先配置大量内部概念；出现阻塞时，界面提供一个清晰原因和可继续的下一步。
- 桌面首屏更像可立即工作的工具，运行态更容易判断进度，完成态更容易检查结果与证据。
- 高级审计能力仍然完整，但不再主导普通任务的视觉与交互层级。
- 代码热点随着功能切片逐步变薄，模块边界和样式所有权更容易被新开发者理解。
- 基准与真实使用显示出更少的无效调用、重复失败和人为推动，即使具体数值会随模型和任务变化。

## 8. Codex 使用说明

- 实现前以当前代码和真实运行行为为事实源，不把历史 gap matrix 直接当作仍然有效的待办清单。
- 从上述方向中选择当前收益最高、依赖清楚的纵向切片，自行形成更细的实现计划和测试方案。
- 可以采用不同于本文示例的技术方案，但应说明它如何改善对应问题，以及是否影响 Ledger、安全或兼容性。
- 在阶段记录中说明获得了什么实际改善、还有哪些未解决问题即可；不需要把本文扩写成逐函数清单或为了“打勾”制造形式化证据。

## 9. 2026-08-20 当前实现审计与首个实施切片

本节记录基于 `2a75ed5786d0` 源码、默认运行路径和真实测试得到的阶段判断，用于校准后续实现优先级。它是对前述六个方向的状态补充，不改变本文作为长期方向文档的性质。

| 方向                | 当前覆盖度               | 审计判断                                                                                                                                                                             |
| ------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Kernel 接管执行主链 | 部分覆盖                 | `ComposableAgentModelCallPipeline` 已进入真实模型调用路径，证明纵向切片可行；Prompt、Tool、Policy、Context 与 Agent Loop 仍主要由 `AgentRuntime` 直接协调，Kernel 尚未拥有完整主链。 |
| 模型感知 Harness    | 部分覆盖                 | 已有按模型族解析的 Harness、工具面裁剪、重试与 thinking-loop 守卫；粒度仍以 API family 为主，尚未形成具体模型、任务阶段、环境能力共同决定的可评测 Profile。                          |
| 工具面与上下文负担  | 部分覆盖，存在 P0 缺口   | 已有 checkpoint、continuity evidence、确定性 tool-result pruning 与完整 Ledger；但跨 Run 重建只恢复普通文本消息，带工具调用的 assistant 消息及对应结果不会进入下一 Run 的模型历史。  |
| 桌面任务工作台      | 部分覆盖                 | 工作区、会话、运行轨迹、审批与结果面已具备，近期项目切换也保留了工作区隔离；主任务路径仍会暴露较多内部面板和术语，结果、验证和待处理事项的视觉优先级仍可提升。                       |
| 默认环境与配置摩擦  | 高度覆盖，仍需持续优化   | Provider、Sandbox、审批、恢复、能力检测与失败证据已有完整基础；真实任务仍可能因缺失能力、环境配置或重复失败而中断，默认降级和就地恢复尚未完全消化这些复杂度。                        |
| 工程结构与真实评估  | 高度覆盖基础，热点仍明确 | 架构检查、预算、Ledger、回放、实验和评测基础完整且当前无依赖环；`AgentRuntime`、Store、Server 与大型 Web 模块仍是所有权热点，后续应随纵向能力渐进提取。                              |

已经验证的默认路径基础包括：有序 Ledger 与确定性投影、模型调用 Kernel pipeline、最后时刻 Policy、Sandbox、审批、预算、取消、回放、工具结果证据和跨入口一致性。这些能力是后续优化的边界，不因上下文或架构重构而绕过。

当前最高优先级缺口是跨 Run 的模型上下文连续性。一次 Run 内，assistant 的 tool call 与 tool result 会保持连续；但带 tool call 的 assistant 响应只记录为 `model.response`，不会生成普通 `message.assistant`。现有历史投影又只读取用户文本、assistant 文本和 continuation prompt，因此下一次 Run 会丢失近期完整工具交换，只可能在之后的 compaction summary 中看到经过归纳的工具事实。这会导致重复读取、重复执行，以及对上一轮精确结果的错误判断。

首个实施切片聚焦 canonical `ConversationSurface`：

- 从不可变 Ledger 投影普通对话和可验证的 assistant tool-call/tool-result 完整单元，再交给现有 provider-specific message adapter。
- 以 `model.response` 中的 tool calls 和 `context.tool_result` receipt 为事实入口，通过本地 result capsule 恢复完整结果，并校验 thread、run、call、tool 与内容哈希绑定。
- 多个 tool call 必须全部恢复后才暴露该 assistant turn；缺失、redacted、冲突、损坏或已过期的 capsule 均整单元省略，禁止制造孤立 tool call、孤立 tool result 或伪造替代结果。
- compaction 与 recent retention 以完整单元为边界；原始 Ledger 不改写，历史 checkpoint schema v1 及其文本事件哈希语义保持兼容，不要求迁移已有 checkpoint。
- 新投影逻辑放入边界明确的小模块，`AgentRuntime` 只负责组合，避免继续扩大中央文件。

本切片的验收重点是：完整且可验证的历史工具交换在下一 Run 能 100% 成对恢复；压缩和近期保留不会拆散工具对；不可恢复数据按失败关闭原则安全省略；普通文本历史与已有 checkpoint 继续兼容；Policy、Sandbox、预算、取消、Ledger 落账和 provider 转换路径均不被绕过。验证应覆盖真实 tool-using Run 到下一 Run、多个调用配对、capsule 缺失或损坏、checkpoint/compaction 边界和既有文本历史回归。

本切片不扩展为完整 `TurnPipeline` 重构，不迁移 tokenizer，不重做桌面 UI，不更换工具协议，也不把当前实现扩大为模型级 Harness 重写。这些方向继续保留在后续阶段，待 `ConversationSurface` 的纵向路径稳定后再推进。

## 10. 2026-08-20 `ConversationSurface` 实施结果与剩余覆盖

首个 P0 纵向切片已经完成，但本文定义的六个长期方向尚未整体完成。这里的“完成”只指跨 Run 完整工具上下文恢复这一项已达到当前验收边界，不代表 Kernel、模型级 Harness、工具协议、桌面工作台、默认环境或工程热点已经收口。

已落地并验证的行为：

- 新 Run 的模型历史由 canonical `ConversationSurface` 统一组合普通文本事件和完整 assistant tool-call/tool-result 单元；provider-specific message adapter、Policy、Sandbox、预算、取消和 Ledger 路径保持原样。
- 每个新工具交换写入私有、内容寻址的 Surface capsule，并以 thread、run、Model Context Envelope、turn、tool-call set、exchange 与 capsule 哈希绑定；本地存储限制为单对象 8 MiB、最多 4096 个对象、总量 128 MiB。
- 新 Surface receipt、`model.response`、tool terminal event 与可用的只读 result capsule 交叉校验。任何重复、歧义、缺失、损坏、redacted、显式 unavailable 或跨保留边界的单元均整组省略，不制造孤立 tool call/result；不属于旧冻结重放能力面的工具仍由新的 Surface capsule、模型响应和 terminal event 完整绑定。
- 升级前且没有任何 Surface 成功或失败声明的 Run，可从后续哈希绑定的 model-invocation capsule 恢复完整相邻交换；一旦新 Surface 已声明但不可用，不再降级到 legacy 路径。
- checkpoint schema v1、原文本事件 source hash 和不可变 Ledger 均未改写；成功 checkpoint 后只投影 `toSeq` 之后的完整 Surface，compaction 失败回退也按保留边界整组失败关闭。
- `AgentRuntime` 仅负责捕获和投影组合，Surface capsule、声明、结果证据、legacy 兼容、usage 与存储分别位于独立模块；中央文件从 3334 行降至 3323 行，没有提高架构预算。

真实回归覆盖包括：跨 Run 恢复完整工具交换、Surface capsule 缺失、升级前会话兼容、多工具结果损坏、Ledger result receipt 缺失、保留边界切断、既有 checkpoint、JavaScript/Python persistent Kernel，以及完整 AgentRuntime 主路径。实现后的阶段覆盖判断如下：

| 方向                | 实施后覆盖度            | 剩余缺口                                                                                                                                                 |
| ------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kernel 接管执行主链 | 部分覆盖                | 本切片仍由 `AgentRuntime` 触发捕获和投影；Prompt、Tool、Policy、Context、Agent Loop 尚未成为可替换的完整 Kernel pipeline。                               |
| 模型感知 Harness    | 部分覆盖                | 未新增具体模型级 Profile、模型角色路由、专项 Prompt/工具协议或可评测 fallback；仍需从 API family 粒度继续下沉。                                          |
| 工具面与上下文负担  | P0 已修复，方向部分覆盖 | 跨 Run 工具对已完整恢复并失败关闭；token-aware 预算、prefix-stable/overflow recovery、活跃工具集编译、统一 read/edit 与 code-mode tool bridge 仍未完成。 |
| 桌面任务工作台      | 部分覆盖                | 本切片没有改动桌面信息架构、运行态、完成态、设计 Token 或大型 Web 样式/组件热点。                                                                        |
| 默认环境与配置摩擦  | 高度覆盖，仍需持续优化  | 本切片没有新增 Provider/Sandbox/Skill 自动降级和就地修复体验；缺失能力与重复失败仍需由真实任务继续校准。                                                 |
| 工程结构与真实评估  | 高度覆盖基础，局部改善  | Surface 已按职责拆分并通过架构门禁，但 Store、Server、Contracts、Web 与更大的 Runtime 生命周期仍是所有权热点；效果指标和同模型 Harness A/B 尚未建立。    |

因此当前结论是：`next.md` 的第一优先级第 1 项已经完成，第 2 项中跨 Run、配对、失败关闭和 compaction 保留边界已覆盖；overflow 后恢复与效果指标/A/B 仍未完成。下一实施优先级应是建立 token-aware、prefix-stable、overflow-recoverable 的上下文治理，同时记录重复工具调用、无新信息调用、token、首个有效动作时间和人工介入原因。完整 Kernel 主链迁移继续作为其后的结构性工作，不在本切片中提前展开。

## 11. 2026-08-20 token-aware 上下文治理实施切片

本切片承接 `ConversationSurface`，解决 `next.md` 4.4 所述字符预算与 provider overflow 缺口。实现边界是模型调用前的统一、可校准 token 压力治理，以及 provider 明确认定上下文溢出后的一次有界恢复；它不引入未经验证的 tokenizer 依赖，不重写既有 checkpoint schema，也不把本阶段扩大为完整 Kernel 主链迁移或效果指标/A/B 建设。

数据模型与调用顺序：

- 在 Kernel model-call pipeline 增加 final-context 阶段。既有 model-aware Harness 和确定性 tool-result pruning 仍先执行；最终 system prompt、活跃 tools 和 options 已知后，再由 token-pressure 能力统一核算 system、tool definitions、messages、reasoning reserve 与 output reserve。最终投影完成后才写 Model Context Envelope、Prompt Package 和 invocation capsule。
- 首版 meter 使用 provider/model-aware、可校准的保守估算：以规范序列化后的 UTF-8 bytes 为输入，记录 meter 版本、估算方法、provider/model calibration 和各组成部分 token；不伪装成实际 provider tokenizer。校准表与 meter 接口独立，后续可替换成真实 tokenizer，而不改变投影和回执契约。
- output reserve 取实际调用 `maxTokens` 与模型上限中的有效较小值；reasoning model 额外保留有界 reasoning reserve。二者都计入 context window，禁止通过只裁历史消息来掩盖 system/tools 本身已超限。
- 压力投影保持 system prompt 和 tool definition 的字节内容不变，只从最老的消息单元开始移除；assistant tool-call 与其连续 tool-result 必须作为一个不可拆分 Surface，最新用户消息必须保留。这样无压力请求完全零漂移，有压力请求保留最长稳定后缀，未被裁剪的消息及静态 prompt 前缀保持字节稳定。
- 既有 checkpoint 继续负责跨 Run 的语义摘要；final-context 投影只处理调用时仍然超预算的尾部压力，不写回或篡改 Ledger，不伪造摘要。历史 compaction 的触发预算改由同一 meter 派生的模型输入预算约束，避免继续以 16k–96k 字符常量作为事实边界。

失败关闭与 overflow 恢复：

- 如果 required prompt、tool definitions、最新用户消息和 reserves 本身超过模型窗口，调用在 provider 之前失败关闭，Ledger 记录各组成部分、预算、投影原因与内容哈希；不删除工具、不截断用户约束，也不绕过 Policy。
- provider overflow 只根据规范化后的 provider error message 机器识别；认证、配额、网络、超时、主动取消、thinking-loop 或普通 `length` stop 均不得触发。第一次 overflow 必须在未向 agent loop 暴露任何可见内容时才允许恢复。
- 恢复最多一次，使用更严格的安全余量重新执行 final-context 投影，并重新经过 Prompt 编译、Model Context Envelope、Prompt Package、invocation capsule、取消 deadline 和 provider stream。第一次失败 envelope 由独立 overflow Ledger 事件终结绑定；第二次仍 overflow 时原样进入现有公开失败路径，禁止无限重试或切换模型。
- 每次投影与恢复都记录内容哈希、原始/活跃 token 估算、移除的完整消息单元数量、reserve、overflow 诊断哈希和前后 envelope 绑定；回执不包含被移除的私有正文。预算耗尽或 Run signal 已取消时不得发起恢复。

测试矩阵：

- meter：ASCII/CJK/多字节内容、provider/model calibration、system/tools/messages/reserves 求和、output 上限与 reasoning reserve。
- 投影：预算内零漂移；按最老完整单元裁剪；多 tool-call/result 不拆分；最新用户消息保护；静态 prompt/tool 哈希稳定；不可满足的最小上下文在 provider 前失败关闭。
- 顺序与证据：Harness `-500`、tool-result pruning `-400` 先于 final-context governor；最终 envelope 与实际 provider context 一致；回执哈希校验，且不泄露被裁正文。
- overflow：典型 OpenAI/Anthropic/兼容 provider 错误只恢复一次；第一次 envelope 有终结绑定，第二次调用使用更严格投影；第二次 overflow、非 overflow、已有可见 delta、取消和预算耗尽均不错误重试。
- 集成回归：跨 Run `ConversationSurface` 工具对在预算内完整保留、压力下整组移除；thinking-loop retry、取消、预算、Policy/Sandbox、Prompt Package、回放和现有文本历史行为保持有效。

本切片完成后的准确表述应是：`next.md` 4.4 的统一 token 预算、稳定投影和一次 overflow 恢复达到当前实现边界；真实 provider tokenizer、模型摘要策略升级、效果指标/A/B、活跃工具协议压缩、code-mode bridge 与完整 Kernel 主链仍属于后续工作，不能据此宣称六方向整体完成。

## 12. 2026-08-20 token-aware 上下文治理实施结果与最终覆盖审计

第二个上下文治理切片已经完成当前实现边界。最终模型调用现在由固定顺序的 Kernel model-call pipeline 处理：model-aware Harness（`-500`）和确定性 tool-result pruning（`-400`）先执行，final-context governor（`10000`）在 Prompt、工具和输出选项确定后统一计量并投影。standalone `AgentRuntime` 与 Kernel 装配路径安装同一组内建扩展，不再因入口不同而绕过上下文治理。

已落地并验证的行为：

- provider/model-aware 的可校准保守 meter 统一核算 system prompt、tool definitions、messages、output reserve、reasoning reserve 与 safety reserve；回执明确记录估算方法和 calibration ID，不把估算伪装成真实 tokenizer。
- 预算内上下文保持对象与字节内容不变；发生压力时只移除最老完整会话单元，assistant tool calls 与连续 tool results 不拆分，最新用户单元始终保护。必要 Prompt、工具、最新用户消息和 reserves 本身无法装入窗口时，在 provider 调用前失败关闭。
- provider-confirmed context overflow 只有在未产生非空文本、thinking 或 tool-call 输出且未取消时才恢复，最多一次。第二次投影必须至少移除一个更老完整单元并使用更严格 safety reserve，否则在第二次 provider 调用前失败关闭。
- overflow 恢复重新经过 Prompt 编译、final projection、Model Context Envelope、Prompt Package、invocation capsule、deadline、取消和 provider stream；第一次失败 envelope 由 `model.context.overflow` 一对一终结，回放和证据校验不会留下悬空请求。
- Harness 聚焦工具面会优先保留已经审批并由 schema search 激活的 deferred `mcp__*` 工具，修复了 standalone Runtime 启用内建 Harness 后动态 MCP 工具在下一轮被固定上限再次裁掉的兼容问题；Policy、审批和工具数量上限保持不变。
- 取消与 watchdog 测试夹具使用能够容纳完整默认 Prompt/工具面的模型窗口，使测试继续验证 provider stream 的取消语义，而不是在 provider 前被新的 context admission 正确拒绝。

最终验证结果为：Runtime 376 个测试文件、1839 项测试通过，14 个 live 文件中的 32 项环境依赖测试按条件跳过，零失败；根级 typecheck、sealed default-product source、架构门禁和 diff hygiene 均通过；架构审计覆盖 1754 个源码文件与 797 个测试文件，零允许依赖环；`AgentRuntime` 保持 3323 行硬预算。

对照本文六个长期方向，当前覆盖结论如下：

| 方向                | 当前覆盖度                                  | 已达到的边界                                                                                                                                         | 仍未覆盖的关键部分                                                                                                                                               |
| ------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kernel 接管执行主链 | 部分覆盖，纵向 seam 已成立                  | model call、Harness、tool-result pruning、final-context projection 与 overflow recovery 已进入真实 Kernel pipeline，扩展有稳定顺序、检查与卸载边界。 | Prompt、Tool、Policy、Completion 与完整 Agent Loop 尚未组成统一可替换 TurnPipeline；`AgentRuntime` 仍直接创建工具、Prompt builder 并执行最终 Policy preflight。  |
| 模型感知 Harness    | 部分覆盖                                    | 已按 API family 解析 Prompt 方言、工具上限、重试策略，并有 provider/model-aware token calibration、reasoning reserve 与模型调用证据。                | 仍缺具体模型 pattern、任务阶段和环境能力联合解析，缺编辑协议、角色路由、fallback/凭据轮转以及用公平 A/B 校准的模型 quirks。                                      |
| 工具面与上下文负担  | 两个 P0/P1 上下文切片完成，方向高度部分覆盖 | 跨 Run 完整工具交换、失败关闭 Surface、确定性结果裁剪、统一 token 预算、完整单元投影、一次 overflow recovery 和 deferred MCP 激活均已覆盖。          | 真实 provider tokenizer、模型摘要策略升级、统一 read/edit/tool-discovery 协议、code-mode tool bridge、按任务阶段动态重编译工具面，以及无新信息调用指标仍未完成。 |
| 桌面任务工作台      | 部分覆盖                                    | 已有工作区、会话、运行、审批、结果和近期项目切换基础。                                                                                               | 本轮未重构桌面信息架构、空态/运行态/完成态、设计 Token、样式所有权和大型 Web 热点，普通任务仍未完全围绕结果与待处理事项组织。                                    |
| 默认环境与配置摩擦  | 高度覆盖基础，仍未收口                      | Provider、Sandbox、审批、恢复、能力协商与受控降级基础完整，本轮保持这些路径不被绕过。                                                                | 缺失 Provider/Sandbox/Skill/项目依赖时的默认替代路径、集中修复入口和任务连续恢复仍需用真实失败样本推进。                                                         |
| 工程结构与真实评估  | 高度覆盖基础，局部改善                      | 新增 Surface 与 token governance 均按小模块提取，中央 Runtime 未增长；架构、预算、Ledger、回放、实验和成本证据继续有效。                             | Store、Server App、Contracts、Web 和完整 Runtime 生命周期仍是热点；任务成功率、首个有效动作、无新信息调用、人工介入原因和同模型 Harness A/B 尚未形成连续基线。   |

因此，当前代码没有“覆盖完成整个 `goal.md`”。准确结论是：最高优先级的跨 Run `ConversationSurface` 与 `next.md` 4.4 token-aware/prefix-stable/overflow-recoverable 上下文治理已经达到本阶段验收边界；六个长期方向中，Kernel 完整主链、具体模型级 Harness、工具协议与 code-mode bridge、桌面任务工作台、默认环境摩擦收口以及效果指标/A/B 仍需后续纵向切片。下一优先级应是将 Prompt、Tool、Policy 和 Context 继续接入真实 Kernel TurnPipeline，同时先建立效果指标基线，避免只完成结构迁移却无法证明任务质量改善。

## 13. 2026-08-20 Kernel Turn Pipeline 纵向实施切片

本切片承接 model-call 与 final-context seam，将已经注册但仍停留在门面的 Prompt、Tool 和 Policy Adapter 接入真实 `AgentRuntime.runLive()` 主链。目标不是一次性重写完整 Agent Loop，而是建立一个可检查、可装配、可安全卸载的 Run-scoped Turn Pipeline，使 Kernel 装配结果真正决定工具面、Prompt builder 和追加策略，而 standalone `AgentRuntime` 仍使用行为等价的内建默认实现。

调用边界与顺序：

- Runtime 先按当前 capability、环境协商、Skill、MCP、计划、审批与子 Agent 状态创建完整候选工具集；Kernel Tool Adapter 随后只能返回该集合的确定性子集或排序，禁止新增、伪造、重名或替换工具对象。这样插件可以进一步压缩工具面，但不能绕过 capability、Sandbox 或审批获得新能力。
- Kernel Prompt Adapter 接管 `createAgentPromptBuilder` 的真实构造入口，输入仍是 Runtime 已冻结的稳定层来源、模型 Adapter 和有效工具能力投影；最终 Prompt 继续经过现有 compiler、Prompt Package、Model Context Envelope 和 token governor。
- 最后时刻内建 `preflightAgentToolPolicy` 始终先执行且不可替换；只有内建 Policy 已允许时，Kernel Policy Adapter 才可追加更严格的阻断或审计，禁止把拒绝改成允许。Tool Loop Guard、预算、取消和 progress guard 继续包裹在可组合区域之外。
- Kernel 在 `runPrompt`、恢复和审批继续路径进入 Runtime 前安装同一组已解析 Adapter，并在调用结束后可靠释放；并发 Run 共享不可变 Adapter 组合，不保存 Run 私有正文。直接使用 standalone Runtime 时由同一 host 安装默认 Adapter，避免形成两套执行语义。
- Kernel inspection 增加 Turn Pipeline 的 adapter 身份与能力摘要；运行期写入 hash-only resolution evidence，能够回答某个 Run 实际采用了哪套 Tool、Prompt、Policy 行为，不记录 Prompt、工具参数或策略私有正文。

失败关闭与兼容要求：

- Adapter 抛错、返回非法工具集合、重复工具名、非候选工具、无效 Prompt builder 或试图放宽 Policy 时，Run 在对应边界失败关闭，不进入不受控 provider/tool 调用。
- Kernel plugin 或自定义装配卸载后不得残留 Adapter、Hook、资源或监听器；同一个 Runtime 不允许同时附着两个 Kernel Turn Pipeline。
- standalone Runtime、现有 Kernel 默认 Profile、Workflow Agent node、自动/手动恢复和 operator-decision continuation 保持原行为；本切片不改变公开 `RunPromptOptions`、Ledger 原始事件、工具 schema、checkpoint 或 provider 协议。
- `AgentRuntime` 文件大小 3323 行是硬预算；新增组合逻辑必须提取到独立模块，并通过减少中央直连代码保持不增长，禁止提高预算。

测试矩阵：

- 默认路径：standalone Runtime 与 Kernel 默认 Adapter 的工具、Prompt、Policy 行为等价，现有真实读—改—验纵向用例继续通过。
- Tool Adapter：可删除/重排候选工具；新增工具、替换对象、重复名称和空返回协议错误失败关闭；被移除工具不会出现在 Prompt、provider context 或执行路径。
- Prompt Adapter：自定义 builder 标记进入实际 provider system prompt，并绑定最终 Prompt Package；非法返回在 provider 前失败关闭。
- Policy Adapter：可在内建允许后额外阻断；内建拒绝时不调用可组合 Adapter，且任何 Adapter 都不能放宽 browser confirmation、MCP approval、只读降级或 workspace Policy。
- 生命周期：Kernel attach/detach、重复 attach、shutdown、直接 Runtime 兼容、恢复与 Workflow 路径；inspection 与 hash-only resolution evidence 和实际执行一致。
- 全量门禁：相关定向测试、Runtime 全量、根级 typecheck、sealed source manifest、架构门禁、diff hygiene 与中央文件行数预算全部通过。

本切片完成后的准确表述应是：Model、Prompt、Tool、Policy 与 final Context 已进入真实 Kernel 纵向调用路径，`AgentRuntime` 的三处直接构造边界被 Turn Pipeline 取代；Completion Adapter、完整 step/loop 生命周期、具体模型级 Harness、code-mode bridge、桌面工作台与效果指标/A/B 仍属于后续工作，不能据此宣称 Kernel 或六方向整体完成。

## 14. 2026-08-20 Kernel Turn Pipeline 实施结果与整体覆盖结论

第三个纵向切片已完成第 13 节定义的实现边界。Kernel 现在不再只控制 model-call pipeline：工具候选集编译、Prompt builder 创建和最后时刻 Policy preflight 已进入同一个 Run-scoped Turn Pipeline，final-context governor 继续由 model-call pipeline 在实际 provider 调用前执行。Kernel 装配路径与 standalone `AgentRuntime` 使用同一套 host 和默认 Adapter 语义，恢复、审批继续与 operator-decision continuation 也会经过同一真实路径。

已落地并验证的行为：

- Runtime 仍先按 capability、环境、Skill、MCP、计划、审批和子 Agent 状态生成候选工具；Tool Adapter 只能对 immediate/deferred 原候选对象分别做确定性子集选择或重排。新增对象、对象替换、重复名、跨组移动或原地篡改候选均失败关闭。
- Prompt Adapter 已接管实际 `createAgentPromptBuilder` 构造边界；其产物继续通过 compiled prompt 校验、Prompt Package、Model Context Envelope、token governor 和 provider stream。非法 builder 或非法产物会在 provider 前失败。
- 内建 `preflightAgentToolPolicy` 永远先执行；只有内建 Policy 允许后才调用追加 Policy Adapter。追加 Adapter 只允许给出带非空原因的更严格阻断，不能把既有拒绝改成允许；其输入是最小只读 Run/Profile/ToolCall 投影和克隆后的参数，不暴露 Store、确认管理器等高权限对象。
- Kernel inspection 与 `context.prepared` 只记录 Adapter 组合、候选工具集和活跃工具集的哈希证据，不写入 Prompt、工具参数或 Policy 私有正文。Kernel shutdown 会同时卸载 model-call 和 Turn Pipeline；重复 attach 失败时不会遗留半附着状态。
- `AgentRuntime` 的计划、里程碑和 operator-decision 工具组装已提取到独立模块；Turn Pipeline 的 host、Kernel service 注册和 Adapter 实现也分别隔离。中央 Runtime 从 3323 行降至 3312 行并同步下调硬预算，`agent-kernel.ts` 保持 492 行，没有提高架构上限。

最终验证结果：定向 5 个测试文件、22 项测试通过；Runtime 全量 379 个测试文件、1857 项测试通过，14 个 live 文件中的 32 项环境依赖测试按条件跳过，零失败；根级 typecheck、sealed default-product source、架构门禁与 diff hygiene 全部通过。架构审计覆盖 1758 个源码文件和 800 个测试文件，零允许依赖环；sealed manifest 与 release identity 固定为 `56be879c0f333896e95c3daa66644d0eab47df8c5e83b9ac4a475ab68d3d4626`。

对照本文六个长期方向和 `next.md` 的分阶段建议，当前准确覆盖如下：

| 方向                | 当前覆盖度                 | 已达到的边界                                                                                                                                              | 仍未覆盖的关键部分                                                                                                                                             |
| ------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kernel 接管执行主链 | 高度部分覆盖               | Model、Prompt、Tool、Policy 与 final Context 已进入真实 Kernel 纵向路径，具备装配、检查、失败关闭和卸载边界。                                             | Completion Adapter、逐 step/loop 扩展点和完整 Agent Loop 生命周期尚未统一；`AgentRuntime` 仍承担较多循环协调职责。                                             |
| 模型感知 Harness    | 部分覆盖                   | 已有 API family Profile、工具面裁剪、重试与 thinking-loop guard，以及 provider/model-aware token calibration 和 reasoning reserve。                       | 尚未形成 provider + model pattern + task phase + environment capability 的具体模型级 Profile；编辑协议、角色路由、fallback/凭据轮转和模型 quirks 仍缺。        |
| 工具面与上下文负担  | 高度部分覆盖               | `ConversationSurface`、工具对失败关闭恢复、统一 token meter、稳定完整单元投影、一次 overflow recovery、deferred MCP 激活及 Kernel 工具子集/重排均已覆盖。 | 真实 provider tokenizer、模型摘要升级、按任务阶段动态重编译、统一 read/edit/tool-discovery 协议、JavaScript code-mode bridge 和无新信息调用治理仍未完成。      |
| 桌面任务工作台      | 部分覆盖                   | 已有工作区、会话、运行、审批、结果和近期项目切换基础。                                                                                                    | 本轮未改造空态、运行态、完成态、主任务信息层级、设计 Token、样式所有权或大型 Web 热点，普通任务仍未完全以结果和待处理事项为中心。                              |
| 默认环境与配置摩擦  | 高度覆盖基础，尚未收口     | Provider、Sandbox、审批、恢复、能力协商与受控降级基础继续有效，三个新切片未绕过这些路径。                                                                 | 缺失 Provider/Sandbox/Skill/依赖时的默认替代路径、集中修复入口、重复失败抑制和无须重述目标的连续恢复仍需真实失败样本推动。                                     |
| 工程结构与真实评估  | 高度覆盖基础，结构局部改善 | 新能力按职责拆分，Runtime 预算继续收紧；架构、Ledger、回放、实验和成本证据基础完整。                                                                      | Store、Server App、Contracts、Web 与剩余 Runtime 生命周期仍是热点；任务成功率、首个有效动作、无新信息调用、人工介入原因及同模型 Harness A/B 尚未形成连续基线。 |

因此，目前代码仍没有覆盖完成整个 `goal.md`。可以确认完成的是三个相互衔接的纵向切片：跨 Run canonical `ConversationSurface`、token-aware/prefix-stable/overflow-recoverable 上下文治理，以及 Kernel Prompt/Tool/Policy Turn Pipeline。`next.md` 第一阶段的上下文正确性目标和第二阶段的核心 Kernel seam 已取得实质进展，但第一阶段的效果指标与公平 A/B、第二阶段的具体模型级 Harness/完整生命周期，以及第三阶段的 code mode、协议收敛、typed subagent、领域拆分等仍未完成；桌面工作台方向也尚未进入本轮生产实现。

下一实施切片选择“Harness 效果基线与同模型 A/B”。先复用现有 Ledger、评测和成本证据，定义任务通过率、首个有效读/改/验时间、重复与无新信息工具调用率、Prompt/工具 Schema token 占比、overflow 恢复成功率和人工介入原因，再以同模型、同 Provider、同任务、同环境和相近预算比较默认路径与可控 Harness 变体。该切片先证明现有三个结构改动的实际收益，并为具体模型级 Profile、工具协议压缩和桌面结果呈现提供事实依据；它不应以新增回执数量代替任务质量，也不提前扩展为 UI 重构或 code-mode bridge。

## 15. Harness 效果基线与公平 A/B 实施切片

本切片承接第 14 节选定的下一优先级，复用现有 Run replay、Run comparison、Ledger、configuration fingerprint 与 evaluation 基础，建立能够回答“任务是否更快进入有效工作、是否减少重复或无新信息调用、上下文恢复是否有效、何时需要人工介入”的确定性投影。它不新增第二套运行事实源，不修改 replay snapshot schema，也不把 Run 正常结束等同于任务成功。

投影边界与数据语义：

- 新增独立的 `RunHarnessEffectMetrics`，由一个 Run 的原始 Ledger 事件和既有 `RunRecord` 确定性重算，并以事件流哈希、指标内容哈希和算法版本绑定。既有 `RunMetrics`、portable replay schema v1 和历史快照保持兼容。
- 首个有效动作只从可证明的工具生命周期事件推导，区分 `read`、`write`、`verify` 三类，并记录从 Run 开始到首个对应动作的时间；缺少可分类的 effect 或时间证据时保持 `unavailable`，不从工具名称或自然语言猜测。
- 重复调用只统计同一 Run 内工具名与 `inputSha256` 完全一致的后续 `tool.started`；缺失输入哈希的调用不进入分母。无新信息调用只统计有绑定 output/result 内容哈希的已完成调用，并在同一工具的后续结果哈希与此前结果一致时计数；redacted、unavailable、失败或无结果哈希的调用不作推断。
- Prompt/工具 Schema 占比从 final Model Context Envelope/token-pressure 回执中的分项 token 证据计算；只有分项和总量一致、数值有限且非负时才可用。总输入/输出 token、cache 与 cost 继续复用既有 RunMetrics，不重复计费。
- overflow 指标分别记录尝试、恢复成功、恢复失败和不可判定数量；只有第一次 overflow 与后续更严格 envelope/provider 结果具有完整绑定时才判定恢复结果。人工介入按稳定事件族和原因码聚合，至少覆盖 operator decision、browser confirmation、approval/capability/safety block、预算暂停与手动恢复，不把原始用户文本或策略正文写入投影。
- 任务结果使用 `passed`、`failed`、`unavailable` 三态。只有同 Run 的明确 goal/evaluation/benchmark 验收证据可以给出 passed/failed；`run.completed`、assistant 自述、工具成功或进程退出本身均不足以证明任务成功。

公平 A/B 与兼容要求：

- `RunComparison` 增加左右 Harness 指标、确定性 delta 与 `HarnessComparisonFairness`。公平性分别校验同 Provider、同 model id、同任务输入哈希、同 Thread/执行模式/发布身份形成的环境类，以及相同或在明确容差内的 Run budget；每项都有 `matched`、`mismatched`、`unavailable` 状态。
- 总体可比性仅在全部必要维度 matched 时为 `comparable`；任一 mismatched 为 `not_comparable`，缺证据且没有不匹配时为 `insufficient_evidence`。A/B 结果不得在不可比或证据不足时宣称 Harness 改善。允许 Harness 本身导致 Prompt、活跃工具集或 Adapter hash 变化，这些变化作为实验变量展示，不会被误判成环境公平性失败。
- 比较内容以 hash-only 任务、环境、预算和指标证据绑定，不复制 Prompt、用户任务、工具参数、输出正文或人工决定内容。HTTP no-store 响应镜像公平性状态、关键计数和回执哈希；Run Lab 在现有 comparison sheet 中展示指标和不可比原因。
- 历史 Run、导入快照或缺少新事件字段时必须保持可比较的旧指标，同时把无法证明的新指标标为 unavailable；协议校验与 UI 不得因缺失可选证据崩溃。

测试矩阵：

- 指标投影：read/write/verify 首动作；重复输入哈希；相同与不同结果哈希；缺失、损坏、redacted 与乱序绑定；Prompt/tool token 分项；overflow 成功/失败/不可判定；人工介入原因；任务结果三态。
- 公平性：同模型/Provider/任务/环境/预算可比；模型、Provider、任务、环境和预算分别漂移；旧 Run 缺 configuration 或任务 hash 时证据不足；Harness Adapter/工具面变化不误伤环境判定。
- 纵向路径：真实 `runPrompt` 生成的 tool/context/overflow/decision 事件能被投影；Run comparison、HTTP headers、Web Run Lab 和 evaluation 输入继续使用同一比较结果。
- 完整性与隐私：指标及公平性 hash 可重算，事件流漂移使绑定改变；比较响应不新增 Prompt、任务、参数、输出或策略正文；portable replay v1 的生成与验证保持字节契约兼容。
- 全量门禁：contracts/runtime/server/web 定向测试、Runtime 全量、根级 typecheck、sealed source、架构门禁、Prettier、diff hygiene 与文件预算全部通过。

本切片完成后的准确表述应是：`next.md` 第一阶段第 3 项的 Ledger 可证明指标与第 4 项的同模型公平比较基础进入默认 Run Lab/比较路径；真实任务样本的统计结论、具体模型级 Harness 优化、自动实验调度和连续趋势看板仍需后续采样与迭代，不能只凭投影能力宣称任务质量已经提升。

## 16. Recovery Conversation Surface 隔离修复

本修复处理第 10 节 canonical `ConversationSurface` 在手动或自动恢复 Run 中暴露出的兼容性回归。恢复 Prompt 已通过 `<run-recovery>` 与 `<recovery-plan-context>` 显式携带可继续工作的计划、里程碑和产物证据，因此父 Run 的私有工具调用参数与结果不得再次作为模型工具历史注入恢复子 Run。

实现边界与验收要求：

- 对 `source=recovery` 的子 Run，以当前 Run 的 `run.recovery.started` Ledger 事件作为工具交换投影下界，并与 checkpoint/compaction 既有保留边界取更严格者；普通用户与助手文本历史继续按现有规则保留。
- 恢复边界前的父 Run canonical 与 legacy 工具交换均失败关闭，不得向恢复模型泄露父 Run 工具参数或结果；当前恢复 Run 在该边界后新产生的完整、哈希绑定工具交换仍可进入后续 turn。
- 非恢复 Run 的跨 Run `ConversationSurface` 行为保持不变；portable replay v1、恢复 Prompt、计划证据、Policy、Sandbox、预算、取消与 Ledger 契约均不修改。
- 回归验证必须覆盖真实 partial Run 到 recovery child 的纵向路径，证明恢复 Prompt 与计划上下文仍存在、父 Run 私有工具参数不可见、恢复子 Run 正常完成；同时复跑 manual recovery、Conversation Surface、Server 与 Runtime 相关门禁。

本修复只收紧恢复路径的工具历史边界，不代表默认恢复摩擦、完整 Kernel 生命周期或整个 `goal.md` 已经完成。

## 17. 2026-08-21 Harness/Recovery 实施结果与六方向覆盖审计

第 15 节 Harness 效果基线与公平 A/B 基础、以及第 16 节 Recovery Conversation Surface 隔离修复已经达到各自当前实现边界。本节记录这两个切片在具体模型级 Harness 实施前的审计结论；第 18 节已用 release identity `8492ec1791facd4d1758fa5a6b6083a15ff818694c75b2d25b09d350db4932f6` 下的最终源码、默认调用路径和全量测试更新模型级 Harness、实验变量与验证数字。两节都不把局部切片完成解释为六个长期方向整体完成。

Harness 已落地的边界：

- `RunHarnessEffectMetrics` 从单个 Run 的原始 Ledger 确定性投影首个有效读/写/验动作、完全重复调用、无新信息结果、Prompt/工具 Schema token 占比、overflow、稳定人工介入原因和任务结果，并以事件流哈希、算法版本和内容哈希绑定。失败、redacted、损坏或缺失证据保持 unavailable；`run.completed`、工具成功、进程退出和 assistant 自述均不作为任务成功证据。
- `RunComparison` 已接入同 Provider、同 model id、同任务输入哈希、同 Thread/执行模式/发布身份环境类和相近预算五维公平性。全维 matched 才是 comparable，任一 mismatch 为 not comparable，无 mismatch 但缺证据为 insufficient evidence；Harness 自身的 Prompt、工具集和 Adapter 变化是实验变量，不被误判为环境漂移。
- 同一 Harness comparison 已进入 replay comparison、evaluation 输入、no-store HTTP 响应和 Web Run Lab；portable replay schema v1 未修改，比较面不复制 Prompt、任务、工具参数、结果正文或人工决定内容。当前 Run Lab 已显示公平性、首动作、重复/无新信息、人工介入和 Prompt/工具 token delta，但 overflow 与任务结果仍只存在于比较对象，展示层尚未完整覆盖全部指标。
- 当前实现建立的是可重算指标与公平比较基础，不是自动实验调度，也不是任务质量提升结论。仓库尚无足够的同模型真实任务样本支撑统计结论。

Recovery 修复已落地的边界：

- `source=recovery` 子 Run 使用自身 `run.recovery.started` 与 checkpoint/compaction 的更严格边界作为工具交换投影下界；父 Run 普通文本继续保留，但边界前 canonical 与 legacy 工具交换均失败关闭。
- 恢复边界缺失时不猜测父子归属；恢复 Run 边界后新产生的完整工具交换仍可进入后续 turn。真实 partial Run -> recovery child SSE 回归证明 `<run-recovery>` 与 `<recovery-plan-context>` 仍存在，父 Run 私有工具参数不可见，恢复子 Run 可以正常完成。

本节当时的验证数字由第 18 节最终验证结果取代；旧 release identity 下的发布验收证据也不能迁移到新 identity。

对照六个长期方向，当前准确覆盖如下：

| 方向                | 当前覆盖度             | 已达到的边界                                                                                                                                                                         | 仍未覆盖的关键部分                                                                                                                                                             |
| ------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Kernel 接管执行主链 | 高度部分覆盖           | Model、Prompt、Tool、Policy 与 final Context 已进入真实 Kernel 路径，并具备装配、检查、失败关闭和卸载边界。                                                                          | Completion Adapter、逐 step/loop 扩展点和完整 Agent Loop 生命周期尚未统一；`AgentRuntime` 仍承担较多循环协调职责。                                                             |
| 模型感知 Harness    | 高度部分覆盖           | 第 18 节已建立 API family fallback、具体模型规则、当前 task phase、环境能力投影、工具面裁剪、重试、thinking-loop guard、provider/model token calibration 和可见的 Harness 实验变量。 | 编辑协议、角色路由、跨 Provider fallback/凭据轮转、真实样本校准的模型 quirks 和自动实验调度仍缺。                                                                              |
| 工具面与上下文负担  | 高度部分覆盖           | canonical Conversation Surface、成对工具历史、token-aware 完整单元投影、一次 overflow recovery、恢复隔离、deferred MCP 激活和 Kernel 工具子集/重排均已覆盖。                         | 真实 provider tokenizer、模型摘要升级、按任务阶段动态重编译、统一 read/edit/tool-discovery 协议、JavaScript code-mode bridge，以及把无新信息指标升级为运行时停滞治理仍未完成。 |
| 桌面任务工作台      | 部分覆盖               | 已有工作区、会话、运行、审批、结果、近期项目切换和 Run Lab Harness 比较基础。                                                                                                        | 空态、运行态、完成态信息架构，设计 Token、样式所有权和大型 Web 热点尚未系统重构；普通任务仍未完全围绕结果和待处理事项组织。                                                    |
| 默认环境与配置摩擦  | 高度覆盖基础，尚未收口 | Provider、Sandbox、审批、恢复、能力协商和受控降级基础完整；Recovery 修复保持原任务连续性且不泄露父 Run 工具正文。                                                                    | Provider/Sandbox/Skill/项目依赖缺失时的默认替代路径、集中修复入口和重复失败抑制仍需真实失败样本推动。                                                                          |
| 工程结构与真实评估  | 高度部分覆盖           | 新能力按职责拆分，Runtime 预算继续收紧；Harness 指标、公平性、comparison/evaluation 接线和现有 Ledger/回放/实验基础均已覆盖。                                                        | 真实任务连续 A/B 样本、自动实验调度和趋势看板仍缺；Store、Server、Web 和剩余 Runtime 生命周期仍是所有权热点。                                                                  |

因此，当前代码仍没有覆盖完成整个 `goal.md`。可以确认完成的是 canonical Conversation Surface、token-aware/prefix-stable/overflow-recoverable 上下文治理、Kernel Prompt/Tool/Policy Turn Pipeline、Harness 可证明指标与公平 comparison 基础、Recovery Surface 隔离修复，以及第 18 节的具体模型级 Harness 解析。发布证据仍需按第 18 节记录的当前 identity 重新采集，不能机械迁移旧 Trial。

## 18. 具体模型级 Harness 解析纵向实施切片

本切片承接第 17 节最明确的结构缺口和 `next.md` 第二阶段第 3 项，把当前仅由 API family 决定的 Harness Profile 提升为可检查的 `provider + model pattern + task phase + environment capability` 解析。首版只使用仓库内已有、可确定性获得的事实，不虚构模型性能结论，也不提前扩展为凭据轮转、跨 Provider fallback、角色路由、编辑协议重写或自动实验调度。

解析与调用边界：

- 保留 Anthropic/OpenAI/Google/Generic family 作为 fallback 基线；新增有顺序、无重叠歧义的具体模型规则，至少覆盖 OpenAI reasoning 模型、Claude、Gemini 与 DeepSeek。规则同时匹配规范化 provider 和 model id；没有命中时必须回落到原 family 行为，历史模型不因新增规则失去可用性。
- task phase 不再只依赖整段历史的关键词并集。首版从最新非空用户消息确定 `browser`、`research`、`data`、`coding` 或 `general` 主阶段，并保留已经真实使用过的工具；这样一个长会话进入验证、研究或浏览阶段后，活跃工具面可以随当前任务阶段重新编译，而不是永久受首轮意图主导。
- environment capability 只来自调用时已经存在的工具事实，至少区分 Browser、workspace write、process、code-kernel、MCP 五类。Profile 规则只能进一步收紧工具上限、重试默认值和模型可见指导，不能新增不存在的工具、绕过 Tool Adapter、Policy、Sandbox、审批或预算。
- 模型级 override 必须是静态、可审查的小型策略表，只允许覆盖 Prompt guidance、最大活跃工具数和默认 retry；调用者显式传入的 retry 仍具有最高权威。不得根据一次测试结果自动写回策略，也不得把 Provider 密钥、Prompt 正文或工具参数写入 receipt。
- resolution receipt 增加匹配规则、主 task phase、环境能力集合与策略来源，并继续以内容哈希绑定。旧 family ID 语义通过独立 `baseHarnessId` 保留，新 resolution ID 明确包含模型规则版本；比较系统允许该 hash 作为 Harness 实验变量，不改变环境公平性定义。

失败关闭与兼容要求：

- 规则表存在重复 ID、无效正则、非法上限/重试值或同优先级多重命中时，在 provider 调用前失败关闭，不静默选择任一规则。
- 任何模型规则都不得扩大 family 最大工具面，不得移除控制工具、当前阶段必需工具、已经使用过的工具或已批准并激活的 deferred MCP 工具；工具数量无法容纳这些受保护工具时失败关闭，不得靠任意截断破坏连续性。
- standalone Runtime 与 Kernel 装配路径继续使用同一内建 model-call extension；portable replay v1、Run configuration、Model Context Envelope、Prompt Package、Policy/Sandbox/Ledger 和 caller retry 权威保持兼容。
- `AgentRuntime` 3311 行、Contracts index 6438 行、Web copy 900 行和 evaluation 673 行继续作为硬预算，禁止提高预算绕过结构问题。

测试矩阵：

- 解析：四类 family fallback；OpenAI reasoning、Claude、Gemini、DeepSeek 具体规则；provider alias/case/模型版本后缀；未知模型回落；规则歧义与非法配置失败关闭。
- 阶段与环境：最新用户消息切换 coding/research/browser/data/general；Browser、workspace write、process、kernel、MCP capability 投影；已使用工具和已激活 MCP 保留；不存在的能力不会被 Profile 重新引入。
- 策略：具体模型 guidance、工具上限和默认 retry 生效；caller retry 不被覆盖；模型规则不能扩大 family 上限；receipt hash 可重算且不包含用户正文、工具参数或凭据。
- 纵向路径：真实 `runPrompt` 的 provider context、`model.harness.resolved` Ledger 事件、Prompt Package 与工具执行使用同一 resolution；Kernel/standalone、恢复和 overflow retry 不形成两套语义。
- 门禁：定向 Runtime 测试、Runtime 全量、根级 typecheck、sealed source、架构门禁、diff hygiene 和文件预算全部通过。

本切片完成后的准确表述只能是：具体模型级、当前阶段与环境能力感知的 Harness 解析进入真实模型调用路径，并具备可比较证据；fallback/role router、编辑协议、凭据轮转、真实任务连续样本、code-mode bridge 和桌面工作台仍属于后续切片，不能据此宣称模型 Harness 或整个 `goal.md` 已完成。

实施结果与最终审计：

- 具体模型级 resolution 已进入 standalone Runtime 与 Kernel 共用的真实 model-call extension。OpenAI reasoning、Claude、Gemini、DeepSeek 规则只能收紧 family 基线；未知模型继续 family fallback。task phase 只取最新非空用户消息，环境能力只从当前活跃工具投影；控制工具、已使用工具、阶段必需工具和已激活 MCP 均受保护，溢出时失败关闭。
- Effective Capabilities Prompt、Provider 实际 context、活跃工具、`model.harness.resolved` Ledger、Model Context Envelope、Prompt Package 和 Invocation Capsule 使用同一 resolution。Adapter API 与 Model API 不一致会在 Provider 调用前失败，caller retry 继续具有最高权威，Policy、Sandbox、审批、预算、取消与回放边界未被绕过。
- resolution receipt 使用 v2，保留 `baseHarnessId`，并记录规则版本、匹配规则、策略来源、task phase、环境能力和 guidance hash；完整回执由独立解析器按精确字段集、结构关系和内容哈希失败关闭校验。旧 v1 Web 证据继续双读，portable replay schema v1 未修改。
- `RunHarnessEffectMetrics` 对同一 Run 的有效 v2 resolution 回执按事件顺序去重并生成稳定序列 hash；任一缺失、旧版、损坏或不完整回执都会把实验变量标为 unavailable。`RunHarnessComparison` 显式保留左右 resolution hash 与 matched/mismatched 状态，但不把 Harness 差异加入 Provider、模型、任务、环境、预算五维公平性判定。该 hash 已贯穿 comparison、evaluation、no-store HTTP headers 与 Web Run Lab，且不复制 Prompt、用户任务、工具参数、凭据或 guidance 正文。
- 定向矩阵覆盖 7 个测试文件、44 项测试；Runtime 全量 382 个文件、1892 项测试通过，14 个 live 文件中的 32 项环境依赖测试按条件跳过；Server 90/90 个文件、256 项测试通过；Web 219/219 个文件、861 项测试通过；Contracts 9/9 个文件、126 项测试通过；SDK 8/8 个文件、79 项测试通过；CLI 58 个文件通过、10 个 live 文件跳过，278 项测试通过、15 项跳过。根级 typecheck、build:core、sealed default-product source、架构门禁、Prettier 与 diff hygiene 全部通过。
- 架构审计覆盖 1766 个源码文件和 805 个测试文件，零允许依赖环；`AgentRuntime`、Contracts index、Web copy、evaluation 分别为 3311、6438、900、673 行，预算只收紧、未提高。完整 receipt parser 从 Profile 中拆为独立模块，`model-harness-profile.ts` 283 行、`model-harness-receipt.ts` 259 行，没有用预算例外掩盖复杂度。sealed source manifest 与 release identity 固定为 `8492ec1791facd4d1758fa5a6b6083a15ff818694c75b2d25b09d350db4932f6`。
- 根级发布门禁仍失败关闭：`release-artifacts-audit-0.1.0.json` 在当前工作树中缺失；现有 source-bound smoke 的 Trial 全部绑定旧 identity `4207d192b9c1cfadb2e8ef7faa61688acbe8d77d423e880fffb7651675ac59ed`，不能改 hash 伪造成当前 Trial；Sandbox product acceptance 与 S1 readiness 派生证据也因当前 identity/形状漂移失效。它们需要真实重跑并重新采集，S1 仍同时受 `public_signed_external_release` 与 `windows_host_product_acceptance` 阻塞。

对照六个长期方向，最终结论仍是“尚未整体完成”：Kernel 主链为高度部分覆盖，仍缺 Completion Adapter、逐 step/loop 扩展点和完整 Agent Loop 生命周期；模型感知 Harness 已提升为高度部分覆盖，仍缺编辑协议、角色路由、跨 Provider fallback/凭据轮转与真实样本校准；工具与上下文仍缺真实 tokenizer、统一 read/edit/discovery 协议和 JavaScript code-mode bridge；桌面任务工作台尚未系统重构；默认环境替代路径与集中修复入口尚未收口；真实连续 A/B 样本、自动实验调度、趋势看板及 Store/Server/Web 领域拆分仍未完成。

## 19. 紧凑完成结果与高信息轨迹工作台切片

本切片针对普通任务工作台的两个可见摩擦：完成结果常驻大面积卡片压缩对话视口，以及轨迹事件虽然可搜索、可按轮次浏览，但单步展开只有基础审计字段，无法快速回答“做了什么、依据是什么、耗时多久”。实现参考 DeepSeek Harness 的高密度执行视图，但保持 Napier 已有的会话、任务、Inspector、Ledger 与隐私边界，不复制其页面结构。

完成结果边界：

- 完成态默认只展示单行摘要：完成状态、任务结果、首条结果摘要、产物数量与主产物入口；不再常驻展开全部完成项和全部产物。
- 用户可以显式展开完整结果，查看去重后的完成项和全部可打开产物；展开状态只属于当前页面，不写入 Ledger，不改变任务完成语义。
- 产物入口继续通过现有 Task Changes 导航打开，不能改成不受控的文件 URL；键盘焦点、`aria-expanded`、窄屏布局与 forced-colors 状态必须完整。

轨迹边界：

- 保留 Input、Model、Tools 三层时间线、轮次分组、关键/全部筛选和搜索；收紧大标题、统计块与容器留白，把首屏空间优先给事件流。
- 单个事件行继续展示序号、动作、状态、边界化摘要、耗时和时间；选中后新增 Summary、Context、Evidence、Timing 四组详情，以 DSH 的单步检查体验为信息架构参考。
- Summary 使用既有 `traceEventSummaryView` 安全摘要；Context 只展示事件类型、角色、动作层、Run/Turn/Call 等标识；Evidence 只展示已校验的模型、工具、token、字节数和 hash-only 证据；Timing 展示事件时间、持续时间与可确定的结束时间。
- 不渲染原始 Prompt、用户文本、工具参数、工具结果、凭据或任意 payload JSON；旧事件缺少专用证据时仍能显示基础上下文，不能因字段缺失崩溃。

验收要求：

- 组件测试覆盖完成摘要默认收起、展开、主产物打开和中文文案；轨迹测试覆盖工具/模型事件详情、四组导航、hash 截断与敏感正文不泄漏。
- Web 定向测试、Web 全量、typecheck、web design、architecture、Prettier 与 diff hygiene 通过，不提高任何架构或文件预算。
- 在真实 Napier 页面以至少 1440x900 与 1280x720 两个视口检查：完成结果显著降低常驻高度，对话可视区增加；轨迹选中事件后信息完整、无横向溢出，搜索、筛选、展开和详情切换可操作，控制台无新增错误。

本切片完成后只能表述为普通任务的完成态与轨迹信息架构得到一轮收敛，不代表 `goal.md` 的完整桌面工作台重构、真实 A/B 趋势看板或其他长期方向已经完成。
