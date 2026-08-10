# Napier 长程目标

> 更新基线：2026-08-10；实现提交 `9a6f127`。本轮已收口 S0，并把 S1 推进到 OCI 内部网络、健康检查和回环端口绑定的本地 HTTP 服务投影；本文件是长程 Agent 的优先级、验收契约与阶段进度记录。

## 1. 北极星与完成定义

将 Napier 做成一个默认可用、可长期托付、结果可验证的通用 Agent 工作台：达到或超过 Oh My Pi（OMP）的任务效果与执行能力，达到或超过 LLM Space 的工作台与扩展体验，并以 Ledger、恢复、审批、实验和证据闭环形成独有优势。

目标体验：用户从 Web、CLI 或未来 Desktop 提交研究、编码、数据、浏览器任务后，Agent 自动获得合适能力并在真实隔离环境中持续执行；界面始终说明当前动作、完成项、阻塞、下一步和产物；刷新、失败或重启后可恢复；成功过程可复核、比较并沉淀为 Skill、Workflow 或 Evaluation。

一个能力只有同时满足以下条件才算完成：

1. 正式 Runtime 已实现，不只是类型、Catalog、Fixture、Mock 或工具注册；
2. 新用户和旧数据升级用户均能从默认入口发现、配置、调用，无需修改内部 Profile；
3. UI、CLI、SDK、Doctor 对有效能力、权限、隔离和降级给出一致事实；
4. 成功、失败、确认、取消、恢复和安全路径均通过真实模型/依赖的端到端任务；
5. 有可重复的 Outcome、UX、性能与安全证据，且相关测试和发布门禁通过。

## 2. 2026-08-10 现状评估

Napier 已不是基础 Agent Demo。统一 Ledger/Thread/Run、Replay/Trace/Receipt/Artifact、Goal/Plan/Workflow、审批、预算、恢复、Browser、数据工具、实验与 Benchmark 构成了有竞争力的底座。最近几轮还实质性补齐了版本化 Capability Contract、任务模式、联网默认路径、过程叙事、右栏分组、响应式 Inspector 和 Prompt 证据链。

### 2.1 目标完成状态

| 目标                      | 当前状态                     | 结论与剩余缺口                                                                                                                                                                                                                                                                                                            |
| ------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 默认能力与旧 Profile 治理 | 基本完成，待收口             | Capability Contract v2、差异预览、显式覆盖保护、恢复/回滚、Composer 模式和多入口能力投影已落地；仍需全新安装与多代旧数据的正式 E2E、稳定发布验证和 readiness 事实统一。                                                                                                                                                   |
| Shell / Sandbox           | **进行中，仍是首要产品阻塞** | 已有生产 Shell Session；OCI 已绑定本地 daemon、不可变 image、UID/GID、Node/Shell/Python/Git/TypeScript LSP/Node Debugger 身份，并打通 PTY 清理、固定 Git 操作图、持久 LSP、真实 DAP，以及内部禁出网网络上的健康检查与单一回环 HTTP 服务投影。尚缺真实隔离 daemon E2E、非 POSIX/跨平台和完整安装→构建→测试→服务→恢复验收。 |
| Search / Fetch / Browser  | 基本完成，待产品收口         | 默认 Research 已真实暴露 Search/Fetch/Browser；Firecrawl Search 与多 Provider 回退已实现，在线 Doctor 的 Search、Fetch、Browser 实测通过。缺 Firecrawl Scrape、Credential Reference/设置页、Provider 健康 UX 和正式六类 E2E。                                                                                             |
| Web 任务叙事与右栏        | 主体完成，待 UX 收口         | Timeline 专用卡、Markdown/Diff/Artifact/Citation、真实阶段叙事、三组 Inspector 和移动抽屉已落地。桌面/移动端仍过密、字号偏小，Composer readiness 像内部诊断面板，初始体验不够克制。                                                                                                                                       |
| Prompt Compiler           | 部分完成                     | 版本化 Invariant Core、五层 Prompt Receipt、Hash/Token/有效工具证据和 Schema 预算已有；当前仍主要是对单体 Prompt 事后分段，模型 Adapter 只做浅层参数差异，不是真正分层编译与工具格式优化。                                                                                                                                |
| Skills                    | **S0 已收口**                | 标准项目/用户目录、渐进加载、按需资源、生命周期 Receipt、恢复、Web 投影和 Research/Software Delivery A/B 证据已提交；后续扩展仍需遵守权限、来源、隔离和 Applied 可观察语义，但不再阻塞当前 S1 顺序。                                                                                                                      |
| 对标与 P0 发布            | 未完成                       | 有丰富 Benchmark/证据框架，但尚未用稳定默认产品路径证明 Search、Browser、Coding 总体不弱于 OMP，也未形成连续版本的用户结果证据。                                                                                                                                                                                          |

