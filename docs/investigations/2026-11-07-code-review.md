# Napier 深度审查与优化（2026-11-07）

本轮从 `main@42a35898` 的实际工作区出发：开始时已有 49 个已跟踪文件改动、32 个未跟踪条目，本地分支相对本地 `origin/main` 引用领先 81 个提交。未 fetch，因此这不是远端实时同步结果。保留既有改动，未提交或推送。

## 项目现状

Napier 已有相当完整的本地 Agent 执行、SQLite 账本、恢复、工作流、子代理及工作台能力；本轮直接访问后端 8788 和 Vite 5173 的健康接口均成功，账本 quick check 为 `ok`。Chrome 中现有长对话和任务概览可正常显示。

当前主要问题是可靠性边界与验证维护：请求重试身份、流断开后的资源寿命、慢请求下的并发行为，以及旧测试/发布证据与现源码的漂移。源码规模与公共 API 约束仍有未解决超限。不能用开发页面可打开或 TypeScript 可编译代表全项目发布验收。

## 已落实的修复

| 优先级 | 触发条件与原问题 | 当前行为与验证 |
| --- | --- | --- |
| P1 | 同一 `requestId` 在 Run 执行中重试报 busy；完成后换 payload 却静默复用旧 Run | 同 store 的 runtime 合并在途请求，Thread 隔离，请求指纹落入 `run.started`，冲突 payload 明确拒绝。真实 HTTP 测试确认只创建一个 Run，重试收到校验一致的 `snapshot → done` |
| P1 | 新增子代理持久完成记录包含私有 candidate/preview ID，Thread 公共快照原样传出 | 在公开快照与 HTTP 投影边界剥离内部 completion reservation，保留内部账本及恢复所需记录；原有 hash-only 隐私断言继续生效 |
| P2 | 浏览器关闭预览/任务 SSE 只取消 response body，未必触发 Request.signal | 将 Hono response abort 转为订阅取消，停止截图和等待，释放名额；不取消所观察的后台任务 |
| P2 | observer 源流仍在异步 cancel，工作区 pin 已提前释放 | 取消完成或失败后才释放 pin；POST 执行流断连后的排空语义保留 |
| P2 | SSE 解析、校验、限额异常或消费方提前退出留下 locked reader | 非正常结束取消 body，所有出口释放 reader；响应头拒绝也取消 body；清理异常不覆盖原错误 |
| P2 | 固定 2 秒轮询在慢网络下重叠，单通道失败阻断全部更新 | 各通道独立轮询，上次请求结束后再等待；卸载/停用时 abort，忽略晚到结果。模拟 12 秒慢请求由 6 次降至 1 次 |
| P2 | CLI 为每个碎片复制所有已收字节，长行处理呈平方增长 | 缓冲区按容量增长，仍严格限制每行字节数、验证 UTF-8、正确处理 CRLF/尾行；2000 组随机差分与原实现一致 |
| P2 | 失败/中断 Thread detail 为恢复检查点和 orchestration 各扫描一次事件 | 共享一次 orchestration 投影，派生 checkpoint，输出保持一致 |
| P2 | 根目录验收脚本依赖碰巧提升到根目录的 Hono 包 | 显式声明同版本开发依赖，仅根 package 与 lock 各增加两行；依赖归属和锁文件检查通过 |
| P2 | 本地预算不可用被宽泛的模型错误匹配误报成供应商模型下架 | 先区分价格未知、待核对用量和预算不足，返回固定公开文案；实际 HTTP 对照证明未声明价格仍在调用前拒绝，明确免费后才调用 |

核心入口：

- [Prompt admission](../../packages/runtime/src/prompt-request-admission.ts)、[真实 HTTP 回归](../../apps/server/test/thread-prompt-admission-http.test.ts)
- [浏览器流取消](../../apps/server/src/browser-live-view-http.ts)、[工作区生命周期](../../apps/server/src/workspace-runtime-http.ts)
- [SSE reader](../../apps/web/src/sse-json.ts)、[通道轮询](../../apps/web/src/use-active-channel-delivery-polling.ts)
- [RPC framing](../../apps/cli/src/rpc-transport.ts)、[Thread detail](../../packages/runtime/src/thread-detail.ts)

## 实测性能与适用范围

以下仅是本机 Node 24.19.0 / macOS arm64 的局部微基准，没有测量模型质量、付费调用或端到端任务耗时。

| 测量 | 优化前中位数 | 优化后中位数 | 方法 |
| --- | ---: | ---: | --- |
| RPC：1 MiB 行，64 B 碎片 | 303.871 ms | 4.510 ms | 原 HEAD 与现实现，各 2 次预热、10 次交替采样 |
| RPC：1 MiB 行，1 KiB 碎片 | 18.751 ms | 0.660 ms | 同上 |
| RPC：1 MiB 行，16 KiB 碎片 | 1.379 ms | 0.120 ms | 同上 |
| RPC：单个 1 MiB 块 | 0.068 ms | 0.061 ms | 同上；单块原本没有反复复制 |
| 恢复检查点＋orchestration，1000 事件 | 2.639 ms | 1.300 ms | 5 次预热、30 对交替样本，结果相同 |

