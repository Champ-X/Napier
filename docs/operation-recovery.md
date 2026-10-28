# 操作级恢复：补丁对账与用户答案

## 确认未提交后的补丁恢复（2026-10-29 当前切片）

新增显式 `verified_patches` 策略：在智能体的中断策略中选择“自动 · 已核验补丁”，对采用该策略的新 Run 生效。`safe_read_only` 的写权限不变，也不会用修改后的智能体配置追溯授权旧 Run。恢复先执行已记录且确认未提交的精确补丁，再用只读工具继续模型工作；它不是无限制恢复写工具。

主 Agent 的 `apply_patch` 调用将原始参数保存到私有胶囊（0600；512 KiB/对象、512 对象、32 MiB 总量），账本只保留摘要和绑定。普通执行的捕获仍为 best-effort，但恢复必须读取和验证胶囊。v2 写前准备记录增加强制 `workspace.patch.commit_started` 检查点；无法持久化该检查点就不能 link/rename 目标，已经消费的检查点不能再次授权提交。

| 原操作状态 | 依据与恢复行为 |
| --- | --- |
| 尚未越过 effect boundary | 原 Run 已被终态封锁，完整 admission/start 日志与精确输入匹配；重查目标前置条件后可执行 |
| v2 prepared 后、commit_started 前 | `workspace.patch.not_committed`、原操作 fence 和 interrupted 状态原子提交；确认没有进入目标提交，再重查前置条件 |
| commit_started 已存在，目标仍缺失或未变化 | 仍为结果不确定；不会把“看起来没变”当作从未写入 |
| 已提交但尚未返回/结算 | 复用已有文件身份/摘要对账；不重复写入 |
| 已结算或终态响应丢失 | 保留精确结果或后置条件证据，继续剩余只读工作 |

恢复计划和新 Run/租约同一次 SQLite 事务保存。每项计划引用原调用；下一次进程恢复会检查该项是否已在恢复 Run 启动，继承尚未开始的工作，或改为对账最近一次执行。原 Run 不补造 tool.completed。计划覆盖保留的先前补丁和当前待执行补丁，因此同文件版本链在第二次恢复时仍核对最终状态。

每次执行继续使用 `executeAdmittedToolCall` 的 authority、并发资源和结算路径，以及原工具的诊断/输出保护。恢复前验证冻结的工具定义和当前智能体权限；实际执行前再次核对文件和权限。原配置涉及进程能力时，也重新检查 Sandbox 就绪状态。模型只看到只读工具。执行结果进入后续模型上下文，结果体有明确的上下文限额和省略标记；完整工具结果仍按现有私有结果存储规则保存。

故障实验发现死进程的工具并发租约会残留 120 秒。现在仅对严格匹配本机进程 owner 格式、且 `process.kill(pid, 0)` 明确返回 ESRCH 的租约提前清理。活进程、未知 owner、EPERM 等未知状态不会被提前回收；清理资源租约不取代操作 fence 和补丁恢复证明。

当前复现：`node scripts/check-verified-patch-recovery.mjs /tmp/napier-verified-patch-new.json`，输出独占创建。最终收据见 [verified-patch-recovery-verified-2026-10-29.json](artifacts/verified-patch-recovery-verified-2026-10-29.json)。31 个真实进程故障/拒绝用例覆盖 create/replace 的两个早期断点、五种恢复过程再次退出、最终响应丢失、双进程竞争、同文件多步补丁、权限/文件/Sandbox 漂移、缺失输入和晚到提交。没有重复目标提交；已有目标的 inode/mtime 在结果复用场景保持不变。0 外部模型请求，模型为显式 faux provider。

[补齐 Sandbox 后的 31 用例收据](artifacts/verified-patch-recovery-current-2026-10-29.json) 也保留；最终仅将 Sandbox 类型导入改为直接依赖类型模块，消除新引入的 barrel 耦合超限后重新验证。

[首份 30 用例收据](artifacts/verified-patch-recovery-2026-10-29.json) 保留添加 Sandbox 门槛之前的源码快照。测试过程中还发现 tsx 与 Vitest 的函数源码转换会产生不同工具定义摘要；恢复进程使用相同 tsx 入口验证，不放宽定义比较。耗时是本机单次 restart/continuation 采样，不包含策略 backoff，不代表真实模型性能改善。

