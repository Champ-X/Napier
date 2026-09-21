# 会话执行失败与输出恢复修复

会话：`thread_ea6e00122da54c378e06`，工作区：`/Users/champ/Projects/testNapier`。
分析依据：本地服务返回的事件账本、会话上下文胶囊、工具显示记录；没有依赖模型对自己成功与否的描述。

## 原因

原运行 `run_850d33dad8874e76aeae` 和恢复运行 `run_f16e27be87e6431ebfc5` 均以 `partial` / `failed` 结束，错误是 `Run made no measurable progress after one reroute: turns.`。两次实际运行合计约 21 分 22 秒。

- 11 次思考异常：10 次 `thinking_only_terminal`，1 次 `semantic_stall`。多数请求用满约 16,384 输出 tokens 后仍无可执行结果。
- 思考恢复把**总输出**限制为 2,048 tokens。总输出同时容纳思考和工具 JSON；写网页时参数被截断。三次 `apply_patch` 在调用工具之前即被 SDK 拒绝，文件没有写入。原错误提示只要求重新提交完整参数，没有要求缩小内容。
- 下一次正常工具轮次重置思考模式，重复消耗长思考窗口。手动恢复继续使用原机制，未改变失败条件。
- 另外四次错误分别是目标目录尚不存在、`run_command` 缺少必填 `runtime`、文件 SHA-256 过期、替换文本匹配不唯一。这些错误不应通过取消校验来掩盖。
- SDK 提前拒绝的调用绕过工具前后钩子，缺少本地工具错误详情；截断被归入 `unknown/alternate_route`，不能准确指导纠正输入。
- 所有 `partial` 结果都被界面描述为预算边界，掩盖了真正的无进展终止原因。

## 通用修复

1. 思考恢复降低模型支持的思考级别，保留调用方、模型与适配器确定的正常输出上限。原有总预算、超时、权限、文件哈希与原子写入保护继续生效。
2. 同一 Run 中，发生思考异常的实际服务模型在后续 3 次模型调用中保持短思考设置，再自动恢复请求的思考级别。状态按模型隔离，新 Run 不继承这一内存状态；避免每次工具返回就重置，也避免整个任务永久降档。
3. 仅在模型以 `length` 结束且其全部工具调用都有失败结果时，给下次请求添加拆分完整小调用的指导。保持原消息、工具结果和写入前置条件；已有用户后续指令时不插入该提示。
4. 将 SDK 输出截断拒绝识别为 `invalid_input/correct_input`，并保存提前拒绝调用的本地错误详情。没有伪造工具准入或执行事件。
5. 部分结果显示为“运行停止，已保留部分结果”，附实际错误；`paused_budget` 继续单独表示预算暂停。

## 已完成验证

- 50 项定向测试：思考恢复、实际 DeepSeek 请求序列化、截断后安全写入、错误分类、恢复上下文条件、界面状态。
- 15 项恢复、取消、工具准入回归测试。
- 8 项本地工具显示、进展与无进展保护回归测试。
- Runtime 与 Web TypeScript 检查通过，Runtime 编译通过。
- 新增执行链测试：模拟模型输出截断；断言磁盘未写入且没有 `tool.started`；下一轮使用完整参数写入约 14 KB 文件；检查实际文件内容、失败分类和本地错误显示。该测试是确定性回归，不冒充真实模型验收。
- 本地 HTTP 已确认原会话呈现真实的无进展错误，不再被描述为预算不足。

## 真实模型验证与最终状态

| Run | 结果 | 说明 |
| --- | --- | --- |
| `run_4033b38f2d764d66ab2a` | cancelled | 生成网页并通过项目浏览器打开；无输出截断。整轮短思考候选导致后续布局反复尝试，主动停止并改为 3 次调用冷却窗口。 |
| `run_3675960b10154c95b1d6` | failed / partial | 最终恢复策略；修正布局、朝向指标及验证脚本，完成实际坐标和旋转操作。触及原预算：1,258,691 / 1,000,000 tokens。 |
| `run_788f0f3740934b2daf92` | failed / partial | 验证保存、刷新、加载、撤销；修复重置删除存档与家具预算联动。触及原预算：1,095,550 / 1,000,000 tokens。 |

这些试运行有人工事实纠偏，包括布局评分、验证脚本必须绑定实际页面、预算删除/复制/撤销反例；不构成无人辅助完成或公平的性能对照。未放宽原预算，也未改写历史 Run 结论。当前会话 idle，无活动 Run，计划仍 active、3/6 步完成。预算计数可超过阈值后停止，上表保留实际值；本次未重构预算计量或宣称解决全部成本问题。

最终策略调整后另复跑 20 项相关测试全部通过（包含在前述 73 项范围内，不重复累计）；Runtime 编译与类型检查通过。

## 产物验收

