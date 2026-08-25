# Napier Web 前端体验优化与美化方案

> 文档状态：可进入评审与任务拆分
> 版本：1.2
> 日期：2026-08-24
> 适用范围：Napier Web 桌面端，会话、任务、轨迹、工作区导航及通用反馈层
> 参考基线：Napier 当前源码与本地页面、DeepSeek Harness Web commit b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
> 实施状态：DESIGN.md v1.1 与生成 token 已落地，页面迁移待执行

## 1. 执行摘要

Napier 当前不是缺少视觉元素，而是信息层级、布局让渡和样式所有权没有完全统一。大量卡片、常驻状态、序号轨道、较高输入区和跨文件覆盖，使主任务内容被压缩，也让会话、任务、轨迹看起来像三套相邻但不完全一致的产品。

本方案建议将产品收敛为一种明确的体验方向：

**精密任务台 Precision Ledger**

它应当像一张清晰、安静、可审计的工作台，而不是聊天气泡集合，也不是黑色终端皮肤。品牌蓝只用于主行动、选择和焦点，白与中性灰负责绝大多数界面，状态色只表达状态。普通用户首先看到结果和下一步，高级用户可以在同一上下文中逐级展开过程、证据和原始事件。

DeepSeek Harness 最值得借鉴的不是表面圆角或空状态文案，而是四个底层决策：

1. 中央内容轴与输入轴统一，界面只有一个主要视觉焦点。
2. 侧栏、中心区、详情栏通过明确的宽度让渡算法协作。
3. 工具过程默认压缩为一行摘要，细节按需展开。
4. 轨迹采用语义行、局部检查器和虚拟化，而不是一次渲染大批事件卡片。

本次重构不建议直接照搬 DeepSeek 的品牌、深色模式、超大圆角或插件仓库结构。Napier 应保留现有品牌蓝、中文任务语境、Evidence 可达性和 Conversation、Task、Trajectory 三视图优势。

## 2. 目标与非目标

### 2.1 目标

- 让会话、任务、轨迹共享一致的导航、内容轴、组件语法和状态反馈。
- 在 1280x900、1440x900、1920x1080 三个产品基准尺寸下稳定呈现。
- 在 1280x720 压力尺寸下仍把至少 55% 可用高度交给主内容。
- 让普通路径以结果为先，让证据和底层事件保持可达但不喧宾夺主。
- 将全局 CSS 覆盖逐步迁移为 token、primitive、shell、feature 四层所有权。
- 降低首屏 DOM 数量、轨迹渲染量、布局抖动和无意义动效。
- 建立可截图、可测量、可自动检查的验收标准。

### 2.2 非目标

- 不把 Napier 改造成 DeepSeek Harness 的视觉复刻版。
- 不在本阶段引入全新的 CSS 框架或大型组件库。
- 不改变现有路由名称、任务数据模型和核心工作流语义。
- 不把手机端产品适配作为本阶段范围，但浏览器缩放导致的窄视口必须可重排。
- 不在颜色字面量债务尚未收敛前上线深色主题。
- 不为了美化而新增装饰性卡片、渐变、状态点或营销式口号。

## 3. 调研范围与证据

本方案基于以下证据：

- 逐层阅读 Napier Web 的入口、shell、会话、任务、轨迹、输入区、自动滚动和响应式样式。
- 在本地页面检查会话、任务、轨迹视图，并在 1280x720 与 390x844 进行布局压力测试。
- 运行现有 Web 设计契约检查，当前结果为通过；早期基线曾记录 841 处颜色字面量债务。
- 本地构建并检查 DeepSeek Harness Web 的空状态、侧栏、输入区和初始设置流程。
- 阅读 DeepSeek Harness 的主题 token、三栏布局、会话骨架、输入区、工具行、轨迹虚拟化和 primitive 文档。

本地依据：

- [Napier 设计契约](../DESIGN.md)
- [颜色与尺寸 token](../apps/web/src/styles/tokens.css)
- [工作区 shell](../apps/web/src/workspace-shell.css)
- [任务工作台样式](../apps/web/src/styles/task-workbench.css)
- [会话样式](../apps/web/src/styles/conversation.css)
- [动效与响应式样式](../apps/web/src/styles/motion-responsive.css)
- [设计债务基线](./web-design-debt.json)

DESIGN.md 的时间基线需要特别说明：文件于 2026-08-19 在本地创建，首次进入 Git 的提交是 2026-08-20 03:26:35 +08:00，本次重构前最近一次提交修改是 2026-08-21 20:04:16 +08:00。那次修改只将展开侧栏从 248px 调整为 272px，当时文件仍标记为 v1.0.0、closed visual contract 和 desktop-only。

因此它不是需要推翻的历史遗留物，而是一份建立很新、但过早封闭的第一版契约。本方案将它视为可版本化演进的设计系统源文件，不把现有数值视为不可修改。

外部参考采用固定 commit，避免文档结论随上游变化：

- [DeepSeek Harness 项目说明](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/README.md)
- [主题 token 分层](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-theme/src/styles/design-platform.css)
- [三栏宽度算法](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-layout/src/client/columns.ts)
- [AppFrame 布局实现](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-layout/src/client/AppFrame.tsx)
- [会话内容轴样式](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css)
- [输入区样式](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-conversation/src/client/skeleton/InputBar.module.css)
- [会话滚动实现](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-conversation/src/client/chat/ChatView.tsx)
- [工具摘要行样式](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-tool/src/client/tool/components/ToolRow.module.css)
- [轨迹虚拟行实现](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-trajectory/src/client/trajectory-virtual-rows.ts)
- [轨迹模块说明](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-trajectory/README.md)
- [基础展示组件说明](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-primitives/README.md)

## 4. 当前体验诊断

### 4.1 总体风格问题