### 2.2 必须直面的产品事实

1. **Doctor 的 Shell/Python/Git/LSP/DAP/本地服务均已改为 active-provider 生产事实。** 本地服务检查会走生产 OCI 启动、真实 HTTP 健康检查、终止和端口关闭验证；当前主机 Docker CLI 存在但 daemon 不可达，Doctor 会如实报告 `service_provider_unavailable` 与其他 provider unavailable 状态，不会把端口能力伪报为 ready。
2. **Sandbox 已从 Provider 雏形进入核心执行面，但还不是 S1 完成态。** Host-direct 仍只是危险的显式逃生路径且拒绝本地服务；Container 已覆盖命令身份、PTY 生命周期、UID/GID、Python、固定 Git 图、TypeScript LSP、Node Debugger/DAP，以及单一 HTTP 服务的内部网络、回环端口、健康检查、取消和双资源清理，尚未覆盖真实 daemon 和跨平台 Casebook。
3. **Skill Loader 的本轮收口已完成。** 相关实现、生命周期证据、标准目录、渐进资源加载和 A/B Dogfood 已形成提交；后续不应重新把 catalog/selected/loaded/applied 混为一谈。
4. **复杂度从功能缺失转为默认体验负担。** Web 已能展示真实过程，但小字号、密集状态、原始 contract/catalog 文案和移动端拥挤会让普通用户先看到内部系统，而不是任务本身。
5. **证据丰富不等于 Outcome 领先。** Prompt regression 目前更多是结构/测试映射，Benchmark 也偏治理闭包；必须补默认入口、多 Case、多 Trial、同权限的真实对比。
6. **核心模块仍过大。** 当前架构审计为 1,210 个源码文件、630 个测试文件、零依赖环；但 `apps/server/src/app.ts`、`packages/runtime/src/store.ts`、Contracts barrel 和 Web CSS 等核心模块仍然过大，继续迭代时必须同步提取稳定边界。

### 2.3 截至 `9a6f127` 的阶段进度

已完成：

