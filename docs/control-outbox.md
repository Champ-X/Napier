# 干预发件箱

普通 Composer 的运行中输入现在先写入持久发件箱，再调用现有控制消息 API。每项记录绑定 workspace root/dataRoot、threadId、原 runId、clientMessageId、文本和模式；每个身份使用独立 localStorage key。输入只在这份记录保存成功后清空。存储拒绝或额度不足时不发出新请求，输入保留并显示说明。

`useThreadSubmission` 收拢原主 ViewModel 的普通 Prompt、图片和运行中消息提交职责；`useRunControlOutbox` 管理视图生命周期，`ControlOutboxActions` 处理查账和操作，`ControlOutboxStore` 保存原始意图。普通 Prompt 保留原有失败恢复协议，不获得控制消息的幂等重试权限。

## 行为

| 情况 | 当前行为 |
| --- | --- |
| POST 正在等待 | 显示发送中；同一渲染的重复提交和同一身份的并发重试被抑制 |
| 网络、响应校验或响应传输失败 | 保留原消息和身份，显示待确认；读取既有 Run 控制消息列表查账 |
| 页面刷新 | 发送中变为待确认；重新观察服务端事实，不自动重发 |
| 用户重试 | 同 thread/run/clientMessageId、模式和正文；原 Run 结束后也不改投当前 Run |
| 收据变化 | 显示已排队、已消费、已取消；按事件序号拒绝晚到的旧收据回退状态 |
| 撤回 | 先保存撤回意图，核对并调用现有取消 API；响应丢失后继续查账 |
| 撤回后编辑 | 先得到 cancelled 收据，才开放替换编辑器；编辑稿和预分配的新身份可跨刷新保留 |
| 发送替换 | 新身份仍指向原 Run；重复点击/刷新后的重试复用这个新身份 |
| 消费抢先发生 | 显示已消费，禁止撤回或发送替换；没有自动创建额外消息 |
| 切换线程/工作区 | 结果只写原发件箱；新输入不被旧结果覆盖；workspace generation 失效后不再发起后续写请求 |

界面“已消费”只表示执行器取走消息的既有 Runtime 边界，不代表模型已履行要求。技术身份和原 Run 位于发送详情。普通按钮、原生表单、可读状态和有界滚动列表保留键盘操作；窗口变窄时按钮换行，标题在列表滚动时保留。

服务端收据本身不携带正文。旧客户端或另一浏览器的记录也会显示；仅当当前线程的对应 queued event 与收据绑定，且正文摘要匹配时，才恢复其原文。没有原文时明确说明，仍可撤回，不能伪造重试文本。

查账复用 `GET /api/threads/:threadId/runs/:runId/control-messages`，同一 Run 合并并发读取。当前视图有未决消息时每 3 秒查账，网络恢复和窗口获焦时也核对。GET/POST 有 20 秒请求超时；超时不证明服务器未执行。没有创建第二套服务端状态机或新权限。

## 当前证据

基线为 `baf8a50e`：已有按线程的草稿及服务端幂等协议，普通 Composer 尚未发送 clientMessageId。最终源码与构建摘要见 [浏览器收据](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/control-outbox-ui-2026-10-29.json)。它使用实际 Chromium、HTTP、Runtime 和 SQLite，模型为显式 faux fixture；未调用外部或付费模型。

- 发送成功后丢弃响应，重试同一身份，只出现一次排队；取消成功后丢弃响应，查到账本取消状态。
- 撤回、编辑、刷新、键盘发送替换完整执行；原消息取消后，新身份只进入原 Run。
- A 请求延迟失败时切至 B，B 草稿和发件箱不变；返回 A/刷新后旧请求和新草稿都在。
- Runtime 消费与撤回实际竞争：模型上下文包含且仅包含一次替换指令，未包含两项已取消原文；撤回失败后没有额外替换。实际为 3 次 fixture 模型调用，含记忆抽取。
- 原 Run 结束且另一个 Run 已开始时重试未确认消息，明确失败，不进入新 Run。
- 无客户端身份的旧消息通过同一界面撤回；quota failure 留住输入且没有新 POST。
- 该流程共 4 个排队事件、3 个取消事件、1 个消费事件。7 种窗口尺寸无 document 横向溢出，重试按钮通过点击可达性检查；桌面及 320px 截图已检查。
- 7 文件 73 个 Web 测试通过，包括 15 个存储/协议测试和 5 个实际 Hook 测试，覆盖同渲染重复、跨线程返回、A→B→A workspace generation、普通 Prompt 恢复等。
- [普通 Prompt 草稿回归](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/composer-drafts-prompt-ui-2026-10-29.json)单独验证旧文本恢复、新文本保留、刷新、quota 和 7 种尺寸，0 模型调用。原草稿收据保持不变；复现脚本改用普通 Prompt 传输失败，因为运行中干预现在保留在发件箱。
- Web typecheck/build、设计契约、diff check 通过。架构仍为原 11 项失败；主 ViewModel 2226→2175 行，API 行数预算随职责提取由 1180 降至 1155，没有提高预算。

```sh
npm run build -w @napier/web
npm exec -w @napier/web -- vitest run test/run-control-outbox.test.ts test/use-thread-submission.test.tsx test/thread-composer-drafts.test.tsx test/use-next-run-harness-policy.test.tsx test/api.test.ts test/workbench-layout.test.ts test/composer-interaction.test.tsx --maxWorkers=1
node scripts/check-control-outbox-ui.mjs /tmp/napier-control-outbox-new.json
node scripts/check-composer-drafts-ui.mjs /tmp/napier-prompt-drafts-new.json
```

复现要求 Contracts/Runtime/Server dist 与相应源码一致；本轮复用 `3260775e` 切片已编译的后端，未修改其源码。输出独占创建，避免覆盖旧证据。当前 Web 构建包含保留的用户前端改动，不能当作干净提交的发行验收。

## 边界

浏览器存储限同一 origin 和浏览器配置；未新增跨设备同步、多个标签页编辑冲突合并或自动清理历史记录。身份独立存储避免不同消息互相覆盖，但不声称多标签页的编辑事务具备全局锁。用户或浏览器删除存储后，只能从服务端找回已接受的事实。

浏览器本轮覆盖线程导航；workspace generation 由 Hook 测试覆盖。G05-B 的服务端多工作区 Runtime Registry 仍未实现，不以发件箱分区代替该验收。此次键盘和尺寸检查不等于读屏实测、真实用户可用性测量或 G06-B 整体验收。G01–G07 总目标仍在实施。