- 页面：`/Users/champ/Projects/testNapier/living-room/index.html`。
- 最终页面 SHA-256：`34107dae32ba76af9e8a2cbd3236a8868465c1c66e3cb3ef4db415b64cc6ca0b`。
- 独立执行 `node /Users/champ/Projects/testNapier/living-room/verify.mjs`：48 PASS、0 FAIL，直接提取当前页面函数。日志保存于 `living-room/verification/node-verification.txt`。
- 四个种子方案无家具重叠、越界、门扇冲突；通道 114 / 84 / 94 / 104 cm，阳台开口 90 cm。预算属于标明口径的估算。
- Napier 自带浏览器实际验证：画布点击选中、坐标修改产生重叠、阳台阻塞使开口降至 30 cm、旋转产生 6.6 cm 越界、保存→刷新→加载、新增→撤销、保存→重置→加载。新增第二张桌子预算由 1266 增至 1665。具体版本与观察见 `living-room/verification/browser-verification.md`。
- 已从真实浏览器胶囊提取截图并查看，确认页面渲染。截图早于最终预算/重置修复，不能代表最终整页视觉复验。真实鼠标按下→移动→松开的拖拽尚未验证；坐标输入和旋转验证不替代拖拽。
- 外部 Browser 插件连接超时，未取得 DOM；上述浏览器证据来自 Napier 自带浏览器工具。
- `room-geometry.mjs` 等属于历史辅助文件，不代表当前页面逻辑。README 已修正旧摘要、检查数和验收边界。

## 原记录与产物元数据修复

验证原始 7 个错误胶囊结构及文件名哈希后，从原不可变证据补回 4 条缺失的本地工具显示记录。HTTP 现在提供全部 7 条原工具错误详情，含 3 次输出截断；没有伪造工具执行，也没有重写原始账本。

通过计划 API 对 a1/a3/a4/a5 的旧摘要进行系统漂移确认，再按 missing→produced→verified 重新绑定磁盘实物，附带限定范围的证据说明。a2 保留历史文件摘要，证据说明明确标为当前网页未使用的历史实现（verified 状态只表示字节绑定，不表示功能验收）。产物摘要验证不代表所有计划步骤验收完成；未将计划强行结项。

## 证据位置与范围

- `/tmp/napier-repair-final-tests.log`、`/tmp/napier-repair-regression.log`、`/tmp/napier-repair-display-progress-tests.log`：73 项应用检查。
- `/tmp/napier-repair-cooldown-tests.log`：最终 3 次调用冷却窗口的 20 项复验。
- `/tmp/napier-live-recovery.sse`、`/tmp/napier-live-final-recovery.sse`、`/tmp/napier-live-closeout.sse`：真实模型执行记录。
- `/tmp/napier-room-verified-screenshot.png`：已查看的浏览器截图，SHA-256 `a359893867d05bd7d32534512d267f62193a8de17aee14ce50f23fc42fbe4ff1`。
- `thread-output-recovery-2026-09-15.json`：机器可读收尾记录与产物摘要。

本地服务 health 与 SQLite quickCheck 均为 ok。工作区原有大量未提交修改，本次追加修复，没有提交或推送。原失败记录保留；恢复前目录备份为 `/tmp/napier-living-room-before-recovery.tgz`。

## 用户追加要求：取消任务累计 token 上限

已实现 `maxTotalTokens: 0` 表示不限，Runtime 和 Web 新建 Agent 默认采用 0。当前会话所属 Agent 的持久配置已通过 HTTP 修改为 0，独立进程重新加载账本确认生效。原已终止 Run 的历史预算与失败记录不变，新建/恢复 Run 使用当前配置。

- 总量达到或超过阈值的 token 终止分支、可选辅助调用判断、token 收尾保留区与模型预算提示均支持不限语义。`remaining.accountedTokens` 为 null，实际使用量仍持续累计。
- HTTP 校验、配置指纹、会话包导入、设置输入和用量显示一致支持 0；合法有限预算仍可显式配置，单次模型输出/上下文窗口未改为无限。
- 既有轮次、费用、超时与无进展保护继续生效。当前配置：64 轮、费用 25 USD、超时 30 分钟、累计 token 不限。
- 57 项预算/配置/导入等测试通过；随后 28 项重载/恢复/指纹检查、26 项恢复/提示/显示检查通过，三批存在重复，不相加作为独立测试总数。Runtime/Web/Server 类型检查与核心编译通过。
- 日志：`/tmp/napier-unlimited-tests.log`、`/tmp/napier-unlimited-reload-tests.log`、`/tmp/napier-unlimited-integration.log`、`/tmp/napier-unlimited-live-profile.json`。

### 重载时发现并修复的产物事件问题

本次通过 API 核对产物后，服务重载暴露 HTTP 写入端缺陷：请求未携带 sourceRunId 时生成 runctl 事件 ID，但产物仍继承已绑定的来源 Run，严格重放校验因两者不一致而拒绝加载。写入端现使用产物实际绑定的 sourceRunId。对已经产生的旧 runctl 事件，仅当同一产物的先前有效事件证明来源完全相同时允许继承；无来源证明、来源更换和摘要篡改仍拒绝。没有改写旧账本。添加正反例测试，且用独立 LocalStore 进程重新加载真实账本通过。