1. **S0 Skill Loader 收口**：`d24938d`、`8a2169c`、`99e91ae`、`343599c` 依次完成渐进项目加载、标准项目/用户目录、引用资源按需读取，以及证据支持的生命周期状态与 A/B Dogfood。
2. **S1 Shell 基础切片**：`28b42fc` 增加生产支持的 Shell Session、PTY/后台进程路径、Doctor 生产探针和 Web 过程投影；无受支持 Sandbox 时 fail closed。
3. **S1 OCI 命令身份**：`545f6f9` 将生产命令绑定到本地 daemon、不可变 image 和 image 内可执行文件身份，拒绝远程 daemon 与 host/image 混用。
4. **S1 OCI PTY 生命周期**：`91096b2` 用 guardian、不可预测容器名和精确强制清理覆盖正常退出、取消与父进程死亡。
5. **S1 OCI 用户身份**：`4598a26` 绑定并复验 numeric UID/GID，以该用户运行容器，限制 tmpfs 所有权与 scoped write。
6. **S1 OCI Python**：`1b15849` 绑定 Python 3.9+ 路径、版本、字节哈希和 Kernel 所需隔离标准库导入，打通命令与持久 Kernel 生产路径。
7. **S1 OCI Git**：`6cd1b8b` 把 Git 路径、版本、字节哈希和 provider identity 绑定到固定 inspect/stage/commit/branch/switch/review 图；工作区根保持只读，仅私有 Git 预览状态可写；Doctor 只有完成真实 Git 调用才报告 Sandbox ready。
8. **S1 OCI TypeScript LSP**：`12ae50a` 在镜像内绑定 Node、`typescript-language-server` 与完整 TypeScript runtime 的路径、版本、哈希和 provider identity；真实诊断协议支持 Run 持久复用，镜像模式不挂载宿主工具链，缺失/畸形身份与 host override 均 fail closed；Doctor 只有完成生产 language-server 调用才报告 ready。
9. **S1 OCI Node Debugger/DAP**：`28ec0b2` 将生产 Debugger 绑定到不可变 image 内的 Node 可执行文件、版本、字节哈希和 Inspector Worker 能力身份；真实 DAP 完成断点暂停、栈帧、局部求值、继续与 exit 0，运行时身份写入 schema 3 收据。缺失/畸形 image 能力、host executable/read-path override 与 launch 前身份漂移均 fail closed；Doctor 只有 active provider 完成同一生产探针才报告 `dap_ready`。
10. **S1 OCI 本地 HTTP 服务**：`9a6f127` 为 `workspace_process start` 增加单一高位容器端口和有界同源健康路径；OCI 为每个服务创建 `--internal` bridge，仅以 `127.0.0.1::<containerPort>/tcp` 发布随机宿主端口，并在返回前完成真实 HTTP 就绪检查。schema 8 会话绑定 image/container/network/端口/健康路径哈希，取消、失败、父进程死亡和正常退出均清理容器与网络，重启后只回放 closed 状态；Host-direct、macOS sandbox-exec 与 Bubblewrap fail closed。Doctor、Agent 工具、Web Process Panel 和 Trace 均投影相同事实，Web 只在 ready 时提供链接。
11. **当前质量门禁与证据**：最终 `npm run check` 全绿；Root 216、CLI 237、Server 208、Web 660、Contracts 121、Runtime 1,548、SDK 79 项常规测试通过，共 3,069 项；架构审计为 1,210/630/0 cycles。本地服务聚焦矩阵为 8 个文件、57 项测试通过；真实 HTTP 子进程验证内部网络、回环映射、健康检查、端口关闭和容器/网络双清理。DeepSeek 真实模型通过正式 Agent 工具完成 start→ready→cancel→closed，明确标记为受控 OCI client，不替代仍缺失的真实 daemon E2E；当前主机 Doctor 真实报告 `service_provider_unavailable`。证据见 `docs/artifacts/oci-local-service-stage9.json`。

尚未完成：

1. **S1 总验收仍未通过**：当前机器 Docker daemon 不可达，尚无真实隔离 daemon E2E；还缺非 POSIX UID/GID 映射，以及 macOS/Linux/Windows 完整 Casebook。
2. **端到端 Coding 闭环仍不完整**：尚未在全部受支持平台证明“创建→安装/构建→测试→启动服务→取消/恢复”，也未完成越界文件、私网、秘密、磁盘/资源耗尽的整套真实故障注入。
3. **S2–S5 未因本轮推进而完成**：默认联网/Browser 收口、Web 工作台减法、真正分层 Prompt Compiler 和 P0 Release Gate 仍按原顺序待办。
4. **P1/P2 未开始验收**：多语言 LSP/DAP、Typed Multi-Agent、Agent Studio、Extension Platform、Desktop/Remote Runtime 等仍属于后续阶段。

## 3. 当前外部差距

对标当前主干：LLM Space `437f297`，OMP `45e12e5`。学习设计原则与真实用户结果，不复制长 Prompt，不用功能数量代替质量。

### LLM Space

其优势是完整的 Workspace/Thread/Run 工作台、Thread 文件、Run History/Evaluation、Generate、命令面板、可安装小体积 Desktop、自动更新、SSH Remote Runtime，以及成熟的 Plugin 开发面（Tools/Skills/MCP/Model/Commands/Storage/Settings）。Napier 的治理、恢复和安全设计更深，但桌面交付、远端执行、插件开发体验和“开箱即产品”仍明显落后。

应超越：让插件/Skill/远端运行都具备权限清单、来源、隔离、证据、升级与回滚，而不是完全信任本地代码。

### Oh My Pi

其优势是持久 Bash、Python/Bun Tool Re-entry、数十个执行工具与 20+ 搜索后端、真实 Browser/Chrome Relay、Native Computer、多语言 LSP/DAP、写后诊断、统一读取、Hashline/AST 编辑、代码审查与安全扫描、隔离 Worktree Subagent、Agent Hub、Memory/Skill 学习、插件市场及 ACP/RPC/SDK 兼容。

