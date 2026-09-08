# 同一 Run 内的滚动上下文压缩

## 问题与边界

原有 `buildModelHistory()` 在 Run 启动时压缩 Thread 文本历史；主模型调用前还会
裁剪大工具结果、按 token 预算移除较旧的完整用户回合。然而 token governor
保护最近一条用户消息及其后的整个执行链。一次任务连续读取文件、收集资料和截图，
即使实际工作仍在推进，也可能使这一受保护部分超过模型窗口。

本次在主模型调用的最终上下文投影中增加 Run 内检查点。原始 Pi transcript、
Thread 账本和工具结果胶囊保持原样，检查点只替换模型看到的较旧执行步骤。
这项变更不会生成新的 Run、重新执行工具、清零预算或增加语义进展分数。

## 参考实现与采用的原则

以下资料于 2026-09-08 实际读取。源码链接固定到调查时的提交；参考的是设计原则，
本次没有复制第三方实现或新增 Harness 依赖。

| 来源 | 可核实的实现 | Napier 的采用方式 |
| --- | --- | --- |
| [Codex 配置说明](https://developers.openai.com/codex/config-reference/)；[compact.rs](https://github.com/openai/codex/blob/49a9d789997ab40d1d75b117644f796988d32e18/codex-rs/core/src/compact.rs) | 自动 token 阈值、回合内压缩、替换历史、用户消息保留、初始上下文重新注入 | 将压缩放在同一 Run 的模型请求边界；保留用户消息原文；系统提示仍由现有编译器生成 |
| [DeepSeek Harness 压缩入口](https://github.com/deepseek-ai/deepseek-harness/blob/c389f96bf3a9b6807cb71ed6bdad5849be0df6d8/packages/compaction/compaction-basic/src/index.ts)；[设计记录](https://github.com/deepseek-ai/deepseek-harness/blob/c389f96bf3a9b6807cb71ed6bdad5849be0df6d8/.agents/notes/implemented/architecture/2026-07-10-after-call-compaction-pressure-and-overflow-recovery.md) | 完整执行步骤之间测量压力；实际路由模型；先裁剪再测量；只有工作集发生有效缩减才允许溢出重试 | 复用最终服务模型与 token meter；复用工具结果裁剪；压缩前后计量；不缩小的摘要不提交 |
| [Oh-my-pi 压缩文档](https://github.com/can1357/oh-my-pi/blob/daf07999c2fee9b22edc7bf8fea1fb6272e0df5e/docs/compaction.md)；[压缩实现](https://github.com/can1357/oh-my-pi/blob/daf07999c2fee9b22edc7bf8fea1fb6272e0df5e/packages/agent/src/compaction/compaction.ts) | 回合内压缩、最近 token 窗口、禁止在 toolResult 中间切断、旧摘要与新增内容合并 | 保留最近完整工具批次；并行工具调用及全部结果构成不可拆分单元；按批增量总结 |

这些项目也提供原生 Responses 压缩、图像化归档、异步预计算等不同路径。
Napier 当前使用供应商无关的结构化摘要；上述专有协议与异步推测并未接入。

## 请求生命周期

```text
当前模型与工具集确定
  → 工具结果确定性裁剪
  → 验证并复用当前 Run 的检查点
  → 按最终编译提示、工具定义、图片、输出/推理/安全预留计量
  → 压力达到阈值：选择完整步骤边界，分批生成增量摘要
  → 每批确认来源、用户消息不变和 token 缩减，持久化检查点
  → 写入工作集投影凭证
  → 现有 token governor 最终检查
  → 原 Run 的下一次模型调用
```

默认阈值：扣除输出、推理和安全预留后的可用输入预算达到 80% 时触发，目标降至
60%。近期执行内容按可用输入预算的 20% 保留，范围为 512–8,192 tokens，至少
保留最新一个完整执行单元。所有用户消息（包括后续修正、图片）保留原文；该规则
不会让一个 Run 的用户要求仅靠模型摘要存活。检查点投影后的最终 token governor
也不能再删除这些用户消息；若保留部分本身超限，返回明确的不可用凭证。

边界解析器被压缩器和原有 token governor 共用。并行批次的结果可以乱序返回，
但每个调用必须恰好匹配一个结果；孤立结果、未结束调用和重复调用 ID 会被拒绝。

## 摘要与证据

摘要仍采用 `summary / decisions / openLoops / artifacts` 结构。辅助调用不带工具，
使用当前服务模型，温度为 0，输出上限为模型许可范围内最多 1,200 tokens。
继承当前路由的认证、端点头、环境与传输限制，隔离主调用的 payload/response
回调和会话缓存身份，避免凭证池、网关配置或主请求状态串用。

压缩输入由前一摘要及新增完整步骤构成。工具正文只提供有长度和哈希说明的有限
摘录；图片替换为 MIME、大小和哈希，私有 reasoning 不进入总结输入。辅助请求也
通过同一个 token meter 检查，最多 60,000 序列化字符，并预留 15% 窗口余量。
超大来源按完整步骤分批；每批必须推进源边界并至少减少 128 个估算输入 tokens。
因此循环受有限来源和原 Run 预算共同约束，不会因总结生成了新文字而无限续期。

新增事件：

- `context.run_compaction.completed`：Run 身份、完整源前缀的消息数和哈希、保留用户
  消息哈希、父检查点哈希、结构化摘要及其哈希、辅助模型请求与响应绑定。
- `context.run_compaction.failed`：失败源前缀和诊断哈希。同一失败前缀不会在后续
  请求中反复消耗模型调用。
- `context.run_compaction.projected`：检查点身份、本次投影前后的消息数、哈希、
  token 估算以及用户消息集合哈希。

现有 `context.projected` 增加可选的 `runCompactionReceiptSha256`，严格绑定上述
阶段，再绑定 token pressure 和实际请求 envelope。历史凭证仍按原字段解释。
辅助 `model.response` 同时记录解析后摘要的哈希，防止检查点引用有效模型响应却
替换摘要。回放校验拒绝缺失的投影引用、父检查点或响应绑定。

导入会话会重建 Run ID，因此按事件顺序重新绑定检查点、父链与投影凭证的派生
哈希。原始消息摘要、模型输出和结构化摘要内容保持不变，包括恰好等于旧 Run/
Thread ID 的摘要字段。导入后的事件也能再次导出并通过完整回放校验。

## 恢复与失败处理

控制器重建时从账本读取检查点，验证摘要、模型响应绑定、父链和当前源消息前缀，
再复用其投影。SQLite 重开后也采用这条路径。源内容改变、Run 身份不符或检查点
损坏时不复用它。另一个恢复 Run 仍使用既有历史重建流程，不盲用旧 Run 的检查点。

供应商在尚未输出内容时报告 context overflow，会触发现有的一次恢复机会。
这时忽略普通压力阈值，尽量折叠旧的已完成步骤，只保留最近完整单元及用户原文。
只有新请求实际小于失败请求，才能由压缩满足重试的缩减条件；取消与原预算优先。

摘要请求失败、结构不完整或没有缩减时保留上一有效工作集；超大单个不可拆分
单元、用户输入或系统/工具定义本身超过窗口时，仍由最终 governor 明确失败。
原始证据可重读，但本次没有实现图片内容的无损摘要、语义无损保证，或自动升级
至更大窗口模型。压缩费用与耗时计入原 Run，不计为主模型业务回合或产品进展。
本次控制的是模型工作集；Pi 进程内的原始 transcript 尚未改造成磁盘分页存储。

## 验证范围

回归覆盖：连续工具读取后的编辑和验证、同一用户回合内的供应商溢出恢复、用户
修正原文保留、并行工具批次、旧图片退出活跃上下文、SQLite 重开与增量复用、
分批处理超大来源、拒绝不缩小的摘要、重复失败抑制、预算耗尽、取消与凭证篡改。
还覆盖已有检查点后的再次溢出、截断/非法摘要保留上一检查点、忽略 AbortSignal
的供应商不会阻塞取消、路由凭证继承、最终 governor 保留用户原文，以及导入再导出。
测试使用确定性模型及真实本地文件/SQLite，不调用付费远程模型。

2026-09-08 本地验证结果：

| 检查 | 结果 |
| --- | --- |
| Runtime 全量测试 | 2,471 通过，32 跳过，2 个既有失败；新增 15 项全部通过 |
| Contracts 全量测试 | 131 通过 |
| 回放绑定与会话导入回归 | 21 通过 |
| Runtime 编译；SDK、CLI、Benchmark Kit、Harness Eval、Server、Web 类型检查 | 通过 |
| 依赖归属、变更文件格式、Git diff 空白检查 | 通过 |
| 架构审计 | 11 个既有问题，新增 0 |
| 公共 API 审计 | 2 个既有问题，新增 0；根导出计数保持 1,897 |

两项既有测试失败为 `agent-capability-contract-v2.test.ts` 的固定能力向量，及
`agent-capability-contract.test.ts` 的生产 Skill 就绪状态。在此前中断问题调查中，
已用变更前的隔离源码复现本机 Skill 目录歧义；本次未更改这些测试或审计基线。