验证汇总：13 个 Runtime 文件共 125 个不同用例；Server 配置校验 8 个，Web 3 文件共 10 个用例。Contracts 构建、Runtime typecheck/build:compile、Web/SDK/Server typecheck、Web build 与 design contract 通过。架构为 10 项既有失败：将模式注册和恢复授权归回各自模块后，原 run-config 超限被消除；相应预算只下调。公开 API 仍为原 root 1897/1896 与 compatibility digest 两项失败。历史 release source manifest 未改，编译不等同完整发布验收。

本切片仅授权已有精确捕获的主 Agent apply_patch。未知写工具、缺少准备证据的历史操作、Workflow 待执行写入、未进入 journal 的后续模型工具请求仍不获得写权限。v2 证明只针对目标提交，先前创建的父目录可能保留。未验证断电或跨主机语义、真实模型质量、完整自定义 lifecycle 扩展策略及统一恢复操作区的可用性；G04 与 G01–G07 继续实施。以下章节保留各历史切片的证据和当时边界。


2026-10-29。当前实现覆盖已结算的 `apply_patch`、有写前意图的未结算文件提交，以及已保存 Workflow 审批的原请求重试。补丁恢复核对文件后继续只读工作；审批恢复复用已保存答案和 continuation。G04 整体验收仍未完成。

## Workflow 审批的原请求重试与进程互斥

此前 Store 已支持同答案重试，并将 continuation 与新 Run 原子保存，但嵌入式 `answerAndResume` 仍只接受 pending 决策。真实进程在保存答案后退出，调用方重试同一请求会得到 state_conflict。现在显式 decisionId 可以定位 pending、answered 或 continued 的原决策；没有 decisionId 的 pending 查询仍只返回待回答决策。

请求使用原 pending、已保存答案或当前决策快照校验 expectedDecisionSha256，再按原问题规则验证答案。保存仍交给已有规范化和 answerSha256 去重：不同答案冲突，已取消答案不重新启用。及时保存的答案按原 answeredAt 判断截止时间，因此响应丢失后即使过期也能继续；已过期但尚未回答的决策拒绝保存。已落账答案的观察者回调失败不会抹掉答案，显式取消在保存之后仍可停止这次调用，随后重试继续。

保存前复用 Workflow ledger 验证 Plan/manifest、原 Run 的 Agent/revision、节点开始 input 摘要、审批 schema/attempt、requestedEventSeq、原 requestSha256 与 expiresAt。续跑时保留原有上下文、输出、continuation 身份和结果完整性检查。原 continuation 已经存在时不新建；成功或拒绝后的重复请求没有新增事件，拒绝不会执行下游工具。

并发实测暴露了原来只在一个 Runtime 实例内有效的 activeThreads 限制。Workflow 上下文现在通过同一 SQLite ledger 的 Thread 级进程锁执行。SQLite 事务原子认领和替换死亡进程，随机 token 限定释放；恢复请求等待前一个驱动者退出并支持 AbortSignal，新建执行遇到占用仍拒绝。同一 Workflow 内的并行节点和其他 Thread 不串行化。原 owner 死亡后，接管者先复用现有 Run 对账，再重新读取上下文，不保留等待前的状态快照。

锁没有 TTL：活进程即使暂停也不能被另一个驱动者抢占。只有 ESRCH 证明原 PID 已不存在；权限错误或其他探测错误保守等待。该机制仅适用于本机 LocalStore；PID 复用可能保守阻塞，不支持跨主机 fencing。SQLite schema 从 7 迁到 8，只增加锁表和迁移记录；已有事件不改写，旧 Runtime 不能直接打开升级后的数据库。初始化的 busy_timeout 提前到首次读取 schema 之前，处理同时打开数据库时观察到的锁冲突。

复现：`node scripts/check-workflow-approval-recovery.mjs /tmp/napier-workflow-approval-new.json`，输出独占创建。当前收据：[workflow-approval-recovery-verified-2026-10-29.json](artifacts/workflow-approval-recovery-verified-2026-10-29.json)。审批、SQLite 与 apply_patch 均真实执行，模型注册表为空，0 外部模型请求。