Napier 当前最大差距不是 Agent 编排，而是日常执行面的广度、可靠性和低摩擦默认值。应先追平高频任务效果，再以恢复、审批、实验比较、长任务可视化和能力提升超过 OMP。

### 目标组合

**OMP 级任务效果 + LLM Space 级工作台/生态 + Napier 级证据/恢复。** 新能力必须提高默认用户结果，或直接消除支撑这些结果的架构、安全、性能瓶颈。

## 4. P0 执行顺序

严格按以下顺序推进；允许并行处理直接依赖与触及模块的拆分，不允许用新协议、低频工具或企业治理绕开当前验收。

### S0：Skill Loader（本轮已收口）

- 保护现有未提交工作，完成缺失 final-check、证据绑定、测试与单一主题提交；不得用重生成快照掩盖真实漂移；
- 统一 Runtime、Capability projection、Doctor、Web/CLI：明确区分 catalog、selected、loaded、applied、failed、unavailable；
- `skill_load` 必须是合适默认模式的真实可用能力，而非仅在某个 Benchmark 的 run-scoped override 中出现；
- Applied 由可观察步骤/产物证明，不能只以“引用相邻”代表所有类型 Skill 已生效；
- 支持项目级和用户级标准目录、冲突与禁用诊断；资源按需、受信任边界与大小预算渐进加载。

验收：根测试和相关 Workspace 测试全绿；真实 Research 与 Software Delivery 各完成一次有/无 Skill A/B；刷新/恢复后生命周期与证据一致，Profile 不发生隐式污染。

### S1：打通真实 Shell / Sandbox（进行中，最高产品优先级）

- 新增跨平台 `shell`/`exec` Session：工作目录、环境白名单、PTY、后台任务、增量输出、退出码、取消、超时和跨刷新状态；保留 Node argv 作为低权限工具；
- 统一 Local OS、Container/OCI、Remote Provider 能力模型；完成 image identity、挂载、UID、进程、PTY、端口和 LSP/调试适配，禁止“探针通过但生产路径拒绝”；
- 默认只挂载任务 Workspace；网络、进程、CPU、内存、磁盘、时间、输出和秘密引用均有硬边界；宿主机直跑必须显式启用并持续警示；
- Doctor/Composer 通过真实最小命令验证 active provider 与隔离强度；不可用时发送前阻止 Coding/Automation 并给出精确修复；
- 覆盖 Git、Node、Python、安装/构建/测试、本地服务、取消与恢复。

验收：受支持 macOS、Linux、Windows 路径完成“创建→安装/构建→测试→启动服务→取消/恢复”；越界文件、私网、秘密和资源耗尽 fail closed；Web 可观察/控制进程。未达到此验收，不得声称 Napier 具备 Bash 或 Sandbox。

### S2：收口默认联网与 Browser

- Firecrawl 同时支持 Search 与 Scrape，Key 只通过环境或安全 Credential Reference 注入；设置页显示掩码、来源、Provider 健康、限流和回退链；
- Search 统一标题、最终 URL、摘要、日期线索、Provider、检索时间、排序与去重；关键结论继续读取原始 Source；
- Fetch/统一 Read 覆盖 HTML、Markdown、JSON、PDF 与长文分块，动态页面可靠回退 Browser；
- Browser 默认可发现，多标签、点击/输入/选择/滚动、上传下载、截图、Live、接管、暂停/恢复和按效果确认形成正式路径；
- Citation 与结论相邻，下载/报告可预览；覆盖 SSRF、DNS Rebinding、内网/元数据、Prompt Injection、恶意重定向和秘密泄漏。

验收：全新及旧数据升级 Profile 从正式 Web/CLI 完成近期事实、多源冲突、官方文档、PDF、动态表单、下载六类任务；缺 Key、断网、验证码、限流和无 Browser 均有恢复路径。

### S3：把 Web 从控制台收敛为任务工作台

- 保留已完成的 Timeline、三组 Inspector 和响应式 Drawer，重点做减法：Composer 默认只显示模式、关键 readiness 与权限摘要，原始 Contract/Hash/诊断折叠到专家层；
- 主区优先展示任务标题、当前动作、完成项、阻塞、下一步、耗时/预算、Stop/Pause/Resume/Take over 和产物；无可计算计划时禁止伪百分比；
- Activity 合并同类高频事件，长 Run 不因数千事件卡顿；流式 Markdown、Diff、引用和 Artifact 不跳动、不重复；
- 提升正文/控件最小字号、触控尺寸、对比度、焦点与快捷键；修复 900/390px 下品牌、模式标签、状态文案裁切；
- 自动生成可编辑任务标题；空状态围绕“开始任务”而非内部配置展开。

