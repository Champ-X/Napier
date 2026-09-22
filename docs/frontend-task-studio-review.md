# 前端视觉与交互验收 · Task studio

2026-09-22 · `feat/frontend` · Design contract 2.3

## 交付范围

- 统一雾蓝灰导航、深蓝主操作、白色内容面板、字体层级、焦点与悬停反馈。
- 首页以任务为中心：共享左对齐轴线、任务账本图标、六个可直接填入输入框的入口。
- 优化侧栏选中态、视图标签、对话输入、用户消息、审批、结果证据与开发者面板。
- 输入框显示实际支持的 Ctrl / Command + Enter 快捷键；输入法组合输入不会误发送。
- 设置与开发者弹层隔离背景交互，关闭恢复焦点；键盘可以跳过侧栏直接进入工作区。
- 空任务提供返回对话的操作，初次连接失败提供可用的重试按钮。
- 修复窄窗口设置内容被固定侧栏挤压的问题；任务卡片、设置导航和输入提示可重排。

## 验证与证据

| 验证 | 结果 | 范围 |
| --- | --- | --- |
| 前端测试 | 1,156 / 1,156 通过 | 270 个测试文件 |
| 设计令牌与布局基线测试 | 6 / 6 通过 | 配色生成、别名校验、确定性、布局比对 |
| 前端生产构建 | 通过 | TypeScript + Vite |
| 设计契约检查 | 通过 | 82 个 CSS 文件；无新增字面颜色或小于 12px 文本债务 |
| 桌面范围检查 | 通过 | 保留规定的桌面覆盖范围 |
| 专项浏览器验收 | 15 / 15 通过 | 320、390、768、960、1280、1440、1920px；键盘、语言、重连、高对比度 |
| 生产端到端场景 | 11 / 11 通过 | 真实生产服务与隔离账本；普通/长对话、运行、审批、恢复、轨迹、设置等 |
| 最终独立布局复验 | 通过 | 与本机重新采集的基线比对 |

浏览器验证使用本机 Chromium、真实生产构建及隔离的持久化账本 fixtures，未调用付费在线模型。
专项运行未捕获到页面 JavaScript 异常。支持减少动态效果与系统强制配色。
本次验证不等同于 Safari/Firefox 验收或在线模型能力评测。

复现命令（先构建 contracts、runtime 和 server）：

```sh
npm run build -w @napier/web
npm run test -w @napier/web
npm run check:web-design
node scripts/verify-task-studio.mjs
node scripts/run-web-ui-e2e.mjs --receipt benchmark-results/frontend-task-studio/e2e-verified.json
```

浏览器截图与机器可读结果保存在 `benchmark-results/frontend-task-studio/`（本地产物，Git 忽略）：

- [桌面首页](../benchmark-results/frontend-task-studio/welcome-desktop.png)
- [320px 首页](../benchmark-results/frontend-task-studio/welcome-320.png)
- [桌面设置](../benchmark-results/frontend-task-studio/settings-desktop.png)
- [审批与证据](../benchmark-results/frontend-task-studio/conversation-evidence.png)
- [开发者工作台](../benchmark-results/frontend-task-studio/developer-desktop.png)
- [专项检查记录](../benchmark-results/frontend-task-studio/verification.json)
- [完整端到端记录](../benchmark-results/frontend-task-studio/e2e-verified.json)

## 基线变化与未纳入本次修复的告警

原有 macOS ARM64 布局基线记录 52px 单层顶栏；本次修改前的源码已经使用 88px 双层顶栏。
首次端到端检查因此在 `1280:header.height` 失败，原始失败日志已保留为
`original-layout-baseline-failure.log`。后续审批样式优化又改变了对话可用高度；在最终截图检查后
重新采集了当前布局，并独立复跑比对。未修改比对容差、场景断言或 Linux 平台基线。
Linux 平台几何基线需要在相应平台重新采集，不能由本机结果推定。

`check:architecture` 仍有 10 项现存告警（行数、复杂度或耦合预算），涉及：
`use-workspace-view-model.ts`、`skill-load-standard.ts`、`agent-tool-result-lifecycle.ts`、
`browser-session.ts`、`plans.ts`、`run-config.ts`、`standard-skill-snapshot-compose.ts`、
`thread-bundles.ts`、`conversation-thinking-view-model.ts`、`api.ts`。
这些文件已逐一与 HEAD 比较，均未改动；未放宽它们的预算。本次 Composer 的新增超限通过拆出
`composer-keyboard.ts` 解决，组件现为 493 行。完整告警保存在 `architecture.log`。