| 故障或竞争 | 验证范围 |
| --- | --- |
| 答案落账、continuation 事务前/后、审批完成前、Plan 已完成但节点事件未写、节点事件已写、Workflow 结果已写后退出 | 同一请求恢复成功；approve 与 reject 各 7 个断点；分别仅 3 / 2 个 Run，1 个答案、1 个 continuation，1 / 0 次下游写入 |
| 两个独立进程同时重试 | barrier 同步开始；两个调用均返回 completed，只有一个 continuation 和一次写入 |
| 原 driver 在 continuation 事务后 SIGSTOP，再 SIGKILL | 活进程期间等待；死亡后接管，复用 interrupted continuation，下游只执行一次 |
| 同一 Runtime 并发、等待者取消、其他 Thread 执行 | 请求串行恢复；取消不影响原 owner；其他 Thread 能到达等待审批 |
| 截止后重试、错误摘要、改变答案、损坏请求绑定、观察者断开 | 保留原答案；无效请求在新答案或下游执行前拒绝；已保存的及时答案可继续 |

固定 `610a8ef54426fb3408d43d1e33f1ce6f419cd7ca` 的旧嵌入式审批服务在同一个真实已保存答案上仍拒绝重试，当前服务可以完成。该对照仅冻结审批 API，支持模块使用当前实现；不是完整历史发行版基准。收据记录单次重启与续跑时间、Run/事件/写入数量；不将这组本机采样称为生产性能改善。最终响应丢失场景检查文件 inode/mtime 保持不变。

此前的 [中间收据](artifacts/workflow-approval-recovery-current-2026-10-29.json) 保留其源码快照。随后补充反例发现：请求以已回答快照的摘要发起后，continued 状态会让同一请求再次被误判 stale。现已覆盖这一历史快照并验证重复调用没有新事件，最终收据包含该回归。一次更早的证据封装运行仅保留了测试进程 exit 1，没有保留具体失败项，原因无法据此确定；封装现已输出失败断言，后续当前源码的独立运行通过。未将中间结果当作最终验收。

相关检查共 14 文件 156 个不同用例通过，其中当前收据固定 3 文件 29 项；其他覆盖 Workflow 执行/恢复/重试/并行节点、实验/断点/循环/成果结算和 SDK。Runtime typecheck / build:compile 与 diff check 通过。架构回到原 11 项失败，公开 API 仍为 root 1897/1896 和 compatibility digest 不匹配；未提高预算，未修改历史 release source manifest，编译不等于完整发布验收。

这些检查覆盖审批与 continuation 边界，不授权任意下游写工具的自动重放。下游工具自身执行中断仍适用原有操作恢复策略。未执行操作自动继续、统一恢复操作区，以及 G01–G07 的剩余目标仍待完成；不宣称断电持久性或外部系统普遍 exactly-once。以下补丁和普通问题章节保留此前切片的历史证据及当时边界。

## 未结算补丁的写前意图与对账

主 Agent 的补丁工具现在在路径锁内完成临时文件写入和 fsync，保存私有意图并追加 `workspace.patch.prepared`，随后重新检查目标前置条件，再执行原来的原子 link/rename。意图绑定 thread/run/call、原输入摘要、私有路径绑定、临时文件 dev/ino 和实际执行进程 PID。账本只保留摘要和执行边界身份，不公开路径、正文或 PID。存储或账本写入失败时不提交目标文件；临时文件按既有 finally 清理。新 intent store 仍限制 512 个对象、16 KiB/对象、8 MiB 总量，容量不足会明确拒绝这次写入，不删除证据腾空间。直接调用低层补丁 API 的现有消费者没有自动获得此恢复资格。

重启对账要求原进程已退出，唯一合法调用和完整 execution authority 绑定仍在，且私有意图完整。恢复取得所有已知目标的路径锁，同时检查当前文件的摘要和 dev/ino，锁保持到 SQLite 恢复事务结束。只有内容相同、文件身份也相同才接受；其他进程写入的同内容替代文件、活跃写锁、仍存活的原执行进程均不通过。证据缺失、路径/工作区漂移、符号链接和多条未结算写入争用同一路径也停止。

事务将 `tool.operation.effect_indeterminate`、`workspace.patch.reconciled` 和 `run.interrupted` 一同保存，撤销原 Run 租约。effect_indeterminate 继续永久禁止旧调用追加结算、响应、结果复用或续租；reconciled 只描述独立文件观察，不将旧工具结算为成功。SQLite 要求每个被封锁的操作都有绑定写前记录的证明，拒绝单独追加证明、没有证明却改成 interrupted、错误代次或已经发布终态的操作。事务失败时三类记录和 Run 状态一起回滚，路径锁释放后可再次核对。