验收：1,600/1,200/900/390px 视觉与键盘/无障碍 E2E；真实 30 分钟任务中用户五秒内回答阶段、动作、完成项、阻塞和产物位置；刷新、断线、审批和恢复后叙事不丢失。

### S4：完成真正的 Prompt Compiler

按独立数据结构编译五层，而非对单体字符串事后正则分段：

1. Invariant Core：作用域、持续沟通、自主推进、用户中断、完成、验证、安全；
2. Effective Capabilities：仅描述本轮实际可用工具、权限、Sandbox 与降级；
3. Task/Skill Overlay：任务方法、产物和验收；
4. Workspace Context：项目规则、Memory、Checkpoint 与偏好；
5. Model Adapter：针对模型的工具 Schema、编辑格式、缓存/Token 和必要提醒。

每层独立预算、Hash、来源和裁剪理由；Run 保存可复核 Receipt 而不保存秘密。至少两套 Adapter 必须在真实 Search、Coding、Browser、长任务、用户打断、危险动作、部分阻塞和纠错上 A/B，证明成功率/成本收益，而非只通过结构测试。

### S5：P0 Release Gate

建立两条公平轨道：

- **Default Product Track**：从全新安装或旧数据升级开始，经正式 Web 完成任务，计入配置、人工干预、恢复与 UX；
- **Controlled Harness Track**：Napier 与 OMP 使用同模型、等价 Prompt、隔离 Workspace、相同权限、多 Case、多 Trial。

固定 Casebook 覆盖设置、网络引用、URL/PDF、动态 Browser、高风险确认、Shell/Sandbox、Skill 遵循、编码修改与验证、长任务断线恢复、Artifact 交付；报告成功率、质量 Rubric、成本、延迟、重试、人工干预和失败分类。

P0 仅在以下条件同时成立时完成：

- 关键默认流程端到端成功率不低于 90%，连续三个版本不回退；
- Search、Browser、Coding 的 Controlled Track 总体不弱于 OMP，Napier 在恢复、证据或可理解性上有量化优势；
- 高风险 Browser/Shell 无未确认副作用，安全 Case 无秘密泄漏；
- Default Product Track 无需编辑内部 Profile，真实用户能独立完成研究与编码；
- `npm run check`、迁移、视觉 E2E、跨平台 Sandbox 和真实 Dogfood 全部通过。

## 5. P1：从可用到领先

P0 通过后按 Outcome 推进：

1. **OMP 级执行面**：持久 Python/Bun Tool Re-entry；多语言 LSP/DAP 与写后诊断；统一读取文件、目录、压缩包、SQLite、Notebook、PDF、URL 和虚拟资源；Native Computer；Provider 质量路由与站点专用解析。
2. **Typed Multi-Agent**：Schema 输出、隔离 Worktree、实时进度/成本/产物、取消/恢复、权限继承和可验证合并；只在并行能提高结果时启用。
3. **LLM Space 级 Agent Studio**：Agent/Prompt/Tool/Skill/Model/Workflow 文件化与版本化；Run History、Fork/Replay/Compare、Rubric/Evaluation、成功 Run 能力提升；简单默认层与完整专家层并存。
4. **Code-first Workflow**：简洁 TypeScript DSL 编译为可验证 Manifest；从自然语言/成功 Thread 生成 Workflow；稳定 Codex、Claude、OMP/Pi Adapter。
5. **Extension Platform**：Tool/Command/Provider/Skill/Workflow/模型/UI Card/Storage SDK，项目与用户发现、热重载、权限清单、隔离、兼容诊断、升级与回滚。
6. **Memory 与 Routing**：可插拔语义 Memory、来源/置信/纠错；按任务和节点选择模型，用 Casebook 证明路由与回退收益。

## 6. P2：正式产品与生态

