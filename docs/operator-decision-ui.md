# 普通问题回答与续跑

普通 Operator Decision 的主操作是“回答并继续”，次操作是“仅保存答案”。主操作先等待答案持久化，再用同一 decision ID 请求 continuation。Runtime 保证同一答案和 continuation 身份幂等；界面还在 React 更新前用 pending 集合阻止重复点击。Workflow 问题仍只保存答案，由原有 Workflow 控制区继续，不借普通 continuation 扩大权限。

`use-operator-decision-actions` 管理 workspace root/dataRoot、threadId、decisionId 对应的输入、请求阶段、错误和保存结果。切换会话不会把 A 的完成或错误写给 B，也不会改变选中的会话；A 可以在后台继续。切换 workspace 后旧异步操作不再启动后续请求、提交线程数据或处理帧。这里不包含浏览器确认控件的并发改造。

保存失败时保留输入。若响应丢失后重新查询发现同一答案已保存，界面展示权威答案和“继续运行”，不自动假定失败并重新起一个任务。不同的已保存答案不被认作本次提交。续跑请求失败保留保存结果；重试只使用原 decision，不再次保存。续跑响应丢失但持久化状态已完成时，不再发布误导性的全局失败提示。仍在执行或 interrupted 的 Run 保持服务端真实状态。

输入使用原生 form/fieldset、可见 radio/checkbox 和关联标签；空答案或超过既有 4096-byte 上限时在提交后提示并定位输入。问题技术 ID 和答案摘要放在“答案详情”里。主按钮具备 40px 最小高度，其他按钮随容器换行。UI 不声称“答案已保存”等于“任务要求已经完成”。

## 当前证据

- [浏览器收据](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/operator-decision-ui-2026-10-29.json)：真实 HTTP、SQLite、Runtime、文件写工具和 Chromium，模型使用显式 faux provider。8 组观察覆盖正常、保存请求失败/响应丢失、继续请求失败/响应丢失、仅保存与跨会话后台完成。6 次续跑均各有一个答案事件、一个 continuation 和一次工具调用；每次结果文件内容核对一致。18 次 fixture 模型调用，0 外部模型请求。
- 1280×900、1440×900、1920×1080、1280×720、720×900、390×844、320×900 无 document 横向溢出，主操作通过 Playwright 的可达性检查；320px 下实际 Enter 提交并续跑成功。空输入提交焦点返回第一个选项。0 pageerror，0 外部页面请求。
- [桌面截图](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/operator-decision-ui-2026-10-29.json.screenshots/question-1440-900.png)与[窄窗口截图](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/operator-decision-ui-2026-10-29.json.screenshots/question-320-900.png)保留原始捕获。窄截图处于滚动区域下半段并受固定工作台壳层裁剪，不能据其宣称整个问题同时可见或全部窄屏可用性完成。关闭文件侧栏后执行了实际主操作检查；工作台壳层与统一 overlay 的完整可用性验收仍归 G06-B。
- 5 个相关 Web 测试文件共 107 个测试通过，包含 9 个真实 Hook/Panel 的异步与输入用例，以及已有 HTTP 请求封装、SSE 协议与线程流状态回归。Web 类型检查、生产构建、设计契约与 diff check 通过。
- 架构检查仍有原 11 项；主 ViewModel 行数从 2317 降至 2238，仍高于 1884 预算。API 的答案/取消请求实现迁到已有 thread-run-api，公共 re-export 保持兼容，API 行数预算只下调至 1180。没有改写历史发布证据，也没有宣布全仓发布门槛通过。

复现（输出独占创建，截图位于同名 `.screenshots` 目录）：

```sh
npm run build -w @napier/web
node scripts/check-operator-decision-ui.mjs /tmp/napier-decision-ui-new.json
npm exec -w @napier/web -- vitest run test/operator-decision-actions.test.tsx test/operator-decisions-protocol.test.ts test/thread-run-stream-state.test.ts test/api.test.ts test/stream-api.test.ts --maxWorkers=2
```

脚本使用现有 Server/Runtime/Contracts dist，因此更改后需先编译相应包；本收据对实际使用的全部构建文件计算并绑定清单摘要。源码/构建在验收期间变化会拒绝产生收据。服务与浏览器只使用临时目录，并在结束后清理。

这些是确定性集成证据，没有覆盖 live-model 质量、用户查找时间或误操作率。问答草稿目前仅在挂载期间跨会话保留，不声称刷新持久化；普通 Composer 草稿/附件/干预发件箱、Workflow 审批故障矩阵、浏览器确认隔离与统一恢复操作区仍待实现或验收。G06-B 仅勾选“回答并继续”这一实施项。
