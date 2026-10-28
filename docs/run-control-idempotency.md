# 干预消息的稳定重试身份

Web 普通 Composer 现已接入该协议，持久化、重试、撤回和替换的当前实现及浏览器验收见[干预发件箱](control-outbox.md)。本文下方保留后端切片自身的验证范围与当时边界。

`POST /api/threads/:threadId/runs/:runId/control-messages` 接受可选的 `clientMessageId`。调用方应在首次发送前保存该身份，并在网络失败、响应丢失、刷新后的重试中复用。Thread、Run 和客户端身份共同确定 control ID；相同内容的另一项用户意图应使用新身份。

```json
{
  "clientMessageId": "7d62ded0-6e33-4a06-b68b-b41624c3caf5",
  "mode": "follow_up",
  "text": "请在下一轮总结已验证的结果。"
}
```

身份限 1–128 个字符，以字母或数字开头，其余可包含字母、数字、`.`、`_`、`:`、`-`。`mode` 与既有规则规范化后的文本都属于同一个请求。相同身份却更改内容或模式返回 409，不能用“重试”暗中替换指令。旧客户端省略身份时继续每次创建新消息，不因文本相同而误去重。

同一身份的重试先读取原收据，即使 Run 已终止或队列满额，也只返回既有 `queued`、`delivered` 或 `cancelled` 状态，不重新排队、不修改取消原因、不再次产生 message.user。新身份继续经过 active Thread/Run、Workflow、demo、文本大小和队列数量限制。Thread 与 Run 的归属在读取重试结果前检查。客户端身份包含在排队请求摘要和公开消息收据中；投递与取消投影沿用它，未知字段和身份/内容摘要篡改仍被严格投影拒绝。

取消使用现有 control ID 的取消路由；成功后重新发送需使用新身份。被 Runtime 读取的消息不能撤回。`delivered` 表示既有 Runtime 消费边界已记录，不意味着模型已完成指令，也不能据此绕过后续任务验证。进程恢复将未投递消息取消时，旧身份重试应显示原取消状态，由用户明确选择新意图，而不是自动发到另一 Run。

## 验证

[当前收据](artifacts/run-control-idempotency-2026-10-29.json)绑定 14 个相关源文件、测试与复现脚本。最终共 101 项测试实际执行通过：Runtime 61，Server 40，覆盖 10 文件；过滤未执行的测试不计入通过数。

- 五次并发相同请求只追加一个 run.control.queued 和一个投递后的 message.user。
- 已投递、已取消、Run 结算后及重新打开 Store 的重试返回权威收据；不追加事件。
- 真实子进程在保存后、响应前 `process.exit(73)`。重启保留原 `run_interrupted_before_delivery`，重试不重新排队。
- 冲突文本/模式、非法身份、跨线程归属拒绝；相同身份可重查满额队列，新身份仍受限制；旧的无身份请求和旧 payload 仍可使用。
- 实际 Agent Runtime 的 faux 模型只接收一次重试后的 follow-up；两轮对话、一次记忆抽取，3 次 fixture 模型调用。此检查发现并修复了严格 progress codec 拒绝新增字段的问题。
- Hono app.request 在持久化后丢弃首个 HTTP 响应，再次请求返回同一收据。它是实际路由/Store 集成，不是 socket 或浏览器网络验收。

复现前需编译 Contracts/Runtime，Server 测试使用编译后的 Runtime：

```sh
npm run build -w @napier/contracts
npm run build:compile -w @napier/runtime
node scripts/check-run-control-idempotency.mjs /tmp/napier-control-idempotency-new.json
```

输出独占创建，相关文件在测试前后计算摘要；源码变化时不生成收据。Contracts build、Runtime typecheck/build:compile、Server typecheck/build 均通过。当前生成的 OpenAPI schema 增加可选字段，292/292 历史 operation 兼容验证通过；历史 compatibility fixture 未修改。

架构仍有原 11 项失败，公开 API 仍为原 1897/1896 和 compatibility digest 不匹配；没有提高预算。没有运行完整 release source manifest 门槛或宣称发布通过。此轮尚未让普通 Composer 保存并发送客户端身份，也未交付持久化草稿或可管理的发件箱；G06-A 保持未完成。
