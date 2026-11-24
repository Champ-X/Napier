# 会话草稿与延迟失败恢复

普通 Composer 的文本和 steering/follow_up 模式保存于浏览器 localStorage，以 workspace root/dataRoot 和实际 threadId 分区。`useNextRunOptions` 组合现有下一轮配置与 `useThreadComposer`；后者管理独立的文本草稿和图片视图生命周期。没有当前会话时不能写入全局草稿；创建新会话后使用新的 threadId，从空草稿开始。

文本每次修改立即保存，不依赖稍后 effect 或切换时的清空/复制。切换 workspace 不再主动抹掉旧草稿。旧异步回调捕获的是原来的分区，因此 A 的失败不会恢复到 B。若 A 在发送后又输入新内容，失败文本进入 A 的恢复列表；点击“恢复为当前草稿”会把当前文本保留为另一份可切换草稿，焦点返回输入框。丢弃只移除用户选中的恢复文本。

保存数据包含 schemaVersion、text、mode、recovered，读取时校验形状。浏览器禁止存储、额度不足或保存数据不可读时保留当前内存输入并提示复制；这类情况下不声称刷新后仍可恢复。普通刷新使用同一浏览器配置和 origin 才能读回草稿。本轮没有实现跨设备同步、多浏览器标签冲突合并或自动清理历史草稿。

图片沿用既有约定：只存在当前会话视图内存，不持久化 base64，不纳入恢复文本列表；切换会话、工作区或刷新后清空。图片 setter 捕获视图 generation，即使 A→B→A，旧上传读取或旧发送失败也不能恢复图片。文本 setter 则继续写原会话分区，保留意图。

运行中干预现已接入[持久发件箱](control-outbox.md)：失败消息保留原 Run、身份、模式和文本，由同一身份重试，不再复制回 Composer 造成重复意图。普通 Prompt 仍使用这里的草稿恢复逻辑，没有新增自动重试权限；恢复提示要求先检查原会话是否已接受发送。

## 草稿切片的原始验收

[浏览器收据](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/composer-drafts-ui-2026-10-29.json)绑定相关源码和 Web 构建入口，使用真实隔离 HTTP 服务/Store 与 Chromium；只对一个队列请求注入传输失败，并对浏览器持久存储注入 quota failure，没有替换业务 API 响应。

- 多行中文草稿、follow_up 模式刷新后保留；实际导航 A/B 后各自文本独立。
- 延迟 A 请求失败期间切换 B，B 输入不变；返回 A 后，新输入和失败旧文本都存在；切换恢复文本并再次刷新后两份仍在。
- 存储额度错误不会清空输入，说明文字保留在可见操作区。
- 1280×900、1440×900、1920×1080、1280×720、720×900、390×844、320×900 无 document 横向溢出；恢复按钮通过真实点击可达性检查。截图见同名 `.screenshots` 目录，桌面和 320px 已人工查看。恢复列表可在自身区域滚动，不将所有历史草稿同时展开的可见性作为验收结论。
- 7 文件共 45 个不同测试通过，包含 7 个新存储/Hook 测试及图片、输入操作、Harness 策略、线程流状态和布局回归。Workspace 分区和延迟图片读取由真实 Hook 测试覆盖，浏览器这一轮覆盖线程导航与刷新。
- Web typecheck/build、check:web-design、diff check 通过。架构仍有原 11 项，主 ViewModel 2226/1884 行；新增耦合已消除，没有提高预算。未声称全仓 release 门槛通过。

复现（输出独占创建）：

```sh
npm run build -w @napier/web
node scripts/check-composer-drafts-ui.mjs /tmp/napier-composer-drafts-new.json
npm exec -w @napier/web -- vitest run test/thread-composer-drafts.test.tsx test/composer-image-attachments.test.ts test/composer-interaction.test.tsx test/use-next-run-harness-policy.test.tsx test/agent-capability-composer.test.ts test/thread-run-stream-state.test.ts test/workbench-layout.test.ts --maxWorkers=2
```

Server/Runtime/Contracts 的现有 dist 需与当前后端源码一致；原草稿切片使用上一轮已编译的后端，模型调用为 0。没有读屏实测或真实用户成功率测量。

## 发件箱接入后的回归

当前脚本在验证运行中模式持久化后结算 fixture Run，再对普通 Prompt 注入延迟传输失败，继续验证新旧文本、刷新、存储失败与 7 种窗口尺寸。[新收据](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/composer-drafts-prompt-ui-2026-10-29.json)绑定当前脚本和相关源码；0 模型调用。历史队列失败收据未重写。发件箱有独立的真实 Runtime/HTTP 浏览器验收，G01–G07 其余目标仍保持未完成。