| 问题 | 当前表现 | 影响 | 优先级 |
| --- | --- | --- | --- |
| 层级过多 | 标题、说明、状态、卡片、卡片内分区同时常驻 | 主任务缺少明确第一焦点 | P0 |
| 容器语法不统一 | 相邻页面使用不同圆角、边框、阴影和内边距 | 形成多套局部设计系统 | P0 |
| 信息密度分配失衡 | 会话输入区和状态区较高，轨迹一次显示大量事件 | 阅读内容被压缩，扫描成本高 | P0 |
| 品牌色职责扩散 | 蓝色参与装饰、状态和交互提示 | 主行动不再突出 | P1 |
| CSS 所有权模糊 | 同一布局在多个大样式文件中重复定义和覆盖 | 修改局部容易引发跨页面回归 | P0 |
| 文案语言混杂 | 中文界面中仍有英文提示和伪元素文本 | 破坏完成度，也影响本地化 | P0 |
| 窄视口重排不足 | 390px 下仍保留固定轨道和多列结构 | 浏览器缩放时出现截断和横向滚动 | P1 |

### 4.2 会话页

1280x720 压力尺寸下，实测顶部标题与状态约占 143px，输入区约占 212px，真正的会话视口约 343px。输入区约占总高度的 29%，会话内容只得到约 48%。

当前问题：

- 输入区默认三行，并叠加说明、工具条和外层浮动容器，空闲状态也持续占用较高空间。
- 活动过程大量使用独立卡片，事件之间缺少阶段分组，边框比内容更醒目。
- 三位序号轨道在宽屏可表达审计感，但在窄视口明显挤压正文。
- 用户消息有气泡，助手结果和工具卡又采用不同容器语法，视觉节奏不稳定。
- 已有接近底部自动跟随逻辑，但用户离开底部后缺少明确的“有新活动”入口。
- 状态提示与任务叙事常驻，即使任务已完成仍占用主阅读区。

相关实现：

- [Composer](../apps/web/src/Composer.tsx)
- [会话自动滚动](../apps/web/src/use-conversation-auto-scroll.ts)
- [输入就绪提示](../apps/web/src/composer-readiness-view-model.ts)
- [任务叙事模型](../apps/web/src/task-narrative-view-model.ts)

### 4.3 任务页

当前任务页同时存在页面标题、任务标题、说明、统计卡、步骤卡和证据卡，重要信息被相同权重的容器包围。

当前问题：

- 页面级标题与任务级标题语义重复。
- 目标、当前步骤、完成结果和证据没有建立清晰的主次链路。
- 完成步骤仍长期展开，导致当前步骤缺少空间和位置优势。
- 统计信息使用独立卡片后，数值像仪表盘而不是任务上下文。
- 输入控件和状态操作分散在多个区域，用户需要跨屏搜索下一行动。

相关实现：

- [任务总览](../apps/web/src/TaskOverviewPanel.tsx)
- [任务工作区](../apps/web/src/TaskWorkspace.tsx)
- [任务工作台样式](../apps/web/src/styles/task-workbench.css)

### 4.4 轨迹页

当前轨迹默认事件窗口为 180。一个运行中可能同时展示统计、控制、图表、分组和大量事件项，入口信息过多。

当前问题：

- 轨迹将“总体发生了什么”和“某个事件的原始内容”同时放入主平面。
- 默认事件数量过高，DOM、滚动和视觉扫描成本同时上升。
- 折叠后仍有大量重复行，事件类型和阶段没有形成更高层摘要。
- 选中事件的详情没有稳定占据局部检查器，用户容易在长列表中失去上下文。
- 平滑滚动直接写入 JavaScript，没有统一遵循 reduced motion。

相关实现：

- [轨迹主视图](../apps/web/src/TraceTrajectoryLedger.tsx)
- [轨迹控制器](../apps/web/src/use-trace-trajectory-controller.ts)
- [轨迹事件模型](../apps/web/src/trace-trajectory-events.ts)
- [轨迹样式](../apps/web/src/trace-trajectory.css)

### 4.5 导航与响应式

调研时收起侧栏宽度为 68px，展开为 272px。线程条目同时承担序号、标题、时间、摘要和状态，密度较高。390x844 压力测试下，固定侧栏、序号轨道和输入区共同压缩正文，部分文字被裁切，并出现横向滚动。