- 签名 Desktop、自动更新/回滚、深链、命令面板、多标签和 SSH Remote Runtime；
- ACP、稳定 TypeScript/Python SDK、协议版本/取消/背压和跨入口一致性；
- Research、Coding、Data、Browser、Workflow、Artifact 六个开箱方案，各有模板、示例、Rubric 和 E2E；
- 可预览/编辑/下载/版本化的报告、网页、幻灯片、图表和图片；
- macOS/Linux/Windows CI，安装/升级/迁移、SemVer、Release Note、用户与扩展开发文档；
- 插件市场与协作只在权限、来源、隔离、升级、回滚和供应链边界成熟后开放。

## 7. 架构、安全与范围约束

- 每个纵向切片同步提取触及的稳定边界；`app.ts`、`store.ts`、Contracts barrel、巨型 Panels/ViewModel 和全局 CSS 必须下降，禁止提高架构豁免基线；
- 优先按 Capability、Execution Session、Search/Browser、Prompt/Skill、Run Projection、Artifact、Web Activity 拆分；保持迁移和公共协议兼容；
- 新手写生产文件原则上不超过 500 行；公共 API 最小化，SDK 不泄漏 Runtime 内部；
- 安全按效果确认；外部网页、下载、项目规则、Skill、插件均是不可信输入；秘密只以受控引用传递；
- Ledger 只记录恢复、审计、评测需要的事实，不新增无消费者的 Receipt/Hash；UI 采用结果级→步骤级→取证级三层密度；
- 任一失败必须同时给出 fail-closed 边界与可操作恢复路径；不得把降级能力冒充完整能力；
- P0 前暂缓 Postgres/分布式 Store、多租户/RBAC、企业治理、大量 SaaS Channel、全量多媒体及与默认结果无关的大规模重写。

## 8. 持续开发协议

每轮只选择当前最高优先级的最小完整纵向切片：

1. 核验 main/工作区/持久数据/正式 Web 与 CLI/近期提交，先复现用户结果；
2. 定义可观察验收，复用生产能力，实现权限、错误、恢复、迁移与安全路径；
3. 运行相称的单元、集成、E2E、视觉、故障注入和安全测试；
4. 用真实模型/依赖 Dogfood，并从 Default Product Track 复验；
5. 对照 OMP/LLM Space 记录 Outcome，不记录功能数量；
6. 保护用户和并行工作，只提交自己修改的、主题单一、可回滚成果，然后继续下一切片。

每轮必须回答：默认用户能否直接使用？能力投影是否等于真实 Runtime？任务成功率是否提高？UI 是否讲清进度？Skill 是否真正加载并产生影响？Sandbox 是否真实隔离？失败能否恢复？复杂度是否有消费者？

禁止：把 Mock/注册/类型/测试数当产品完成；伪造进度；为 Benchmark 特制非生产路径；一次胜利宣称超越；提高架构豁免；泄漏 Key/Cookie/Token；危险 Git 历史改写或破坏用户数据。

## 9. 给长程 Agent 的 Goal Prompt

```text
持续推进仓库根目录的 `goal.md`，直到当前最高优先级的真实验收完成。

先核验 main、脏工作区、正式 Web/CLI/Doctor、持久 Profile、最近提交与测试；“代码存在”不等于默认用户可用。当前先保护并收口 S0 Skill Loader，再依次推进 S1 真实 Shell/Sandbox → S2 默认联网/Browser → S3 Web 收口 → S4 Prompt Compiler → S5 Release Gate；只并行处理直接依赖和触及模块的架构拆分。

每轮完成一个最小纵向切片：复现 → 验收 → 生产/迁移/失败/恢复/安全实现 → 测试 → 真实 Dogfood → UX/架构 Review → 单一主题提交。安全且有价值的下一步仍可达时继续；外部依赖阻塞时记录证据并推进其他可达工作。

公平比较 Napier 与 OMP：同模型、等价 Prompt、隔离 Workspace、同权限、多 Case、多 Trial，分开评估 Default Product Track 与 Controlled Harness Track。只报告成功率、质量、成本、延迟、重试、人工干预和失败原因。

只用安全 Credential Reference 做窄范围真实测试；绝不打印、复制、提交或写入 Thread/Prompt/Artifact/Trace 的秘密或隐私内容。先检查 Git 状态，保护用户与并行改动；禁止危险历史改写、破坏性清理和越界删除。
```

## 参考

- LLM Space：https://github.com/deer-flow/llm-space
- Oh My Pi：https://github.com/can1357/oh-my-pi
- Prompt History：https://phistory.cc/?agent=codex&range=latest