当前评估器识别完整对账链，调度资格仍不等于成功。新 Run/模型调用前再次读取私有意图和文件，检查最新版本链及身份；claim 后被替换为同内容新文件也会停止。续跑提示分别列出已结算和独立对账的操作数量，并说明写后诊断可能缺失，不补造原工具结果。权限保持 `safe_read_only`，不会重放补丁，也不扩展通用 exact-result replay 权限。

验收收据：[unsettled-patch-recovery-current-2026-10-29.json](artifacts/unsettled-patch-recovery-current-2026-10-29.json)。复现：`node scripts/check-unsettled-patch-recovery.mjs /tmp/napier-unsettled-patch-new.json`，独占创建，保留旧收据。26 个独立进程场景使用真实 Runtime、SQLite 和文件系统，显式 faux provider，0 外部模型请求。覆盖原有 10 场景和新增 16 场景：

- create/link 与 replace/rename 之后、返回/结果胶囊之前立即退出；原文件内容、inode、mtime 不变，只读 continuation 完成，0 次重写。
- 写前意图已保存、目标尚未提交时停止；不凭意图推断成功。这个窗口留下的临时文件或新父目录不被当作正式成果。
- 摘要变化、文件缺失、同内容新 inode、符号链接、意图丢失/损坏、写前账本损坏、活跃路径锁均停止。写前存储失败没有目标写入。
- 原写入进程释放路径锁后仍运行时拒绝对账；SIGKILL 后才允许核对。重复启动不重复证明；旧 executor 的迟到结果被拦住。
- claim 后同内容替换在模型调用前拒绝；SQLite snapshot 故障回滚后可重新对账。

固定旧 `caf37eaf` 自动恢复评估器在相同实际事件流上仍拒绝恢复。该对照仅替换评估器，不是完整历史发行版；单次耗时仅为本机 fixture 采样。进程退出测试不证明断电持久性、跨主机 fencing 或真实模型质量提升。对账只确认文件后置条件，写后诊断和整体目标仍需后续验证。无写前记录的历史未结算操作、before-effect / before-target-commit 自动继续、Workflow 审批故障矩阵和统一恢复操作区仍未完成。

相关 11 文件共 104 个不同用例通过；最终工具配置职责收敛后，进程矩阵及受影响的工具/Workflow/SQLite guard 用例再次通过。Contracts build、Runtime typecheck / build:compile 和 diff check 通过。架构维持原 11 项失败，公开 API 仍为 root 1897/1896 和 compatibility digest 两类失败；未提高预算、未更新历史 release source manifest，也不把 build:compile 称为完整发布验收。失联 Run 处理提取为独立模块；tools.ts 预算由 1776 降至 1766。初次 26 场景收据 [unsettled-patch-recovery-2026-10-29.json](artifacts/unsettled-patch-recovery-2026-10-29.json) 保留其源码快照；随后仅调整工具配置职责并重新生成当前收据，没有覆盖历史文件。

以下已结算补丁和答案章节保留之前切片的历史证据与边界；其中旧表的未结算行已由上面的新切片部分推进。

## 行为与证据链

旧评估器把本轮出现的任何写工具都列为自动恢复阻断原因。当前评估器保留历史写调用统计，但对满足以下条件的补丁允许进入恢复前检查：唯一调用身份、合法 execution authority 各阶段、已越过 effect boundary、成功结算，以及匹配的终态或可按结算 effectSha256 读取的精确结果。恢复前还必须验证结果完整性和私有路径绑定。`eligible` 是调度资格，不等于文件已经重新检查或目标已验收。

补丁工具使用已有 `LocalPrivateCapsuleStore` 保存最小路径绑定。胶囊包含调用/input 身份、真实工作区根摘要、规范化路径及前后文件摘要；账本只保留胶囊摘要，不公开私有路径或补丁内容。存储限制为 512 个对象、16 KiB/对象、8 MiB 总量。此前的写后路径绑定采用 best-effort；新主 Agent 写前意图路径要求存储成功才提交目标。旧终态和直接低层调用仍按原规则检查；不删除既有胶囊腾空间。

补丁返回前还保存完整结果（文本与 details），以既有 `toolExecutionResultEffectSha256` 为地址，限制为 512 个对象、512 KiB/对象、32 MiB 总量。该摘要覆盖 callId、成功/失败、输出文本及完整结果，恢复时必须与日志中的成功结算完全一致。无需反查路径或扫描文件。结果缺失、调用身份不匹配或篡改时停止。旧终态证据仍可使用原路径绑定，不强制要求新结果格式。

