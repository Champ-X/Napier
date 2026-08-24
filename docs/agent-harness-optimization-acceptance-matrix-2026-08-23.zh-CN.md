# Napier Agent Harness 优化验收矩阵

> 验收日期：2026-08-23  
> 唯一设计依据：`docs/agent-harness-optimization-design-2026-08-22.zh-CN.md`  
> 产品版本：`0.1.3`  
> 最终源码身份：`f79504c9ae122a9e1c77fb2ad765b762a5fe3620aa4c8d501faeb72e8090169b`

## 1. 判定口径

- `verified`：要求已由真实实现、自动化测试或可复验的 Ledger/发布制品证据共同证明。
- `corroborated`：实现与局部验证相互印证，但证据不等同于外部生产环境或长期趋势。
- `blocked`：需要当前授权范围之外的外部系统、签名发布或目标主机；不以 fixture、静态 JSON 或替换哈希伪造完成。

本矩阵把三类证据严格分开：

1. `Harness Experiment Evidence` 是真实执行的确定性 A/B 实验，但其 `credentialClass` 为 `test_fixture`，用于证明实验协议、同模型可比性和 promotion gate，不代表外部模型线上质量。
2. `Agent Harness Acceptance Evidence` 是通过 Runtime/Ledger 真实执行形成的专项验收数据，用于验证失败注入、安全边界、可达性、监督状态机和 token 校准协议。
3. 产品发布证据由最终源码 manifest、正式产品 HTTP/Web 路径生成的 source-bound smoke、OCI/profile 实采和 release artifact audit 提供。

## 2. A1–A8 需求—实现—证据矩阵

