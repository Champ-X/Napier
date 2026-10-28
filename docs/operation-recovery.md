# 操作级恢复：补丁对账与用户答案

2026-10-29。当前实现覆盖已结算的 `apply_patch`，以及有写前意图的未结算文件提交。前者继承终态或精确结果，后者独立核对当前文件后只读续跑。G04 整体验收仍未完成。

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