自动恢复在创建新 Run 和调用模型前重新检查当前操作记录及文件。它绑定胶囊与调用、输入、工作区、前后摘要，并对同路径的多次补丁核对前后版本链，只比较最后版本的当前文件。检查拒绝缺失、内容漂移、符号链接叶节点和父目录、工作区变化、证据缺失或篡改。descriptor 读取有界，并核对 inode/dev、size、mtime/ctime 和真实路径。最多检查 128 个补丁，每个当前文件最多 256 KiB；不扫描工作区。

结算后丢失响应时，恢复只继承原结果中的补丁事实和结果摘要，并保留私有完整结果；不会向旧 Run 补造 `tool.completed`。通用工具的 resultReplay 权限没有扩展。这是恢复上下文的结果继承，不是给写工具重新发放执行权。

恢复沿用原有 `safe_read_only` 策略：保留已完成写入的证据，继续后续只读工作，没有新增写权限。提示明确保留了哪些操作，文件后置条件只在恢复前观察，不表示整个目标通过验收。历史统计字段 `toolCalls.unsafe` / `unsafeToolNames` 仍表示曾执行过的写工具，不被改写为 readOnly；是否阻断由 operation 证据决定。

## 已结算切片的历史进程故障验收

复现：`node scripts/check-settled-patch-recovery.mjs /tmp/napier-patch-recovery-new.json`。输出以独占创建写入，不覆盖历史收据。此前 10 场景收据为 [settled-patch-result-recovery-current-2026-10-29.json](artifacts/settled-patch-result-recovery-current-2026-10-29.json)，绑定 16 个相关源码与复现文件。首切片的 [8 场景收据](artifacts/settled-patch-recovery-2026-10-29.json) 保持原样。测试使用真实 Runtime、SQLite、文件写入和独立子进程；在指定检查点 `process.exit(73)`，不执行正常清理。模型为显式 faux provider，外部模型请求为 0。

| 断点或变化 | 当时结果 | 当时的后续缺口 |
| --- | --- | --- |
| 写入、操作结算与 tool.completed 均已落账，下一步未启动 | 新 Run 继续；文件内容、inode、mtime 均未变化，0 次重写 | 后续需要写操作的任务仍受现有只读策略限制 |
| claim 后文件内容变化、文件消失、符号链接替换、路径绑定缺失、结果缺失或篡改 | 新 Run 和模型请求前停止 | 用户操作区的统一说明仍待接通 |
| effect boundary 前退出 | 文件不存在，保持 interrupted，不自动重放 | 尚未实现确认未执行后自动继续 |
| 文件已写入但操作尚未结算 | 文件保留，failed / blocked_safety，不自动重放 | 不确定操作的后置条件对账适配仍待实现 |
| 操作已结算但 tool.completed 未落账 | 按结算摘要继承精确结果，重查文件并继续；旧 Run 没有补造响应，0 次重写 | 仍沿用只读恢复权限 |

固定 `caf37eaf5e5a1ab1fae55b4a644d2ee460ed54d1` 的旧评估器，对两个同一实际事件流分别返回 unsafe_tool_effect，以及 unresolved_tool_call + unsafe_tool_effect。当前两种已结算断点均成功续跑；文件内容、inode、mtime 均未变。当前单次重启/continuation 为 28.68/131.73 ms（终态已落账）和 59.72/105.34 ms（响应丢失）；不含策略 backoff，使用 fixture 模型。它们是本地确定性采样，不是生产恢复率或真实模型性能改善声明。

本轮两份中间收据也保留：[初次运行](artifacts/settled-patch-result-recovery-2026-10-29.json) 的进程测试通过，但随后类型检查发现结果 usage 类型不兼容；[第二次运行](artifacts/settled-patch-result-recovery-verified-2026-10-29.json) 的进程测试和编译通过，但架构检查发现类型导入环。当前实现已限制补丁结果元数据并将相关类型归入 model，消除这些新增问题。中间收据仅证明其各自源码快照的进程测试，不是完整验收结论。

