# Harness 优化工程交付

2026-09-21 工程复查见[审查记录](investigations/2026-09-21-code-review.md)，包含
新增修复及当前验证限制。下文的“本次审查”指 9 月 15 日历史收尾。

更新：2026-09-15。已按用户最新要求停止后续模型测试、审查代码并收尾。七项实现保留，实验组合 `napier.current-integrated.v6` 仍需显式启用，未推广为默认策略。完整统计未完成，已知真实失败如实保留。

## 模块与行为

| 方向 | 当前实现 | 入口 |
| --- | --- | --- |
| 编辑适配 | 读取生成版本绑定的行引用；统一 diff 转成原子编辑；偏好按模型、任务、产物和有效校准证据匹配 | [快照编辑](../packages/runtime/src/workspace-edit-snapshots.ts)、[格式校准](../packages/runtime/src/edit-format-calibration.ts) |
| 执行工具链 | Node/Python 执行与验证；绑定工作区版本；依赖不明确时执行完整测试；保留沙箱和取消约束 | [工具链](../packages/runtime/src/toolchain-provider.ts)、[测试选择](../packages/runtime/src/affected-test-selection.ts) |
| 提示与缓存 | 分离稳定内容和动态上下文；记录实际模型输入及可复用前缀；工具或模型变化使缓存证据失效 | [实际输入](../packages/runtime/src/agent-invocation-context.ts)、[前缀证据](../packages/runtime/src/prompt-cache-projection.ts) |
| 任务工作状态 | 从事件恢复需求、文件变化、失败和验证状态；压缩后保留状态，文件变化后旧验证失效 | [工作状态](../packages/runtime/src/task-working-state.ts) |
| 任务记忆 | 权限过滤、任务查询、来源版本检查和相同事实分组；保留跨轮次与分支来源 | [选择](../packages/runtime/src/task-memory-selection.ts)、[分组](../packages/runtime/src/task-memory-grouping.ts) |
| Harness 策略 | 配置版本与哈希绑定；显式启用；恢复继承原配置；不扩大工具权限 | [策略配置](../packages/runtime/src/harness-policy-profile.ts)、[Run 绑定](../packages/runtime/src/harness-run-policy.ts) |
| 失败与评估 | 保留原始失败和用量证据；低频费用准入；追加测试前检查剩余队列能否达到既定验收门槛 | [质量评估](../scripts/harness-campaign-evidence.mjs)、[收敛检查](../scripts/harness-campaign-convergence.mjs) |

当前组合另有分阶段验证协议：知道相关源码与已有测试命令后，先执行修改前验证，再逐步补充规范驱动的检查，避免在首次执行前推演整个修复过程。见 [协议](../packages/runtime/src/contract-verification-protocol.ts)。

v6 增加[模型调用预算](../packages/runtime/src/harness-model-call-budget.ts)：在编译和捕获之前固定有效推理等级及 8192 token 上限，保留更低上限，拒绝 finalize 扩展放大预算。同时，[供应商字段兼容](../packages/runtime/src/model-provider-wire-compatibility.ts)将 DeepSeek 官方接口的 token 上限正确序列化为 `max_tokens`；这一兼容修复覆盖默认及辅助调用。旧显式配置哈希不变，8192 策略仅由 v6 启用。

## 启用入口

在仓库根目录，为单次 Run 显式加载实验配置：

```sh
node apps/cli/dist/index.js run \
  --workspace /path/to/project \
  --model deepseek/deepseek-flash \
  --harness-profile-file benchmarks/harness-profiles/current-integrated.v6.json \
  --prompt '<具体任务>'
```

此使用示例会调用模型。CLI 的 v6 配置送达、哈希绑定与只读权限边界已有离线执行验证。HTTP/Web 支持预设选择，其入口不等同于任意 v6 配置文件加载。

## 本次审查与验证

重点审查策略与权限、恢复配置哈希、编辑版本前提、测试选择及工作区新鲜度、任务记忆来源、实际输入与缓存指标、DeepSeek 字段兼容及模型调用预算，共 17 个关键集成文件。未发现新的阻断性代码问题；不声称逐行审查全部历史工件。

Contracts、Runtime、CLI、Server、Web 五个包的类型检查均通过，`git diff --check` 通过。本次审查零模型调用；此前 48 项 v6 定向离线检查及其他模块证据见[验证索引](artifacts/bounded-thinking-test-report-index-2026-09-15.json)。不重复运行这些已完成的模型测试。

刚新增的完整统计收集模块和对应测试已移出交付，原文件及哈希本地归档。产品实现未改版，旧失败和用量记录未修改。没有 commit、push 或部署。

## 已知限制

- v6 有 11 组有效配对及 1 个未配对候选失败。异步队列候选错误接受非法取消信号，独立评分失败；自编测试通过不能保证完整契约覆盖。见[失败证据](artifacts/bounded-queue-contract-failure-2026-09-15.json)。
- 用户叫停时的基线进程已取消，没有终态报告，不计为已完成观察。30 题 × 3 组统计未完成，不声称整体无回退、普遍降本提速或默认推广通过。
- 任务记忆仍可能包含无关历史事实；可复用提示前缀不是供应商缓存命中证明；实验编辑格式不保证模型每次都正确采用。
- 既有六项架构超限和发布源码清单漂移未在本次收尾中处理；类型检查通过不等同于完整发布构建通过。

最终本地保守预算占用 71.94 元，包含历史 20 元、已结算 21.94 元与未结算预留 30 元，不是官网实际扣款。所有付费队列已停止，不自动恢复。

[审查与停止收尾记录](artifacts/harness-rapid-closeout-2026-09-15.json) · [当前状态](harness-optimization-status.md) · [历史实施记录](harness-optimization-implementation.md)