完整样本见 [RPC 数据](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/investigations/2026-11-07-review/rpc-benchmark.json)、[恢复投影数据](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/investigations/2026-11-07-review/recovery-projection-benchmark.json)。RPC 每个活跃连接最多保留已增长的缓冲容量（默认上限 1 MiB），以换取碎片处理的线性复制开销。

两项微基准的脚本、完整样本和运行命令见[原始审查记录](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/investigations/2026-11-07-code-review.md)。

## 验证记录

- Web 全量：**293 文件 / 1413 测试通过**；`npm run build -w @napier/web` 通过。
- Server 最终全量：**132 文件 / 520 测试通过**。包括真实 HTTP、跨进程工作区恢复、子代理合并和私有数据过滤回归。
- Runtime admission/恢复/取消、RPC 及真实 HTTP 重试组合：**11 文件 / 91 测试通过**。
- 预算错误分类与预算准入：**2 文件 / 29 测试通过**，未知费用模型拒绝时 providerCalls 为 0，显式免费声明后完成且 providerCalls 为 2。
- 子代理隐私边界定向：**5 文件 / 12 测试通过**；公开快照 hash/bytes 根据脱敏后内容计算，内部恢复记录不变。
- 全部 8 个工作区直接 `tsc --noEmit` 通过。
- `check:package-lock`、`check:dependency-ownership`、`check:desktop-scope`、`check:web-design` 通过。
- 最终后端 8788 与代理 5173 的 `/api/health`、`/api/bootstrap` 四条请求均返回 HTTP 200，账本 quick check 为 `ok`。
- Web 首轮正确工作区运行发现 8 文件 / 26 测试失败；修复 Preact 测试接口、图标 mock、当前完整性文案、恢复检查点、requestId、API 边界和布局绑定的过时测试。保留哈希、尺寸、过期返回、权限和失败路径断言。
- Server 首轮 49 项失败中的主要共因是 faux 模型未显式声明零费用。新增仅供测试使用的服务夹具，对已注册的 `faux:*` 且四项价格全为零的模型明确声明免费；真实模型、调用方自带预算策略、生产服务默认值不变。夹具自身回归覆盖这些拒绝边界。
- 默认 `npm run typecheck` 在 Runtime 发布源码 manifest 校验提前失败，尚未进入所有类型检查。直接编译通过与发布 gate 失败分别记录；没有重写 manifest 或抬高预算使检查变绿。
- 架构审计仍有 **14 项**超限；公共 API 审计仍有 **4 项**符号数量/摘要不一致。请求入口拆分使 `agent-runtime` 单函数复杂度由 47 降为 45，仍高于原预算 43；这不是架构整体通过。
- 浏览器核验仅覆盖现有桌面工作台显示与任务视图切换；未重新完成全压力尺寸、真实浏览器执行后端或付费模型验收。

原始运行日志与复现实验脚本保存在本机 `/tmp/napier-review-20261107/`；该目录是临时证据，不是随仓库分发的测试依赖。

全量测试的复跑命令：

```sh
npm run test -w @napier/web -- --maxWorkers=2 --testTimeout=30000
npm run test -w @napier/server -- --maxWorkers=2
```

需在各 workspace 的测试配置中执行；从根目录以宽泛路径运行 Vitest 会漏掉 Web 的 Preact aliases，并可能匹配 `docs/artifacts` 内的历史冻结测试，不能据此判定当前 suite 结果。

## 保留问题与建议顺序

| 优先级 | 尚未完成 | 关闭标准 |
| --- | --- | --- |
| P1 | Prompt Run 创建与 `run.started` 事件之间仍有进程崩溃空窗；合并范围是共享 store 对象 | **部分关闭**：`createLeasedRun` 同事务写入 `run.prompt.admitted`；重开 store 后同 `requestId` 复用 admitted Run。跨进程并发故障注入仍可加强 |
| P1 | Web 失败后手动重新提交会生成新 UUID | **关闭（同会话 + sessionStorage）**：失败未 accepted 前保留 `requestId`，指纹含 model/capability/harness；跨标签刷新复用 session draft；“先查询再重试”的显式 GET 仍可加强 |
| P1 | 发布源码证据、公共 API 与现实现不一致 | 明确预期发布源码和公共符号变更后，走实际验收流程；不以更新摘要替代验收 |
| P2 | 巨型模块、复杂度和依赖耦合超限 | 优先拆分 `use-workspace-view-model.ts` 和 `agent-runtime.ts` 的职责边界，保持行为回归，按原预算重新检查 |
| P2 | 全量运行时、外部主机和实时模型质量未重验 | 单独运行对应 suite/场景，记录源码、模型、环境与效果；本轮局部加速不推广为总体任务质量提升 |

重试的额外边界：重复请求等待首次执行结束后取得快照，不实时转发首次订阅的增量事件；旧事件没有可验证指纹时明确拒绝。上述优化不提供跨进程或外部副作用的 exactly-once 保证。