故障注入还发现并修复了旧恢复代码漏传 `failureDefinitionSha256` 的问题：真实工具的 descriptor hash 因此不匹配，重启无法写入 effect_indeterminate 记录。现在保留该字段，并仍将不确定副作用明确停止；没有把它改为成功。

## 验证与剩余边界

- 首切片 6 文件 38 用例记录保留。本轮 5 文件共 32 个不同用例通过：10 个进程断点场景，以及补丁工具、版本链/路径对账、自动恢复和通用结果重放策略的 22 个回归；两个检查点均没有重复写入，结果缺失和篡改均在模型请求前停止。
- Runtime typecheck、`build:compile`、`git diff --check` 通过。操作观测职责从自动恢复评估/校验中提取，行数预算随实际代码从 807 下调为 710；架构检查仍是原有 11 项失败，没有提高预算。
- 前一切片执行 `npm run build -w @napier/runtime` 的 release source manifest 校验失败，本轮未重复该历史发布门槛；未重写历史 manifest。编译成功不代表这个发布检查通过。
- 当前公开 API 检查仍为 Runtime root 1897/1896 及 compatibility digest 不匹配，与本轮开始前记录一致；没有新增 root exports。
- saved answer / approval 与 continuation 的幂等衔接、写权限策略、未结算操作对账及恢复操作区仍未验收。没有宣称外部系统普遍 exactly-once。


## 已保存答案与 continuation 的事务边界

2026-10-29 的后续切片将 `operator.decision.continued` 与新 Run/租约保存到同一次 SQLite 事务。Run 创建时仍检查原 Agent revision、模型与权限；串行状态队列和现有 revision CAS 负责并发竞争。原来 Run 已保存、决策仍为 answered 的可见间隙被消除。公开的 `continueOperatorDecision` Store 方法保留兼容性，相同绑定重复调用返回已有决策、空新增事件。

保存答案使用现有规范化规则和 answerSha256：同一 decision 的同一答案重试返回已有记录，即使续跑已开始或结束也不重复追加事件；不同答案明确冲突，已取消决策不会被重新激活。继续请求读到已绑定的 Run 时只观察其状态，不获取租约、不重放模型/工具或再次调用 onRunCreated。并发竞争失败者重新读取持久化绑定；尚未结算时每 100 ms 检查状态，直到真实终态才返回，避免 SSE 提前发送 done。观察者取消不取消原执行者；尚未额外测量大量并发观察者的开销。

Run 已创建但提示尚未保存时退出，重启后仍返回该 Run 的 interrupted 状态，普通重试不会暗自发起另一轮。用户随后使用现有 Run 恢复入口时，Runtime 从父 Run 的验证后决策投影中读取与这个 continuation 精确匹配的原答案，将其加入恢复提示；不能仅凭数据库保存成功声称模型已继承答案。进程测试确认恢复模型实际收到原 customText，并只写文件一次。自动只读恢复也复用该上下文函数，但本切片没有新增自动恢复权限。

复现：`node scripts/check-operator-decision-recovery.mjs /tmp/napier-decision-recovery-new.json`，输出独占创建。收据：[operator-decision-recovery-2026-10-29.json](artifacts/operator-decision-recovery-2026-10-29.json)，绑定 19 个源文件/测试/复现文件。它覆盖 7 个 Runtime 决策用例、2 个 Workflow 输出兼容用例和 1 个真实服务 HTTP/SSE 集成用例；外部模型请求 0。

| 断点 / 重试 | 观察结果 |
| --- | --- |
| 答案保存后退出 | 原答案仍为 answered；同答案重试无新事件；一个 continuation 完成，一次补丁写入 |
| 关联事务提交前退出 | 数据库中没有新 Run，也没有 continued 事件；重启后一个 continuation 完成 |
| 关联事务提交后、兼容 JSON 投影前退出 | Run 与 continued 事件同时存在；重复继续返回同一 interrupted Run；显式恢复收到原答案并完成 |
| 两个独立 Store/Runtime 并发继续 | 同一 Run、一次 onRunCreated、一次补丁；两个调用均等待真实终态 |
| 提交失败 / 观察者取消 | 失败事务回滚 Run 与关联；取消重试观察不取消原执行者 |
| 并发 HTTP 保存与继续、完成后重试 | 保存返回同一答案；SSE snapshot/done 绑定同一已完成 Run；无额外模型调用 |