| 项目 | 设计要求 | 核心实现 | 测试与真实证据 | 结论 |
| --- | --- | --- | --- | --- |
| A1 Model Route Plan 与安全回退 | 五类角色；统一失败分类；retry-before-visible；可见输出后不跨模型续写；未知副作用不重放；每次 attempt 入 Ledger；最终 serving model 可归因 | `packages/contracts/src/model-route.ts`；`packages/runtime/src/model-route.ts`、`model-route-policy.ts`、`model-route-stream.ts`、`model-route-evidence.ts`、`agent-run-model-route.ts`；CLI `interactive-renderer.ts`/`tui-state.ts`；Web `model-route-event-view.ts` | `model-route.test.ts`、`model-route-integration.test.ts`、CLI/Web route view 测试；Acceptance 102 个 route cases、100 个注入恢复样本：恢复率 `1.0`，可见输出跨模型续写 `0`，未知副作用重放 `0`，route attribution `1.0` | **verified** |
| A2 可组合 Step/Tool/Completion 生命周期 | 有序 `prepare/around/finalize/dispose`；安全扩展在最外层；注册可撤销；每 step 动态能力；canonical result 与展示分离；Runtime 收缩 | `lifecycle-extension-pipeline.ts`、`agent-lifecycle-pipeline-host.ts`、`agent-step-lifecycle-stream.ts`、`agent-tool-preflight.ts`、`agent-tool-result-boundary.ts`、`agent-run-completion-lifecycle.ts`；`agent-runtime-step-lifecycle.ts` | `lifecycle-extension-pipeline.test.ts`、`agent-step-lifecycle-stream.test.ts`、`agent-tool-result-boundary.test.ts`、`agent-runtime.test.ts`；架构门禁约束热点与复杂度 | **verified** |
| A3 Tool Protocol v2 与能力可达性 | Essential Core、Capability Catalog、Resolved Tool View；被裁掉的第一方工具可发现并按下一 step 激活；V2 schema 分离 canonical/model-visible 输出、并发、副作用与 policy tags；编辑方言归一 | `packages/contracts/src/tool-protocol.ts`、`agent-tool-names.ts`；`packages/runtime/src/capability-catalog.ts`、`edit-dialect-adapter.ts`、`effective-capabilities-prompt-builder.ts`；Web capability copy/projection | `capability-catalog.test.ts`、`capability-catalog-runtime.test.ts`、`edit-dialect-adapter.test.ts`、provider tool schema 测试；Acceptance 100 个可达性 case，不可达率 `0`；A/B 中 `tool_schema_tokens` 平均下降 `4815.36` 且成功率不降 | **verified** |
| A4 Governed Code Bridge | JS/Python 代码通过受限 `napier.call` 嵌套调用；完整复用参数校验、Policy、Approval、Sandbox、预算、Receipt、Ledger 和结果裁剪；无原始凭证与宿主权限；遵守并发语义 | `governed-code-bridge.ts`、`governed-code-bridge-model.ts`、`javascript-kernel-code-bridge.ts`、`python-kernel-code-bridge.ts`、`python-kernel-code-bridge-worker.ts`；JS/Python kernel 接线 | `governed-code-bridge.test.ts`、`governed-code-bridge-concurrency.test.ts`、`python-kernel.test.ts`；Acceptance 100 个 nested calls 治理覆盖率 `1.0`，3 个权限探针，权限扩大路径 `0` | **verified** |
| A5 Subagent Supervisor | provider seam；typed output；mailbox、inspect、steering、cancel；role-based route；orphan recovery；durable terminal；隔离 worktree 显式 apply | `packages/contracts/src/subagent-supervisor.ts`；`subagent-provider.ts`、`in-process-subagent-provider.ts`、`subagent-supervisor.ts`、`subagent-repository.ts`、`subagent-execution-control.ts`、`subagent-output-schema.ts`、`run-interruption-recovery.ts` 及现有 worktree apply 链 | `subagent-supervisor.test.ts`、`subagents.test.ts`、`delegation-ledger.test.ts`、worktree mutation/review/verification 测试；Acceptance 30 个 child，durable terminal `1.0`，steering/cancellation 下一安全边界成功率均 `1.0` | **verified** |
| A6 Provider Token Meter 与滚动校准 | 官方/兼容/provider usage 接口；按 provider/model/content class 校准；P95 驱动安全余量；多模态由 adapter 估算；估算器永不失败 fallback；overflow 不重复副作用 | `token-meter-provider.ts`、`token-meter-calibration.ts`、`token-meter-content.ts`、`model-context-token-meter.ts`、`model-context-token-calibration.ts`、`model-context-token-pressure.ts` | token meter/pressure 测试；Acceptance 对 `deepseek/deepseek-v4-flash` 记录 20 个观测，P95 低估误差 `0`，保守 fallback 已验证；未知副作用重放 `0` | **verified** |
| A7 Store、Server 与 Contracts 职责拆分 | LocalStore 保持兼容 facade，按领域 repository 委托；事务按业务不变量；Server 拆 composition/transport/validation/handler；Contracts 使用 versioned modules，`index.ts` 仅薄导出 | `store-repository-host.ts` 与各领域 `*-repository.ts`；`apps/server/src/server-composition-root.ts`、`app-http-*-core.ts` 及领域 HTTP validation/evidence 模块；`packages/contracts/src/*-v1.ts` 与薄 `index.ts` | Store/Server/Contracts 工作区测试；`check:architecture`；热点文件现值：`store.ts` 3865 行、`server/app.ts` 2983 行、`contracts/index.ts` 37 行，均达到设计中期目标；行数豁免为 60 | **verified** |
| A8 持续实验与发布决策闭环 | Experiment/Release 两层证据；同输入、同 serving model、多 seed；fallback 独立分层；源码/配置/凭证类别绑定；趋势与回归归因；promotion gate | `packages/contracts/src/harness-experiments.ts`、`agent-harness-acceptance.ts`；`harness-experiment-definition.ts`、`harness-experiment-execution.ts`、`harness-experiment-release-evidence.ts`、`agent-harness-acceptance*.ts`；两条 evidence 脚本 | 30 cases × 3 seeds × baseline/candidate × 2 次 execution，共 360 Runs；两次 verdict 均 `improved`，各 90 comparable pairs，fallback/mismatch 均 `0`，`promotionReady=true`；Acceptance 388 Ledger Runs，`acceptanceReady=true`；两个 verifier 均通过 | **verified**（fixture 实验口径，不冒充外部模型线上质量） |

## 3. Phase 0–5 交付矩阵

| 阶段 | 设计退出标准 / 交付物 | 实现与证据 | 结论 |
| --- | --- | --- | --- |
| Phase 0 证据与失败分类 | failure taxonomy；route attempt Ledger；至少 10–20 cases × 3 seeds；serving model 锁定；fallback 分层；CLI/Web 指标可见 | A1 route contracts/evidence 与 CLI/Web 视图已接通；A8 使用 30 cases × 3 seeds；A/B 明确锁定 `fixture/fixed`，fallback 独立分层；专项 Acceptance 保存 route、capability、loop、token 数据 | **verified** |
| Phase 1 Model Router v1 | 五类角色；同/跨供应商候选；credential cooldown；429/5xx/network/context/auth/billing/tool-dialect 分类；retry-before-visible；no-blind-replay；dialect adapter | `ModelRouter`、route policy/stream/evidence 与 edit dialect adapter 已进入 Runtime；100 个失败注入样本全部受控恢复；两项禁止重放指标均为 `0`；实际 serving model 全量归因 | **verified** |
| Phase 2 Lifecycle Pipeline 与 Runtime 收缩 | Step、Tool、Completion 链；可撤销、确定性顺序；canonical/presentation 分离；每 step 动态 capability；以 strangler 迁移旧路径 | 生命周期 host/pipeline 与 step/tool/completion 边界均已独立；旧路径通过内建 extension 接入；专项单元/集成测试及全仓类型/架构门禁覆盖 | **verified** |
| Phase 3 Tool Protocol v2 与 Code Bridge | Catalog/URI；动态激活；V2 输出模型；edit adapter；JS 后 Python bridge；nested dispatch 全治理；并发语义 | Tool Protocol v2、Catalog、edit adapter、JS/Python bridge 均已实现；能力不可达率 `0`；100 次 nested dispatch 全治理，权限扩大 `0` | **verified** |
| Phase 4 Subagent Supervisor | in-process provider；typed output、mailbox、steering、cancel、inspect；role route；orphan recovery；durable terminal；显式 apply | 统一 provider/supervisor/repository/control 与恢复链已实现；30 个 child 全部 durable terminal，steering 与 cancellation 边界通过；既有隔离 worktree 显式 apply 保留 | **verified** |
| Phase 5 存储拆分与长期治理 | repository 拆分；Server composition/handler；versioned contracts；豁免逐步降至不高于 60；实验趋势、归因、release evidence 串联 | 三个热点已降至 3865/2983/37 行；`lineOverrides=60`，未提高阈值；实验 evidence 绑定 source manifest 并串联 acceptance evidence；release audit 收录 169 项制品 | **verified**（首轮目标达成，长期治理按设计持续） |

