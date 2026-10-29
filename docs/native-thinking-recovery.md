# 原生 thinking 恢复的主子共享规则

本片本地实现提交为 `250c55f115aa546748b7f6de0bd943097e8e2c1f`，未 push。覆盖普通模型回合的重复推理、语义停滞和仅含 thinking 的终态。主 Agent 与 child 使用同一恢复驱动；单次 `ModelSession` 仍只执行一次物理调用。完整 child compiler、overflow、extension 一致性和并发 owner 预算预留仍未完成。

## 调用与计量边界

共享 guard 位于所选 route candidate 内，直接观察物理调用的隔离流。路由对未提交 thinking 的缓冲不能遮住 guard；一次逻辑 open 在切换候选后仍至多使用一次 thinking 重试。重试保留候选路由凭据、回调和输出上限，按模型能力缩短 reasoning，并在后续有限回合内保持该策略。

检测到停滞后先取消并结算本次逻辑终态。child 同时恰好一次关闭 invocation reservation；主调用的逻辑终态由实际 `ModelSession` transport 结算，抑制决策另记 detection，不伪造额外 `model.response`。

原生恢复等待的能力只属于本次物理调用：source receipt 持久化、Store 原子 claim／投影以及 source ACK 全部成功后才可继续。精确 receipt reader 在同一 SQLite 快照中校验原生 attribution、owner、source、claim 和对应事件；reader 本身既不证明 ACK，也不授权新调用。进程内 opaque handle 连接真实 admitted 调用的 completion，不能从 provider options、事件 JSON、复制对象或导入记录制造。

等待上限为检测时原任务剩余寿命与既有 5 秒取消宽限的较小值。根取消中断等待；计量失败、最终 unknown／partial、失配 handle 或宽限到期均停止重试。readiness 返回及 detection 回调之后都会重新检查实际时钟，不能通过延迟 timer 或慢回调获得新期限。若回调耗尽宽限，已记录的 retry intent 后追加 finalize／pending_timeout，实际不派发。

重试重新经过 owner、预算、turn 和 host admission，生成新的 capture、reservation 与 physical ID。仅等这次调用，不关闭 registry，不等待无关模型调用。明确未启用原生计量的兼容 registry 保留历史估计规则，并记录 `legacy_unaccounted`；未绑定或失配的 native 调用不能降级到该路径。

## 隔离与 checkpoint

迟到 raw terminal 可包含文本或工具调用。其真实用量可以解除计量等待，但迟到内容不能发布、执行或回填逻辑输出。物理 receipt 的 response hash 与本地 synthetic abort 的逻辑 hash 因而可以不同。

child 的 `suppressed_thinking_recovery` 需要 guard 发出的私有证明，绑定逻辑响应摘要、完整 detection evidence、原生 physical attribution 和 envelope。Store 首次消费时再绑定精确 child fence、invocation 与 capture；复制、伪造、改写或跨调用重绑均拒绝。普通 append／append-once／run-head append 不能直接写该标记。

checkpoint 和 transcript 不把被抑制响应当成交付内容，但原有物理计量完整性、调用结算和工具证据校验继续生效。replay／import 只能验证已有持久证据，不能签发新的运行时能力。最终不完整 receipt 保持不可变，后来的读取或重试不会把它升级成 complete。

## 验收范围

[最终联合收据](artifacts/native-thinking-recovery-regression-2026-10-30.json) 为 **99 文件／777 测试通过**。Contracts／Runtime／CLI／Server 编译、Web／Harness／Benchmark 类型检查及新增／修改测试 strict 检查通过。验收使用精确 G03 staged blobs 的独立 checkout，排除同时进行的 G04 文件移动实现与用户原有未提交修改；4,009 源码、5,051 emitted 摘要稳定，原工作区 28 个受保护用户文件单独核对摘要。

[独立证据索引](artifacts/native-thinking-recovery-evidence-index-2026-10-30.json) 保留首轮冻结 773／774 的失败：旧 fixture 用预算检查次数定位派发边界，新增正确的前置检查使其过早拒绝。现改为在 durable capture 后注入预算耗尽，保留 reservation、known-zero 响应、零派发／turn／step及 capture-before-response 断言。最终提交检查另发现一处 EOF 空行；仅移除此空行后重编译，全部 5,051 emitted 文件逐字节相同，实际 staged diff 检查通过，未重复行为测试。

隔离快照仍有 7 项既有架构失败；此前包含用户原改动的收据为 8 项，范围不同。root API 1897／1896、internal API 21／16 与两项 digest 门禁仍失败；旧 `agent-runtime.test.ts` 的 48 个严格类型错误与原 `d2e33ac3` 基线一致。历史 release manifest 未重写，不能据此宣称完整发布验收。

开发期主调用反例发现 route buffer 遮住了约 6 KB 重复推理，已通过将 guard 放入 candidate 修复；取消恢复等待也曾错误返回 failed，现保留 host-attested aborted／cancelled。早期日志原样保留，不作为冻结基线或独立性能实验。

所有模型响应均来自本地 fixture 或已有 loopback 测试；没有外部付费模型调用。这些证据验证调用生命周期和持久化边界，不证明真实模型任务质量或延迟收益。provider error／aborted receipt 仍不能仅凭等待推断为 complete，因此本片不构成完整 overflow parity。G02、G03 与 G01–G07 总目标继续 active。