固定基线 `9ba6ed3d52f463a597c0750c7eeace762526c21b` 的 Store 与 ThreadInteractionRepository 在子进程中实际运行，复现同答案重试被拒绝，以及 createLeasedRun 返回后退出留下 answered 决策和未关联 Run。只替换这两个固定模块，其余支持模块沿用当前实现；不声称进行了完整历史发行版的对照实验。当前并发检查是同进程中的独立 Store/Runtime 及 HTTP 请求，不是多进程竞争基准。收据中的耗时只是一组本地采样。

兼容检查还发现前一补丁切片新增的私有 recoveryCapsuleSha256 会破坏 Workflow 的严格输出 schema。现在 Workflow 在验证原始完整结果摘要后，只将原公开补丁收据投影给 typed output，并重新计算公开收据摘要；原始 journal/tool.completed/私有结果仍保留恢复绑定。原有严格 schema 的真实写工具 Workflow 通过，篡改的结果不会被重算为合法输出。

相关检查共 12 文件 150 个不同测试通过，包括原 Store/线程导入导出、Agent Runtime/Kernel/能力边界、Workflow、补丁进程断点和新增 HTTP 路径。Runtime typecheck、build:compile、diff check 通过。提取决策 gate 职责后 Store 行数预算从 3773 下调到 3766，复杂度从 101 下调到 96；没有提高预算。架构仍为原 11 项，公开 API 仍为 1897/1896 和 compatibility digest 不匹配；完整 release build 的历史 source manifest 门槛未重写，编译通过不代表发布通过。

剩余边界：本切片没有验证完整的 Workflow 审批进程故障矩阵，未交付浏览器“回答并继续”和统一恢复操作区，也没有扩展未执行/未结算写操作的恢复。G04 与 G01–G07 总目标保持未完成。

## 2026-10-29：恢复操作区与只读核查

本轮增加共享 `ThreadDetail.recoveryCheckpoint`，由 Runtime 从最近停止的 Run 及完整账本生成。Web 不再从工具名称或文件存在推断补丁已经提交；复用补丁结算、独立对账和未提交证明的绑定检查。分类为已结算、确认未提交、需要对账、不可自动重放，最多显示 128 项，统计保留全部调用；超出 10,000 个事件或事件身份冲突时不作分类。投影不读取私有正文和路径，也不宣称当前文件仍有效。

恢复区连接执行轨迹、已有决策区和计划概览。未知效果、补丁或不完整证据使用新增的 `POST /api/threads/:threadId/resume` 可选 `readOnly: true`：沿用原 Agent 能力边界，但 Runtime 进一步限制为本地只读工具，绝不执行待写补丁。普通 API 请求不传此字段时保持原手动续跑行为；它仍是模型续跑，不等同于 `verified_patches` 的确定性恢复。

只读核查结束按既有协议保存为 `failed / partial`，原因明确为核查结束、原任务仍需继续或对账；不记录原任务恢复完成，也不评估或自动续跑原目标；核查出错不改写原目标状态。后续投影沿只读恢复父链（上限 16）保留原操作事实，避免核查后隐藏尚未解决的副作用。父链缺失或循环会停止分类。Runtime 入口和创建 Run 的事务内都拒绝已被后续 Run 取代的检查点；Web 抑制同一会话的即时重复点击，网络错误后重新加载原会话账目。

验证与复现见 `docs/artifacts/recovery-operations-ui-current-2026-10-29.json` 和 `scripts/check-recovery-operations-ui.mjs`。脚本要求先构建 Contracts、Runtime（`build:compile`）、Server、Web，然后使用独立临时目录与真实 HTTP/SQLite/Chromium。故障由真实子进程在目标文件提交后退出；只有模型是 faux provider，禁止浏览器访问外网。证据覆盖 7 种尺寸、键盘 disclosure、按钮实际命中检查、只读权限、恶意写调用被拒、原文件 inode/mtime 不变、部分状态和父检查点保留、旧请求重试不新建 Run。首轮 320px 截图被现有证据抽屉遮挡，已修改脚本关闭抽屉并检查按钮可点击；该首轮不算窄屏验收。

范围：Workflow 在本区只能查看计划概览或转到已有审批区，尚未接通所有 Workflow 恢复变更操作；保存审批答案仍走既有决策服务。未增加通用写工具自动重放，也未完成完整恢复分类验收、历史活动卡终态统一或 SDK/CLI 的新只读开关。Hook 测试覆盖响应不确定后的刷新与原会话错误归属，不等同于真实 TCP 响应丢失故障注入。本轮保持 G04 与总目标 active。