Napier 当前产品范围仍是桌面端，但 WCAG Reflow 将浏览器缩放后的 320 CSS px 视为重要使用场景。图表、表格、代码等本质需要二维布局的内容可以局部横向滚动，应用外壳和普通文本不应横向滚动。参见 [WCAG Reflow](https://www.w3.org/WAI/WCAG21/Understanding/reflow)。

相关实现：

- [侧栏线程行](../apps/web/src/WorkspaceThreadRow.tsx)
- [主导航](../apps/web/src/LedgerNavigation.tsx)
- [工作区 shell](../apps/web/src/workspace-shell.css)

### 4.6 工程结构问题

当前入口依次加载 token、全局样式和 workspace shell，但 styles.css 又聚合多个大面积 feature 样式。workbench 的网格在不同文件中被重复定义后再覆盖，局部修改依赖层叠顺序。

风险包括：

- 组件外部可以直接改写内部结构。
- 同一选择器在不同页面承担不同语义。
- 样式表体积越大，删除旧规则越难确认安全性。
- 视觉债务检查能发现字面量和极小字号，但无法发现层级重复、跨区覆盖和交互不一致。

现有静态设计 demo 可以继续用于方向验证，但不能演化为第二套长期设计系统。建议组合采用：

- 方向 A 的工作台外壳与导航。
- 方向 B 的安静会话阅读体验。
- 方向 C 的证据与轨迹检查器。

## 5. DeepSeek Harness Web 参考结论

### 5.1 值得借鉴的模式

| 模式 | DeepSeek Harness 做法 | Napier 应用 |
| --- | --- | --- |
| 安静的空状态 | 中央只有标题、工作区选择和一个主要输入区 | 改为任务导向空状态，展示工作区、能力就绪和建议动作 |
| 单一内容轴 | 消息列与输入区共享约 748px 至 780px 中轴 | 会话、任务正文和 composer 统一为 800px 目标轴 |
| 三栏让渡 | 中心区保底，先压缩详情，再关闭详情，侧栏可收起 | 建立纯函数布局求解器，避免 CSS 断点各自猜测 |
| 工具渐进披露 | 工具调用默认是一行，输入输出按需展开 | 活动卡改为 DisclosureRow，保留图标、动作、摘要和状态 |
| 输入区连续性 | 空状态与会话态复用同一组件树 | 保留输入内容、焦点、附件和高度状态，不因页面状态重挂载 |
| 实时高度协调 | shell 使用输入区实测高度预留内容空间 | 通过 ResizeObserver 写入 composer height 变量 |
| 精简轨迹表 | 主表只显示索引、事件、内容，详情放局部检查器 | 轨迹主列表保留扫描信息，耗时、usage、原始 IO 进入右栏 |
| 虚拟化与尾随 | 只挂载可见事件，用户上滚时暂停尾随 | 默认渲染不超过 60 个语义行，并提供新事件回到底部按钮 |
| token 分层 | static scale、alias semantic、specific component | 将 DESIGN.md 重构为 v1.1，补全 primitive 与 component token 层 |
| 样式所有权 | CSS Modules 跟随组件，通用 primitive 独立 | 新组件使用局部样式，逐步切断全局跨 feature 覆盖 |

### 5.2 不应照搬的部分

- 不复制 DeepSeek 标志、蓝色值、文案和预览徽标。
- 不把所有容器都改为 22px 大圆角。Napier 的精密工作台更适合 6px、10px、14px 三级圆角。
- 不用空泛口号替代任务信息。空状态必须回答“当前工作区是什么、可以做什么、如何开始”。
- 不把关键证据入口仅放在 hover 状态。Napier 的 Evidence 必须可见、可键盘访问。
- 不立即上线深色模式。先让 semantic token 真正覆盖产品 CSS。
- 不复制 DeepSeek 的大型插件包组织方式，只采用清晰的 UI 所有权模式。
- 不使用过低对比度的辅助文字，不以“高级感”为由牺牲可读性。
- 不让详情栏入口依赖隐式状态。选中事件时，检查器的打开与关闭必须明确。

## 6. 目标体验方向

### 6.1 设计关键词

- 克制：减少同时争抢注意力的边框、底色和常驻说明。
- 精确：状态、时间、步骤和证据的语义清楚且位置稳定。
- 可审计：过程可以展开，原始数据可以抵达，但不压迫普通路径。
- 连续：切换视图、输入状态和滚动状态时保持上下文。
- 中文优先：默认文案自然、短、可行动，不混用英文系统提示。

设计参数：

| 参数 | 目标值 | 解释 |
| --- | --- | --- |
| 视觉变化度 | 5/10 | 有明确品牌和工作台气质，不做实验性版式 |
| 动效强度 | 4/10 | 动效只帮助理解状态和空间关系 |
| 信息密度 | 7/10 | 面向开发者和高级用户，但通过分组和披露控制噪声 |
| 装饰密度 | 2/10 | 不使用无语义渐变、装饰点、序号眉题 |

### 6.2 信息优先级

所有核心页面遵循同一层级：

1. 任务结果或当前目标。
2. 当前状态与下一行动。
3. 过程摘要。
4. 证据和工具结果。
5. 原始事件与调试字段。

任何信息如果不能解释当前状态、支持下一行动或提供审计证据，就不应常驻首屏。

### 6.3 DESIGN.md v1.1 重构

DESIGN.md 已保留为生成 token 的单一入口，并从“封闭视觉合同”升级为“版本化产品界面合同”。稳定语义与可调整策略分开管理。

v1.1 Meta：

| 字段 | v1.0 原值 | v1.1 已采用 |
| --- | --- | --- |
| title | Napier Desktop Design System | Napier Product Interface Design System |
| version | 1.0.0 | 1.1.0 |
| contract_status | 未定义，正文写 closed | evolving，发布版本内稳定 |
| viewport_policy | desktop-only | desktop-primary, reflow-required |
| theme_modes | light | light，dark-ready，dark 不启用 |
| css ownership | plain CSS 全局层叠 | token 全局，shell 稳定，feature 局部 |

v1.1 token 结构：

1. Static scale：中性色、品牌色、状态色、间距、字体、基础时长。
2. Semantic alias：bg、surface、fg、border、accent、success、warning、danger。
3. Component token：button、composer、sidebar、inspector、disclosure、trajectory row。
4. Layout policy：记录范围、优先级和让渡行为，不只记录单一像素。
5. Usage rules：说明 token 可用位置、禁用位置和迁移状态。

v1.1 数值变化：

| Token / 规则 | v1.0 | v1.1 已采用 | 原因 |
| --- | --- | --- | --- |
| sidebar-expanded | 272px | default 240px，range 224px 至 280px | 让线程导航更紧凑，同时支持用户调整 |
| sidebar-compact | 68px | 56px | 与工具图标态匹配，给中心区让出空间 |
| reading range | 760px 至 880px | min 640px，target 800px，max 880px | 区分布局硬下限与理想阅读宽度 |
| evidence-rail | 320px | min 320px，default 340px，max 400px | 容纳事件详情并允许让渡 |
| status-bar | 44px | 40px，完成态隐藏 | 降低常驻 chrome |
| composer-min / max | 48px / 240px | rest 56px 至 88px，normal max 160px | 避免输入区长期压缩主内容 |
| radius.full | 18px | 999px，仅允许 badge 使用 | 修复命名与行为不一致 |
| annotation type | 11px | 普通 UI 最低 12px | 提高可读性，11px 仅保留给有豁免的图表标注 |
| raised shadow | 通用 raised | 仅 overlay、composer、drag 使用 | 用边界和空白替代卡片堆叠 |

颜色原始值和品牌蓝可以保留，因为当前主要问题不是品牌色错误，而是使用职责扩散。先重构 token 层级和使用边界，再根据对比度与真实页面截图决定是否微调色值。

v1.1 保留现有消费方依赖的 token 名称，同时新增范围和组件 token。后续删除旧 token 时应保留一个发布周期的 deprecated 窗口。生成脚本已经同步输出新 token；v1.2 通过语义调色板收敛把颜色字面量债务从 841 处基线降至零，全部 feature CSS 改用 token 与 color-mix，避免残留裸色值。

## 7. 目标信息架构与布局

### 7.1 桌面外壳

    ┌──────────────┬────────────────────────────────────┬──────────────────┐
    │ Sidebar      │ Header 50                          │ Context Inspector│
    │ 240 / 56     ├────────────────────────────────────┤ 320 to 400       │
    │              │ Optional status strip 40           │ Evidence / Event │
    │ Workspaces   ├────────────────────────────────────┤                  │
    │ Threads      │                                    │                  │
    │              │ Main scroll surface                │                  │
    │              │ shared content axis 800            │                  │
    │              │                                    │                  │
    │ Settings     ├────────────────────────────────────┤                  │
    │              │ Composer 56 to 160                 │                  │
    └──────────────┴────────────────────────────────────┴──────────────────┘

布局规则：

- 展开侧栏目标 240px，可在 224px 至 280px 范围内调整；收起侧栏 56px。
- 中心区硬下限 640px，阅读目标轴 800px，最大正文轴 880px。
- 检查器默认 340px，可在 320px 至 400px 范围内调整。
- 顶栏固定 50px。状态条只在 running、blocked、failed 或待确认时出现，完成态不常驻。
- 输入区休息高度 56px 至 88px，编辑时自然增长，普通上限 160px。更长文本在输入框内部滚动。
- 宽度不足时先缩小检查器，再关闭检查器，随后收起侧栏，最后进入单列重排。

### 7.2 布局求解器

不要继续用多个互相覆盖的媒体查询分别决定侧栏、详情栏和中心区。新增一个无副作用的布局求解函数，输入 viewport width、sidebar preference、inspector preference，输出三栏宽度和折叠状态。

建议让渡顺序：

1. 保证中心区 640px。
2. 将检查器从偏好宽度压缩至 320px。
3. 自动关闭检查器，并保留显式重开按钮。
4. 将侧栏从展开态切换为 56px 图标态。
5. 小于 720px 时变为单列，侧栏与检查器改为覆盖层。

用户手动关闭的区域不应在轻微窗口变化时反复自动打开。窗口恢复宽度后，仅恢复由系统自动关闭的区域。

### 7.3 内容轴

- 会话消息、任务正文、空状态和输入区共享同一中轴。
- 用户消息最大宽度为内容轴的 82%，助手结果默认无外层气泡。
- 代码、diff、表格和时间线可以突破正文轴，但必须在自己的局部容器中处理横向滚动。
- 所有主内容只保留一个纵向滚动容器，避免页面、列表和卡片多层滚动。

## 8. 视觉系统

### 8.1 颜色

将 [DESIGN.md](../DESIGN.md) 升级为 v1.1 后继续作为唯一 token 源。允许重构 token 层级、布局范围、圆角语义和组件规则，但不创建平行品牌体系。

主要职责：

| 语义 | Token | 使用 |
| --- | --- | --- |
| 画布 | color.bg, #F7F8FA | 应用背景 |
| 表面 | color.surface, #FFFFFF | 主内容、弹窗、输入区 |
| 次表面 | color.surface-muted, #EEF0F5 | 分组、选中前的轻提示 |
| 主文字 | color.fg, #1A1D1F | 标题和正文 |
| 次文字 | color.fg-muted | 元数据、说明 |
| 边界 | color.border-subtle | 分隔线和静态边界 |
| 强调 | color.accent, #3A58EC | 主行动、选择、焦点 |

规则：

- 一屏只允许一个实心品牌蓝主按钮。
- 普通卡片不使用彩色底，状态色只出现在状态文字、标记和必要边界。
- 轨迹的绿、紫、橙仅用于 input、model、tool 数据分类，不用于普通导航。
- 阴影只用于 modal、popover、浮动输入区和拖拽中的对象。
- 禁止在 feature CSS 中新增颜色字面量。

### 8.2 字体

沿用现有中文系统字体栈，避免为了“技术感”让正文使用等宽字体。

| 用途 | 字号 / 行高 | 字重 |
| --- | --- | --- |
| 页面标题 | 22 / 30 | 600 |
| 区块标题 | 16 / 24 | 600 |
| 正文 | 15 / 25 | 400 |
| 控件与紧凑行 | 13 / 20 | 500 |
| 元数据 | 12 / 18 | 400 |
| 技术字段 | 12 / 18 mono | 400 |

正文中不使用全大写英文眉题。等宽字体仅用于 event id、路径、命令、时间戳、token usage 和代码。

### 8.3 间距、圆角与边界

- 使用 4、8、12、16、24、32px 间距阶梯。
- 控件圆角 6px，面板 10px，输入区 14px。
- full radius 只用于短状态 badge，不用于普通按钮和大容器。
- 普通信息分组优先使用空白和 1px 分隔线，不默认再套一层卡片。
- 嵌套卡片最多一层。卡片内部的子分组使用标题、间距或 disclosure。

### 8.4 图标

- 统一 16px 与 20px 两个视觉尺寸。
- 同一动作在导航、工具条和列表中使用同一图标。
- 图标按钮必须有可访问名称和可见 focus。
- 不使用 emoji 作为产品图标，不使用相似但语义不同的临时 SVG。

## 9. 页面级优化方案

### 9.1 会话页

目标结构：

    Task title                           Evidence
    Running · step 2 of 4 · 01:42        More
    ──────────────────────────────────────────

    User request

    Assistant result

    ▸ Read 6 files · 1.2s
    ▸ Ran tests · 18 passed · 4.8s
    ▾ Updated 3 files
      compact diff summary

                    New activity · 3 ↓

    [ Add ]  Ask Napier...                       [Send]

具体规则：

- 顶部只保留一个任务标题。线程编号、模型、时间等元数据进入 More 或详情栏。
- running 状态条显示当前步骤、耗时和停止动作。completed 状态折叠为结果旁的简短状态。
- 助手结果使用无气泡正文，用户消息使用浅色气泡，工具过程使用紧凑 disclosure 行。
- 连续工具调用按阶段聚合，例如“读取上下文”“实施修改”“验证结果”，阶段内再显示单行事件。
- 序号轨道默认为关闭，只在 Ledger mode 或深度审计时打开。
- 工具摘要行包含：16px 图标、动作、最有价值的摘要、耗时、状态、展开箭头。
- 工具输出默认最多显示 16 行，展开后再展示完整内容。Diff、Read、Terminal、Search 使用各自 primitive。
- 用户离开底部后暂停自动跟随，并显示“新活动 · N”浮动按钮。按钮返回底部后恢复跟随。
- 发送后保留输入区组件实例，清空文本但不重挂载工具条和附件状态。

### 9.2 输入区

- 默认单行视觉高度，输入两行后自然增长。
- 附件、能力和高级配置收进左侧 Add 菜单。当前启用的高风险能力用可移除 chip 显示。
- 主发送按钮是输入区唯一实心按钮。停止状态改为明确的方形停止图标和“停止”标签。
- 就绪提示仅在配置不满足本次意图时出现，不在所有空闲状态常驻。
- 将硬编码英文提示改为中文本地化 key。
- 输入区高度通过 ResizeObserver 同步给主滚动面，避免最后一条消息被遮挡。
- 发送快捷键、换行快捷键在输入区帮助菜单中可发现。

### 9.3 任务页

任务页从“卡片仪表盘”改为“目标与步骤工作台”：

    Goal
    修复认证回归并完成验证
    3 / 5 complete · Running

    Current step
    4 运行端到端测试
      当前动作、阻塞信息、主要操作

    Completed steps 3                         Expand
    Upcoming steps 1

    Result and evidence
    final summary · changed files · tests · receipts

规则：

- 删除重复页面眉题，目标标题成为唯一一级标题。
- 进度用简短文本和细线表达，不用多张统计卡。
- 当前步骤始终展开并拥有主操作，完成步骤默认折叠为一行。
- blocked 状态在当前步骤内说明原因、所需输入和恢复动作，不另建红色大卡。
- 证据按 changed files、tests、receipts、links 分组，可在右侧检查器中展开。
- 完成后先展示结果、验证和下一建议，再展示过程历史。

### 9.4 轨迹页

轨迹页采用“概览 + 语义行 + 局部检查器”：

    Run 42 · 02:18 · Running
    [All] [Exceptions] [Tools]     Search     Follow live
    ─────────────────────────────────────────────────────
    Time       Event          Summary
    00:00.2    input          User task received
    00:01.1    model          Planned 4 steps
    00:03.8    tool           Read 6 files
    00:05.4    summary        12 events folded
    00:08.2    tool:error     Test failed

选中一行后，右侧检查器显示 usage、duration、timing、input、output、raw event。主表不重复这些字段。

规则：

- 首屏默认显示 Summary 或 Exceptions，不默认倾倒全部 180 个事件。
- 默认语义窗口不超过 60 行，采用虚拟化并保留正确的 aria-rowindex。
- 单行高度目标 30px，异常和多行摘要可增长到 44px。
- 相邻低价值事件折叠为 summary row，显示数量和时间范围。
- 事件类型列宽固定，摘要列弹性增长。
- sticky header 只保留筛选、搜索和尾随状态。
- 用户上滚时暂停实时尾随，并显示新增事件数量。
- 时间线用于定位、缩放和选择时间范围，不虚构未知耗时。
- 图表、事件表和代码输出可以局部横向滚动，应用外壳不可横向滚动。

### 9.5 侧栏

- 展开态每个线程只显示两行：标题，以及时间加状态。摘要仅在选中或 hover 时显示。
- 状态使用短文字或语义图标，避免无标签彩色点。
- 当前线程以浅品牌底和左侧 2px 选择标记表达，不使用厚边框卡片。
- New task 固定在侧栏顶部，是侧栏唯一主行动。
- 搜索、筛选、排序放入同一工具行。设置固定在底部。
- 收起态只显示图标和 tooltip，线程列表不强行塞入 56px 栏。
- 小于 720px 时侧栏变为 modal sheet，打开后锁定背景滚动并管理焦点。

### 9.6 详情检查器

右栏统一承接：

- 会话中的 Evidence。
- 任务的文件、测试和 receipt。
- 轨迹的事件详情。
- 工具调用的完整输入输出。

同一时间只显示一个上下文对象。标题栏包含对象类型、标题、固定、关闭。选择新对象时更新内容，不新开嵌套面板。关闭后焦点返回触发元素。

### 9.7 空、载入、错误和首次使用状态

- 空状态只保留一个标题、一句可行动说明、工作区状态和输入区。
- 提供 3 个与当前工作区相关的建议动作，使用普通文本按钮，不使用营销卡片。
- skeleton 必须匹配最终几何，避免载入完成后大面积跳动。
- 错误状态说明发生了什么、哪些工作已保留、用户可以做什么。
- 首次设置使用单一 modal 流程，每步只有一个主行动。API key 等敏感字段说明存储位置和可撤销方法。
- 所有空状态、错误和提示均从中文 copy registry 读取。

## 10. 通用组件与样式架构

### 10.1 分层

建议采用以下顺序：

1. tokens：由 DESIGN.md 生成 primitive、semantic、component token。
2. reset：字体、box sizing、表单继承、基础 focus。
3. primitives：Button、IconButton、DisclosureRow、StatusBadge、Modal 等。
4. shell：AppFrame、Sidebar、Header、Inspector、ScrollSurface。
5. features：Conversation、Task、Trajectory 的局部样式。
6. utilities：仅保留经过登记的少量辅助类。

新增或重写组件优先使用 CSS Modules。全局 CSS 只允许 token、reset、shell 的稳定布局和明确 utility。当前 plain CSS 可以逐步迁移，不要求一次性重写全部文件。

### 10.2 首批 primitive

| Primitive | 统一内容 |
| --- | --- |
| Button | primary、secondary、ghost、danger，32px 与 40px |
| IconButton | 32px 目标、tooltip、loading、pressed |
| DisclosureRow | 图标、标题、摘要、状态、耗时、展开 |
| StatusBadge | success、running、warning、danger、neutral |
| SegmentedControl | view 与 filter 切换 |
| Surface | base、subtle、raised，仅限真正独立区域 |
| Inspector | header、tabs、body、footer、focus return |
| Modal | mask、focus trap、escape、destructive variant |
| Toast | success、error、undo、live region |
| CodeBlock | copy、wrap、line limit、expand |
| TerminalBlock | command、result、exit、line limit |
| DiffBlock | file summary、hunk、expand |
| VirtualList | semantic row、overscan、follow tail、anchor |

### 10.3 样式所有权规则

- feature 不得覆盖其他 feature 的内部 class。
- shell 不依赖页面内部 DOM 顺序。
- component token 应以组件职责命名，不复制原始颜色值。
- 删除规则前先使用页面截图和组件测试确认无消费者。
- 不允许通过更长选择器或 important 解决所有权冲突。
- 页面级几何只由 AppFrame 和 content axis 决定，组件不得重新定义主列宽。

### 10.4 推荐目录

    apps/web/src/ui/
      primitives/
        Button/
        DisclosureRow/
        Inspector/
        VirtualList/
      shell/
        AppFrame/
        Sidebar/
        ContentAxis/
      conversation/
      task/
      trajectory/
      copy/

迁移期间保留现有文件路径，按组件逐步移动。不要在一个提交中同时做目录搬迁、视觉重写和业务逻辑重构。

## 11. 交互规范

### 11.1 动效

沿用现有 120ms、160ms、220ms 三档时长：

- 120ms：hover、pressed、focus ring。
- 160ms：disclosure、tooltip、轻量状态切换。
- 220ms：侧栏、检查器、modal 的空间变化。

只优先动画 opacity、transform 和必要的背景色。高度动画只用于短 disclosure，长内容直接打开。所有 JavaScript smooth scroll 必须查询 prefers-reduced-motion，并在减少动效时改为 auto。

### 11.2 键盘

- Tab 顺序跟随视觉顺序。
- Enter 触发主操作，Space 触发按钮，Escape 关闭当前最上层浮层。
- 会话中新活动按钮、工具 disclosure、详情入口均可键盘访问。
- 轨迹表使用 roving tabindex 或明确的行按钮语义，不把整页变成大量 tab stop。
- modal 和覆盖侧栏具备 focus trap，关闭后恢复焦点。

### 11.3 状态反馈

- 点击后 100ms 内提供 pressed 或 loading 反馈。
- 乐观更新必须能回滚，并清楚告知失败对象。
- 长任务显示当前阶段和已用时间，不使用无信息旋转器。
- toast 不承载唯一的重要信息。失败和阻塞同时出现在相关内容附近。
- destructive 操作说明对象和影响范围，确认按钮使用具体动词。

## 12. 文案与本地化

当前需要优先清理：

- composer-readiness-view-model.ts 中的英文安全提示。
- task-narrative-view-model.ts 中的英文完成提示。
- agent-capability-composer.css 中通过 content 写入的 NEXT RUN ONLY。
- 导航与可访问名称中的英文残留。

规则：

- 可见文案和 aria 文案都进入同一 copy registry。
- CSS 不生成业务文案。
- 按钮使用动词，例如“查看证据”“停止运行”“继续任务”。
- 状态使用短词，例如“运行中”“已阻塞”“已完成”。
- 错误先说影响，再说原因，最后给动作。
- 避免“操作成功”之类没有对象的反馈。

## 13. 响应式与 Reflow

建议断点由布局能力而不是设备类型决定：

| 宽度 | 行为 |
| --- | --- |
| 1440px 及以上 | 展开侧栏，中心区，按需检查器 |
| 1024px 至 1439px | 侧栏可展开，检查器按空间压缩或关闭 |
| 720px 至 1023px | 56px 侧栏，单中心列，检查器覆盖 |
| 小于 720px | 单列，侧栏与检查器均为覆盖层 |

320px 至 719px 是浏览器缩放和极窄窗口的可用性保障，不要求完整移动端生产力体验：

- 普通文本、表单、导航不出现页面级横向滚动。
- 序号轨道隐藏。
- 顶栏动作收进 More。
- 输入区保持底部，但附件和能力设置进入菜单。
- 任务步骤单列。
- 轨迹表、图表、代码块可以局部横向滚动，并提供可见滚动提示。
- 触控目标尽量达到 44px，桌面紧凑控件最低 32px，并满足 [WCAG Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) 的间距或例外条件。

## 14. 性能方案

### 14.1 轨迹

- 将默认窗口从 180 个原始事件改为不超过 60 个语义行。
- 使用虚拟列表，只挂载视口与 overscan 范围。
- 折叠相邻低价值事件，展开时再读取或渲染原始内容。
- 大型 input、output、diff 延迟到检查器打开后渲染。
- 以稳定 event id 作为 key，不以数组索引作为持久身份。

### 14.2 会话

- 初期不急于虚拟化普通会话，先减少卡片层级和隐藏折叠内容。
- 超长线程达到性能阈值后，再引入保留语义锚点的分段渲染。
- 工具详情默认不挂载大型代码高亮树。
- composer 高度使用单一 ResizeObserver，不在滚动时读取多处布局。

### 14.3 包与渲染

- 轨迹图表、diff 查看器、Markdown 高亮按页面或内容类型延迟加载。
- 避免在顶层状态变化时重渲染全部线程列表。
- 使用 React Profiler 建立会话 streaming、轨迹追加、侧栏搜索三个基线场景。
- 将 CLS、首屏 DOM 节点数、长任务数和交互延迟纳入回归记录。

## 15. 可访问性方案

- 所有文字与背景满足 WCAG AA 对比度。
- focus-visible 使用现有品牌焦点 token，不因美观移除 outline。
- running、success、warning、danger 不仅靠颜色区分，同时提供文字或图标。
- streaming 更新使用克制的 live region，不逐 token 宣读。
- 轨迹虚拟行保留正确的集合大小、行索引和选中状态。
- disclosure 使用 button、aria-expanded 和 aria-controls。
- 侧栏收起后的图标有可见 tooltip 和可访问名称。
- forced colors 模式下保留边界、选择和焦点。
- reduced motion 下关闭平滑滚动、位移动画和呼吸效果。

## 16. 实施路线

### Phase 0：基线与治理，1 至 2 个工作日

- 固化 1280x900、1440x900、1920x1080 三组主截图。
- 增加 1280x720、720x900、390x844、320x900 压力截图。
- 记录会话可用高度、composer 高度、轨迹 DOM 行数和颜色债务。
- 以已升级的 DESIGN.md v1.1 为基线，继续记录新旧 token 映射和 deprecated 周期。
- 明确 design demo 只做参考，冻结第二套 token 扩张。
- 为新 shell 建立可回滚 feature flag。

退出标准：所有后续视觉变化都有前后对照和数字基线。

### Phase 1：token、primitive 与 shell，3 至 4 个工作日

- 从 DESIGN.md v1.1 生成 semantic 与 component token，并禁止新增颜色字面量。
- 实现 Button、IconButton、DisclosureRow、StatusBadge、Inspector。
- 建立 AppFrame 布局求解器和统一 ContentAxis。
- 移除 workspace-shell.css 与 task-workbench.css 对 workbench 网格的重复所有权。
- 建立 modal、popover、toast 的一致层级和 focus 管理。

退出标准：三视图使用同一个 shell，缩放时无页面级横向滚动。

### Phase 2：会话与输入区，4 至 6 个工作日

- 将活动卡改为阶段分组加 DisclosureRow。
- 折叠序号轨道并提供 Ledger mode。
- 重构 composer 为连续组件树，接入实测高度。
- 加入暂停尾随和“新活动”按钮。
- 完成中文 copy registry 与英文残留清理。

退出标准：1280x720 下主内容高度占比不低于 55%，composer 空闲高度不超过 88px。

### Phase 3：任务与轨迹，4 至 6 个工作日

- 任务页收敛为目标、当前步骤、折叠历史、结果证据。
- 轨迹接入语义行、虚拟化、筛选、尾随暂停和右侧检查器。
- 统一 Evidence、tool detail、event detail 的右栏承载方式。
- 为代码、diff、终端输出增加 16 行默认限制与展开。

退出标准：轨迹默认 DOM 语义行不超过 60，事件详情不再挤占主表。

### Phase 4：可访问性、性能与视觉 QA，2 至 3 个工作日

- 完成 keyboard、screen reader、forced colors、reduced motion 检查。
- 运行设计契约、单元测试、端到端测试和截图回归。
- 检查 streaming、长线程、长路径、多语言、失败和阻塞场景。
- 删除 feature flag 旧分支前完成一次回滚演练。

退出标准：达到第 18 节全部验收标准。

单名前端工程师预计 3 至 4 周完成。若交互逻辑与视觉重构并行，可压缩日历时间，但 primitive 和 shell 必须先于页面并行开发稳定。

## 17. 研发任务拆分

| ID | 优先级 | 任务 | 主要文件 | 依赖 |
| --- | --- | --- | --- | --- |
| WEB-UI-000 | P0 | DESIGN.md v1.1 与生成 token，基础已完成，继续迁移消费方 | DESIGN.md、tokens.css、生成脚本 | 无 |
| WEB-UI-001 | P0 | 建立 AppFrame 布局求解器 | workspace-shell.css、新 AppFrame | WEB-UI-000 |
| WEB-UI-002 | P0 | 建立 ContentAxis 与 composer 高度协调 | Composer.tsx、conversation.css | WEB-UI-001 |
| WEB-UI-003 | P0 | 新建 DisclosureRow 与工具展示 primitive | Conversation、tool event 组件 | WEB-UI-000 |
| WEB-UI-004 | P0 | 会话阶段分组与新活动入口 | use-conversation-auto-scroll.ts | WEB-UI-002 |
| WEB-UI-005 | P0 | 任务页单一标题与步骤层级 | TaskWorkspace、TaskOverviewPanel | shell |
| WEB-UI-006 | P0 | 轨迹语义行和虚拟化 | TraceTrajectoryLedger、controller | VirtualList |
| WEB-UI-007 | P0 | 中文 copy registry 与英文清理 | view model、navigation、CSS content | 无 |
| WEB-UI-008 | P1 | 统一右侧 Inspector | Evidence、event、tool detail | WEB-UI-001 |
| WEB-UI-009 | P1 | 侧栏信息减负与窄屏覆盖层 | WorkspaceThreadRow、LedgerNavigation | shell |
| WEB-UI-010 | P1 | reduced motion 覆盖 JS 滚动 | 4 个 scrollIntoView 调用点 | 无 |
| WEB-UI-011 | P1 | 320px reflow 与局部二维滚动 | motion-responsive.css、各 feature | shell |
| WEB-UI-012 | P1 | primitive 可访问性测试 | ui/primitives | primitive |
| WEB-UI-013 | P1 | screenshot matrix 与 DOM 性能门禁 | e2e、design check | 各页面 |
| WEB-UI-014 | P2 | 超长会话分段渲染评估 | conversation list | 指标触发 |
| WEB-UI-015 | P2 | 深色模式可行性复评 | DESIGN.md、全部 CSS | 字面量债务收敛 |

## 18. 验收标准

### 18.1 视觉与布局

- 1280x900、1440x900、1920x1080 下三视图使用同一 shell 和内容轴。
- 1280x720 下会话主内容区域不低于可用高度的 55%。
- composer 空闲态不高于 88px，普通编辑态不高于 160px。
- completed 状态下，顶栏加状态区总高度不高于 96px。
- running 状态下，顶栏加状态区总高度不高于 136px。
- 320px 宽度下，应用外壳与普通文本无横向滚动。
- 图表、表格、diff 和代码仅在自身容器内横向滚动。
- 嵌套卡片不超过一层，一屏只有一个实心品牌蓝主行动。

### 18.2 内容与交互

- 中文语言环境不存在可见英文系统提示。
- CSS 中不存在生成业务文案的 content。
- 用户离开会话底部后不会被新消息强制拉回。
- 新活动按钮显示准确数量，并能恢复尾随。
- 工具调用默认显示单行摘要，完整输出按需加载。
- 任务页首屏能回答目标、状态、当前步骤、下一行动。
- 轨迹默认视图不超过 60 个挂载语义行。
- 选中轨迹事件后，可在不失去列表位置的情况下查看完整详情。

### 18.3 可访问性

- 所有交互可用键盘完成，focus-visible 清晰可见。
- modal、覆盖侧栏和检查器关闭后焦点返回合理位置。
- 状态不只依赖颜色表达。
- reduced motion 下没有 JavaScript 平滑滚动。
- 200% 与 400% 浏览器缩放下核心任务可完成。
- 关键控件满足目标尺寸或相邻间距要求。

### 18.4 工程与性能

- 核心 shell、primitive 和新改组件不新增颜色字面量。
- 早期基线记录的 841 处颜色字面量债务已在重构版本降至零，后续保持零。
- 不再由多个样式文件共同定义 workbench 主网格。
- streaming、轨迹追加和侧栏搜索无明显长任务与布局抖动。
- 页面无控制台错误、React key 警告和未处理 promise。
- 主尺寸与压力尺寸全部通过截图回归。
- npm run check:web-design 持续通过。

## 19. 风险、取舍与回滚

| 风险 | 应对 |
| --- | --- |
| 视觉重构误伤任务逻辑 | 按 primitive、shell、feature 分阶段，不同时重写业务模型 |
| 全局 CSS 删除引发隐蔽回归 | 建立选择器消费者清单，截图矩阵后再删除 |
| 虚拟化破坏滚动和可访问性 | 使用语义锚点、稳定 key、aria-rowindex，并覆盖尾随测试 |
| 输入区收紧导致能力不可发现 | Add 菜单保留清晰入口，启用能力以 chip 回显 |
| 信息折叠过度 | 默认结果优先，Evidence 和 Ledger mode 始终提供显式入口 |
| 参考产品影响品牌独立性 | 只采用结构模式，颜色、文案、圆角和品牌资产保持 Napier |
| 窄屏工作量膨胀 | 只承诺 reflow 和核心任务可完成，不承诺完整手机端产品 |

回滚策略：

- 新 AppFrame 先通过 feature flag 灰度。
- 旧 shell 在 Phase 4 结束前保持可切回。
- 数据模型、route 和 analytics event 名称不随视觉重构改名。
- 每个 feature 独立合并，失败时回滚单个页面，不回滚 token 与无争议 primitive。

## 20. 决策记录

1. 将 DESIGN.md 从 closed v1.0 升级为 evolving v1.1，发布版本内保持稳定。
2. 保留浅色主题，深色主题延后。
3. 保留 Napier 品牌蓝，不采用 DeepSeek 品牌色。
4. 保留三视图，但统一外壳和右侧检查器。
5. 会话保持结果优先，不改为纯终端日志。
6. 轨迹采用虚拟化语义行，不继续扩大原始事件窗口。
7. 新组件采用局部样式，旧 CSS 渐进迁移。
8. 目标产品仍为桌面优先，但浏览器缩放 reflow 是发布门禁。
9. Evidence 始终有显式入口，不依赖 hover 或隐藏手势。

## 21. Definition of Done

以下条件同时满足，才视为本轮优化完成：

- 三个核心页面通过视觉、交互、可访问性和性能验收。
- DESIGN.md 已升级为 v1.1 并仍是唯一 token 来源，新增界面没有平行配色体系。
- 会话、任务、轨迹共享 AppFrame、ContentAxis、Inspector 和基础 primitive。
- 页面不再依赖跨 feature CSS 覆盖维持主布局。
- DeepSeek Harness 的参考模式已转化为 Napier 自身组件和规则，没有品牌复刻。
- 所有 P0 任务完成，P1 中 reflow、reduced motion、截图门禁完成。
- 设计债务、截图差异和已知例外记录在仓库内，可供后续迭代继续执行。

## 22. 最终建议

优先重做 shell、会话输入区和工具过程展示，它们决定整个产品的空间感与一致性。不要先从换颜色、加阴影或单页卡片美化开始。只要主内容轴、布局让渡和 progressive disclosure 没有建立，局部美化很快会再次被长内容、运行状态和轨迹事件击穿。

本方案的理想结果不是让 Napier 看起来更像某个参考产品，而是让用户在任何视图中都能立刻理解：

- 我正在处理什么。
- 现在发生了什么。
- 下一步可以做什么。
- 需要时去哪里查看证据。

这四个问题都能在首屏得到稳定回答，才是整体风格一致性、美观性和 UI 交互性真正同时改善的标志。
