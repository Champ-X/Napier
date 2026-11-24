# 模型调用的持久用量归属

本片实现已本地提交 `58e61c30`，冻结功能回归通过；内部 API 门禁仍未通过。G03 与 `goal.md` 的整体目标保持 active，未 push。

## 计量单位与信任边界

`physical_receipt_v1` 为一次经过 admission 的 Models API 调用分配独立 `physicalId`。它不代表 SDK 内部的每次 HTTP 重试、鉴权请求或隐藏 fallback，也不等于供应商账单。原生归属在调用前绑定 workspace ledger、Run 或 operation、child invocation、模型、capture 摘要与固定的计价依据。

执行授权、调用 scope、未派发证明和 receipt delivery 使用进程内私有能力。提供商输出、导入 JSON 和复制的公开字段不能创建这些能力。scope 在进入提供商代码前清除。公开事件可用于 replay 验证，但不能授权对原生账本计费。

## 正常响应与迟到响应共用一条路径

1. Store 在有效执行授权下准备归属并记录 dispatch intent。准备完成不证明已调用提供商；进程在 intent 后退出时仍保留不确定性。
2. admission 包装器独立观察原始调用结果。逻辑取消可以立即返回，物理调用和容量保留直到原始结果结束。
3. 持久 source 保存一份最终物理观察。Host 将观察落盘与释放物理并发槽放在同一个 SQLite 事务中；standalone runtime 使用自己的 SQLite source。
4. Store 校验 source、归属和 native ledger 身份，幂等 claim 后原子更新 child Run、对应 Task 与 parent 用量。
5. source ACK 在 Store 提交后发生。正向超支立即计入 Host 债务；只有成功投影并 ACK 的完整观察才允许调低保守保留额度。

source 的最终观察不可改写；相同内容的重复投递幂等。尚无 receipt 的未知用量可以获得最终观察；已保存的 unknown 或 partial 观察不能事后换成另一份更有利的结果。零用量只由私有未进入提供商的证明建立；提供商的零值、报错或缺失字段不能证明免费或未调用。

## 用量与执行状态独立

新模式下，带归属的逻辑响应只提供展示与关联，不能再作为金额的备用来源。Run budget 从持久计量快照读取；正常响应、辅助调用和 child 汇总不能再次增加费用。

费用未完全确定时，`budgetCostUsd` 保持 `null`，`knownBudgetCostUsd` 仍累计已经确定的费用下界；新增待结算调用不能抹掉该下界。续跑预算读取不可变 predecessor 的加权 token 与计价下界，费用不复制到 successor 的当次用量，也不改写旧 continuation receipt。

迟到计量允许调整 usage、完整性与 accounting revision，不能改变执行 revision、Task revision、status、finishedAt、输出、checkpoint、candidate 或完成证明，也不会发布迟到文本或 tool call。child 完成和 checkpoint 同时要求逻辑 reservation 已结算；不能仅凭先到的物理 receipt 宣布完成。已完成或已续跑 child 的冲突进入待对账状态，保留 source receipt 与债务，不重写已封存证明。

终态 finish 在事务内读取当前计量证据，因此调用方携带的旧 usage 快照不会覆盖已经补记的用量。恢复投影使用 `initializeAccounting()`，不创建 AgentRuntime、不执行恢复任务、不重新调用模型。

source 或 ledger 身份冲突会阻止该目标的整批恢复。身份预检通过后，单项 receipt 与封存执行证据的冲突不妨碍同批有效项尝试投影；失败项仍保留待对账状态。

评审调用归属于独立的 evaluation Run；无 Run 的评审和 review 使用 operation 归属。原生评审若在 dispatch 或 receipt 持久化阶段失败，操作保持失败；后续费用重试不能发布评审结论。默认 Run compactor 使用同一调用路径，child compactor 仍由既有 session port 负责唯一逻辑结算。

## 验证与保留边界

[冻结回归](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/model-physical-usage-regression-2026-10-30.json) 为 78 文件／601 测试通过，覆盖本地 faux provider、真实 SQLite、loopback HTTP、SIGKILL、并发 replay、source／Store／ACK 故障窗口、主子取消、repair、compaction、evaluation、导入及续跑。Contracts／Runtime／Server 编译、Web／Harness／Benchmark 类型检查以及新增和其余修改测试的严格检查通过。4,004 个源码／配置文件、4,811 个 emitted 文件和 28 个用户文件摘要不变。测试计数不与各 owner 的重叠开发报告相加。

[证据索引](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/model-physical-usage-evidence-index-2026-10-30.json) 保留首次冻结验收 590／592 的失败：双 replayer 在 Store 初始化时读到不同 revision 的状态与事件统计，以及未声明免费 faux 模型导致 child 用量不完整。前者改为快照恢复、事件尾与损坏校验共享同步读取事务，确定性专项 9／9 通过；后者只给确切的合成 provider/id 添加免费声明，保留生产判定。复制未派发零值 DTO 绕过私有证明的独立反例、早期测试夹具错误和中途编译失败也保留。

旧 `agent-runtime.test.ts` 的完整严格检查仍有 48 个错误；在原始 `d2e33ac3` 上复现完全相同的错误码、消息及多重集，路径和行列归一化后新增／消失均为零。这不是通过的类型覆盖。原有事件顺序测试也在旧 HEAD 失败；当前分别验证精确的父生命周期与 child checkpoint／reservation／response／terminal 绑定，原隔离断言保留。

全局门禁仍未通过：架构有 8 项既有失败，根 API 为 1897／1896 及原有摘要不符；本片新增的 5 项生产必需 internal 组合接口使内部 API 为 21／16 且摘要不符，尚未满足内部接口门禁。意外根导出及仅供测试的 internal 导出已移除，没有隐藏接口或提高预算。历史 release manifest 失败保留；不将功能回归视为发布验收。

本片不证明真实模型质量、外部供应商账单准确性、SDK 隐藏重试计数、跨平台断电恢复或性能收益。没有外部付费模型请求。完整 child context compiler、coder 工作区恢复、并发父子预留额度以及 G01–G07 的其余未完成要求不由此文宣告完成。