## 2026-10-29：使用原定义继续 Workflow

Task 概览现在提供 Workflow 专用操作：查看待回答问题、从当前断点继续、继续已保存答案，以及按既有 Workflow 规则重试可恢复节点。它不会调用普通 Agent 的通用继续提示。已保存答案仍通过原决策服务写入；Workflow 原有审批、节点恢复、Agent revision、工具权限和尝试次数校验继续生效。新的 UI 入口不需要重新上传 manifest。

新 Workflow 在创建执行 Plan、运行节点之前，将验证后的完整定义写入私有 `workflow-manifests` 胶囊目录。对象按 manifest 的内容摘要寻址，权限为 0600；目录权限和原有胶囊校验复用现有存储。限额为单对象 1 MiB、2048 个对象、总量 128 MiB，保存失败时停止创建执行 Plan，不静默降级为无定义记录。没有为旧 Workflow 推断或重建缺失定义；旧记录缺少定义、定义损坏、启动证据重复或绑定漂移时明确停止。

公开入口为 `GET /api/threads/:threadId/workflows/:planId/recovery` 和同路径 `POST`。GET 返回可用性、动作和检查点摘要，不返回可执行定义。POST 只接受 `{ checkpointSha256 }`。摘要绑定 workspaceRoot/dataRoot 及当前 Plan、事件、Runs、决策和原 manifest；执行锁内重新核验，再持久追加 `workflow.recovery.claimed`，随后进入现有 Workflow Runtime。该声明消费的是这一检查点的继续请求：并发调用只允许一个通过，已经消费或变化的旧请求返回 409，需要刷新。它不会把旧请求改解释为对后一个断点的许可，也不声称旧请求会返回相同 HTTP 结果。此约束适用于新 recovery 入口；原来直接提供 manifest 的 `/workflows` API 保持兼容，没有将它的裸 `continueBreakpoint` 标记改成新的协议。

Web 按 workspace、thread、plan 隔离状态，抑制同一渲染内的重复提交；延迟读取不能替换较新的检查点。提交失败或响应不确定后，先查询持久状态再启用下一次操作；切换视图后旧操作不会写入新视图。原定义、计划和操作身份在 Runtime 校验，前端分类不成为执行权限。已完成步骤与整个任务验收分开表述；Workflow 区域不重复显示“重新回答”的通用提示。

当前浏览器证据为 [workflow-recovery-ui-bound-2026-10-29.json](artifacts/workflow-recovery-ui-bound-2026-10-29.json)，绑定 30 个源码/测试/脚本摘要。复现：构建 Contracts、Runtime `build:compile`、Server、Web 后，运行 `node scripts/check-workflow-recovery-ui.mjs /tmp/new-workflow-receipt.json`，独占创建收据。脚本用真实 HTTP、SQLite、Chromium 和文件写入，零模型调用；检查保存答案后续跑、HTTP 提交成功后在浏览器丢弃响应、两断点之间的旧请求重试、定义消失、键盘操作和 7 种窗口尺寸。两次写入各只执行一次，响应丢失后的旧请求不改动文件 inode/mtime。该故障是浏览器在实际 HTTP 完成后 abort，并非 TCP 丢包注入。首份中间收据位于忽略的 benchmark-results，包含后来移除的重复提示，不作为当前截图。

新增 Runtime 测试还在 claim 落账后和 Workflow completed 落账后用独立子进程 SIGKILL，重启后保留答案、拒绝旧请求，并从新检查点继续或观察已完成结果；覆盖两个独立 Store 并发、定义缺失/篡改、跨线程/重复启动证据、创建目标的环境漂移。将账本复制到另一组 workspaceRoot/dataRoot 后，旧检查点摘要也会被拒绝，不能跨目录授权。目标在检查点后被用户创建时，原 apply_patch 的前置条件使节点 blocked，用户内容和文件身份保留。

边界：本切片没有为任意外部副作用增加对账适配器，也没有承诺重查所有已完成 Workflow 写节点的当前文件状态；仍遵守原 Workflow 的节点证据和已声明产物校验。新 recovery 请求本身尚无 SDK/CLI 便利方法；完整恢复分类、历史活动卡终态、G01/G02 剩余项与 G03/G05–G07 均未据此验收。界面没有完成率或真实模型质量改善声明。
