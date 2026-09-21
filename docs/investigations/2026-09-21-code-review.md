# 2026-09-21 工作区代码审查

审查基点：`c454a155`。范围为当前工作区的 Harness 七方向实现、运行恢复、
预算、Node/Python 工具链、Web/CLI 集成及随附测试和历史证据。本文记录本次
离线工程审查，不取代历史实验结论，也不声称逐行审查全部历史工件。

## 本次修复

- 测试框架自动发现达到扫描上限时明确拒绝，避免把不完整发现误判为 Vitest
  项目、漏掉 Node 原生测试；保留显式选择与混合框架的安全边界。
- CLI 未指定 Harness 文件时不抢先抛出取消异常，交由正常 Run 生命周期记录
  durable cancelled；指定文件时仍在读取前检查取消。
- 导入线程时先验证原 Harness 策略收据，再按新 Run ID 重绑定哈希。真实
  LocalStore 导出、导入及再次导入测试验证策略不变、源 bundle 不变、篡改拒绝。
- 将模型恢复证据和代理预算规范化从大型执行模块分离，保留公开导出及预算
  语义；证据模块依赖最小存储接口，不新增对完整 LocalStore 的耦合。
- 去掉不必要的新内部常量公开导出；修复 Knip 根工作区配置及真实动态入口。
- 同步累计 token 无上限和实际模型排序的过期测试；浏览器安装复用测试使用
  注入的自包含 ready fixture，不依赖本机验证 marker，也不伪造真实安装状态。
- 保留重试输出空间以容纳完整工具参数，同时补测调用者更低上限仍有效；
  通过安装的供应商 SDK 验证序列化，在 HTTP 发送前终止，零真实模型请求。
- 浏览器坐标及截图确认两行页头没有重叠。验收脚本改用二维矩形间隔，保留
  1 px 舍入容差，并测试真实碰撞仍被拒绝。运行中 HTML 预览断言与原已存在的
  `allow-scripts` 沙箱保持一致，新增拒绝 same-origin/top-navigation 扩权测试。

## 验证记录

开发编译与 8 个工作区类型检查通过：

```sh
npm run build:core:development
npm run typecheck --workspaces --if-present
npm run build -w @napier/cli
npm run build -w @napier/server
npm run build -w @napier/web
```

首次完整工作区测试执行了所有包；Runtime 为 2822 passed / 4 failed / 60 skipped，
Web 为 1156 passed，SDK 为 80 passed。Runtime 的 4 项过期断言已修正，随后
5 个相关测试文件共 58 项通过。CLI/模型目录/工作流定向重跑也通过。
完整重跑结果见下方收尾记录；这些计数不代表 live/OCI 跳过项已被验证。

根脚本全量检查仍非全绿。发布收据、SDK 快照、提示快照及公开 API 检查
保留失败，不刷新旧证据。第一次根套件中的架构扫描超时、基准测试失败和
未声明动态入口已分别通过限并发重跑、重建 CLI 和修复 Knip 验证。
一次并发复查与 CLI 清空 dist 的构建发生竞争，导致 2 项测试及 1 个套件缺少
CLI 模块；构建完成后，相关测试连同 Web 几何/沙箱契约共 30 项通过。
最终在编译产物稳定后重跑根套件：141 个文件中 126 passed / 15 failed，
820 项测试中 750 passed / 70 failed。70 项失败分布为发布工件 50、S1 汇总 4、
source manifest 3、SDK 快照 2、9 个沙箱/主机收据各 1、提示快照 1、公开 API 1。
这不是根套件通过；不能据此声称完整发布就绪。

浏览器真实运行覆盖三个桌面尺寸、键盘导航、运行中任务、审批、恢复、长
对话、产物预览、设置、中文界面和服务器重连，功能收据断言通过；完整命令
仍在最后的历史布局基线比较失败：`1280:header.height`。未写入新布局基线，
不把该命令称为通过；窄窗口也未重新验收。

包锁、依赖归属、死代码、重复代码、Web 设计、Management OpenAPI 兼容检查
通过。提交前另核查 whitespace、敏感文件/密钥模式及异常大文件。
暂存后检查发现三个保留的基准文件（`bounded-async-queue-v2/v3/v4/outcome.mjs`）
有末尾空行警告。它们属于版本化历史实验输入，保持原字节以免改变任务身份；
除此之外，暂存改动的 whitespace 检查通过。

## 保留的未通过项

- 架构门禁仍有 10 项：Web view model、Skill contracts、工具结果生命周期、
  browser session、plans、run config、Skill snapshot、thread bundles 的行数，
  thinking view model 的复杂度，以及 Web API 的静态耦合。
- 隔离的原始 `c454a155` 检查有 11 项架构错误。当前减少了 runtime/fan-out/
  coupling 等旧问题，但另有 4 处当前交付的行数超限，不能把全部 10 项都归为
  基线遗留。只收紧已下降的预算，没有提高阈值。
- Runtime 根公开 API 为 1897，预算为 1896，且摘要不匹配；隔离基点也相同。
- Release source manifest 在隔离基点同样不匹配；旧发布、沙箱、SDK 等收据
  仍绑定各自历史源码，必须经各自正式工作流重新产生验收证据。
- 没有执行新付费模型实验、完整 30 × 3 统计、跨主机/OCI 实测或部署。
  v6 仍是显式实验策略，历史失败、费用预留及停止状态保持不变。

## 收尾记录

最终完整执行 `npm run test --workspaces --if-present`，退出码 0：

| 工作区 | 通过 | 跳过 |
| --- | ---: | ---: |
| CLI | 204 | 5 |
| Server | 320 | 0 |
| Web | 1156 | 0 |
| benchmark-kit | 90 | 10 |
| contracts | 131 | 0 |
| harness-eval | 10 | 0 |
| Runtime | 2827 | 60 |
| SDK | 80 | 0 |
| 合计 | 4818 | 75 |

Runtime 最终覆盖 551 个文件（537 passed / 14 skipped）。暂存审查覆盖
1161 个文件改动；敏感路径、私钥/token 模式及大于 2 MiB 文件扫描未发现风险，
文档 61 个本地链接均可解析。只移除了本轮创建的临时基点 worktree，未清理
用户的其他 worktree 或历史证据。本文随代码审查提交交付，实际提交身份和
远端同步以 Git 记录为准；以上结果不是完整发布通过声明。