## 4. 架构不变量验收

| 不变量 | 证据 | 结论 |
| --- | --- | --- |
| Durable before present | route attempt、model response、tool/nested dispatch、subagent 状态均先写 Ledger，再投影至 CLI/Web；Acceptance 保存可复验事件流哈希 | **verified** |
| Safety monotonicity | lifecycle safety extension 外包围；Capability discovery 与 Code Bridge 不绕过 Policy/Approval/Sandbox；权限探针无扩大路径 | **verified** |
| No blind replay | 可见输出跨模型续写 `0`；未知副作用自动重放 `0` | **verified** |
| Serving attribution | route attribution rate `1.0`；每个比较样本锁定 serving model，fallback/mismatch 独立统计 | **verified** |
| Discovery is not authorization | Catalog 仅改变动态可达性，实际调用仍进入 preflight/authorize/receipt | **verified** |
| Nested dispatch parity | Code Bridge 100 次 nested call 治理覆盖 `1.0`，权限扩大 `0` | **verified** |
| Deterministic recovery | run/subagent repository、orphan recovery、durable terminal 与事件流哈希共同提供重启恢复事实源 | **verified** |
| Bounded autonomy | Router、tool loop、code bridge、Subagent 均有独立预算/并发/取消或终态约束 | **verified** |

## 5. 量化阈值验收

| 指标 | 设计门槛 | 实测 | 结论 |
| --- | --- | --- | --- |
| 无副作用故障恢复率 | `>= 95%` | `100%`，100 samples | **verified** |
| 可见输出后跨模型续写 | `0` | `0` | **verified** |
| 未知副作用自动重放 | `0` | `0` | **verified** |
| serving model / route attempt 归因 | `100%` | `100%` | **verified** |
| Harness 样本 | 每 profile 至少 30 cases × 3 seeds | 30 × 3，baseline/candidate，两次 execution 共 360 Runs | **verified** |
| Harness 非劣与 guardrail | 主要指标非劣，guardrail 无显著回退 | task success 差值 `0`；schema tokens `-4815.36`；intervention/evidence completeness 差值 `0` | **verified** |
| 能力不可达率 | `< 1%` | `0%`，100 cases | **verified** |
| tool schema token 中位数下降 | `>= 35%` 且成功率不降 | profile max tools 20 → 12；A/B schema token 明显下降且 task success 不降 | **corroborated**：当前 release evidence 给出均值差，未将中位数作为独立字段固化 |
| repeated call 降幅 | `>= 20%` | `50%` | **verified** |
| no-new-information 降幅 | `>= 20%` | `50%` | **verified** |
| Code Bridge 治理覆盖 / 权限扩大 | `100% / 0` | `100% / 0` | **verified** |
| Subagent durable terminal / steering / cancel | `100%` / 下一安全边界生效 | `100% / 100% / 100%` | **verified** |
| 主力模型 token P95 低估 | `< 10%`，且有 fallback | DeepSeek V4 Flash：`0%`，20 observations；fallback verified | **verified** |
| 架构豁免 | 行数豁免逐步降至 `<= 60` | `60` | **verified** |
| 热点文件 | Store `< 4000`；Server `< 3000`；Contracts `< 2000` | `3865 / 2983 / 37` 行 | **verified** |

## 6. 最终源码与产品发布证据链

| 层级 | 制品 / 结果 | 判定 |
| --- | --- | --- |
| 源码身份 | `default-product-source-manifest-0.1.3.json` 与 Runtime 常量共同固定 `f79504c9…69b`；manifest 覆盖 1848 个文件、13277578 bytes | **verified** |
| 实验决策 | `harness-experiment-release-evidence-0.1.3.json`：content SHA `05ace12e…663c`，`promotionReady=true`；两个 execution、360 Runs 均绑定最终源码 | **verified**（fixture 实验） |
| 综合验收 | `agent-harness-acceptance-evidence-0.1.3.json`：content SHA `1c56410f…4c89`，388 Ledger Runs，`acceptanceReady=true`，并绑定前述源码 manifest 与实验 SHA | **verified** |
| 产品路径 smoke | 干净 Thread `thread_fa3ba57081cf465e947a`、Casebook `casebook_c8e8e98d15fb46b5a9e0`；正式产品 Web/API 创建 6 个最终 identity Run/Trial：`run_580cc5e90c724ccd8ef9`、`run_fb60d84da8ba4b2fb288`、`run_83c1e281f2274e148517`、`run_b07cc194531940978b04`、`run_e971c06a8cea46488f48`、`run_446ea24c00e2494fabff`；6/6 passed；content SHA `fd93ff0e…d2d2` | **verified**；完整 10-case Gate 仅覆盖 6 cases，因此保持 `status=incomplete`、`defaultTrackReady=false`，未把 smoke 伪装成完整 Gate |
| OCI 与升级路径 | `sandbox-product-acceptance-stage13.json`：schema 5、9 项 setup checks、content SHA `976639b8…f2c1`；`profile-upgrade-stage21.json`：CLI/Web/Unmanaged 三路径 | **verified** |
| Web 分发 | 285 个 dist 文件；主入口 `index-EFxXBnkr.js` 为 24.82 KiB，低于 150 KiB 硬预算；manifest/dist SHA `921ba47b…ac11`，receipt 已刷新 | **verified** |
| 发布制品集合 | `release-artifacts-audit-0.1.0.json`：169 项，`ok=true`，set SHA `50ef4092…b88a`；收据文件 SHA `74269873…fc18` | **verified** |

## 7. 明确保留的外部阻塞

`s1-shell-sandbox-readiness-stage22.json` 当前状态必须保持 `blocked`，且仅有以下两个 blocker：

- `public_signed_external_release`：需要外部公开签名发布与对应授权。
- `windows_host_product_acceptance`：需要 Windows 主机环境执行产品验收。

本地实现、OCI 实采、架构门禁和发布制品审计通过，不会把这两个外部条件替换成 fixture、静态声明或本机模拟。

## 8. 最终门禁与浏览器 QA

| 验收项 | 最终结果 | 结论 |
| --- | --- | --- |
| 全仓门禁 | 在最终 SDK parity、Sandbox、S1 readiness 与 release audit 一致状态下从头执行 `npm run check`，退出码 `0`；build、Web UI E2E、performance、dist、release receipt、Root/CLI/Server/Runtime/SDK 工作区测试全部通过 | **verified** |
| Web 分发预算 | 285 个 dist 文件；主入口 `apps/web/dist/assets/index-EFxXBnkr.js` 为 25420 bytes（24.82 KiB），低于 153600 bytes（150 KiB）硬预算；dist SHA `921ba47b…ac11` | **verified** |
| 1440×900 产品 QA | 在隔离产品服务 `http://127.0.0.1:8791` 打开最终 source-bound Thread，依次验收对话、任务、轨迹、设置；四个状态 `horizontalOverflowPx=0`，console 与 page errors 均为空，截图目视无遮挡或布局破坏 | **verified** |
| 1280×720 产品 QA | 同一 Thread 重复验收对话、任务、轨迹、设置；四个状态 `horizontalOverflowPx=0`，console 与 page errors 均为空，截图目视无遮挡或布局破坏 | **verified** |
| 懒加载 | 1280×720 刷新进入对话时 `TaskWorkspace`、`TraceWorkspace`、`WorkspaceSettingsSurface` 均未加载；点击任务、轨迹、设置后分别出现 `TaskWorkspace-eKz7MYWL.js`、`TraceWorkspace--3HFD3_J.js`、`WorkspaceSettingsSurface-CW6hErHd.js` | **verified** |
| Web UI E2E 基线 | 自动化 E2E 在 1280×900、1440×900、1920×1080 三视口均匹配基线，`horizontalOverflowPx=0`、`console.errorCount=0` | **verified** |

## 9. 最终判定

A1–A8 与 Phase 0–5 的首轮设计交付均已有实现与可复验证据；核心安全不变量和量化门槛成立。全仓 `typecheck`、架构门禁、完整 `npm run check`、最终 dist 硬预算及 1440×900 / 1280×720 双视口产品浏览器回归均已通过。Agent Harness 本地实现与最终源码绑定的证据闭环验收完成。S1 的外部签名发布及 Windows 主机验收继续独立保持 `blocked`。
