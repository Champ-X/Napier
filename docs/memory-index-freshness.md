# G07：索引完成后的记忆依赖复验

源码提交：`c4c7c75c5c55248fc5b3abc6105dff0b6b55cab7`，基于 G03 提交 `1c0dab83f65fe47fe3bc29401733d7c6bbcd313b`。Root 的源码收据记录 4 个精确文件、集成 tree `fc2f65007eaec3ffc2840c50cb88304023dcf4cc`、28 个受保护工作区文件未变，以及未 push 状态。本包整理期间没有修改源码、重跑测试或执行归档 probe。

## 问题与最终行为

旧实现仅复验被多个 fact 复用的文件 digest，单独引用的文件可能在原生 FTS 排名后变化，仍进入上下文。另一个窗口出现在首次复验剔除失效 fact 后的重新排名：重新排名期间第二个依赖变化，却没有再经过复验。

`task-memory-dependencies.ts` 现在复验本次调用中每个成功读取的 digest；首次失败或已失效的观察不会在调用内重新取得授权。`task-memory-context.ts` 在每轮排名后复验，移除失效项后重新排名，直到保留集合稳定。资格与授权检查仍先于依赖读取，索引仍只是当前合格集合的排名投影。

最终 race 测试覆盖单独引用依赖的内容变化、删除、路径逃逸，以及连续两轮排名分别失效的依赖。独立 fact 必须保留，失效 fact 必须排除并进入 stale 列表；用例还约束排名次数与依赖读取收据。

## 已保留的验证证据

| 证据 | 文件 / 执行记录 | 结果与来源 |
| --- | --- | --- |
| 修复前反例 | 1 / 2 | 两项均失败；原生 FTS 排名后的单独依赖与再次排名窗口均留下了过期 fact。原始 JSON、日志及当时测试正文完整保留。 |
| 初次修复回归 | 3 / 36 | 36 项通过；这是测试扩展前的中间证据，未作为最终源码的全部验证。 |
| 最终隔离回归 | 8 / 73 | 73 项通过；另有两份新增或修改测试文件的 strict compile、Runtime compile 日志及 architecture 原始结果。 |
| Root 集成回归 | 4 / 23 | 23 项通过；strict2 与完整 Runtime/CLI/Server 编译通过，以 root 源码收据和原始日志为据。 |
| 独立复核 | 8 / 68 | 68 项通过；复核决定为两处索引后窗口无阻塞，并保留顺序读取边界的合成 probe。 |

这些计数是运行记录，存在交叠，不能相加。最终 73 与独立 68 共享 66 条显示身份记录及其重复次数；前者另含 7 条 invocation cursor，后者另含 2 条 priority。集成 23 中 11 条属于本次 memory 测试，另外 12 条是 G03 child context/model-call parity。初次 36 与最终 73 共享 35 条显示身份记录，首个 race 用例后来扩展为三个参数化场景，测试正文与断言亦有增强。

`task-memory-context.test.ts` 的 9 个名称各执行三种 memory policy（`task-aware-v1`、`task-aware-selective-v2`、`task-aware-grouped-v3`）；Vitest JSON 的名称不带参数，因此最终 73 对应 55 个不同显示身份，独立 68 对应 50 个。核验使用包含文件、ancestorTitles、title、fullName 的多重集，保留重复次数，不把同名记录丢弃，也不声称 JSON 单独证明了各参数身份。参数来源另存该测试源码。

Architecture 保留 7 个既有问题：三个普通文件行数、web view-model 行数、plans 行数、一个函数复杂度与一个 change-coupling 预算问题；完整原文在 `final-isolated/architecture.log`。该 gate 并非 clean，本次未增加其问题，未重设预算。此包没有新的 public-API gate 执行记录。

## 成本与一致性边界

稳定情况下，D 个成功观察到的独立依赖路径各读取两次，共 2D 次。每次再次排名至少删除一个 fact，因此初始接受 N 个 fact 时最多 N+1 轮排名及复验；连续失效时最坏读取成本为 O(ND)。这不提供固定墙钟时间上限，也不是性能改善证据。

逐文件复验不提供跨文件原子快照，也不能保证文件在刚读完后不再变化。独立合成 probe 在复验 `b.ts` 时改变已复验的 `a.ts`，结果仍保留两项：`aObservedHash=hashA`、`aCurrentHash=newHashA`、4 次读取。它使用合成 digest reader，无网络或模型调用，是一致性边界说明，不能当作真实磁盘并发事务测试。本次修复没有改变底层 workspace path reader。

## 归档与可移植核验

`manifest.json` 列出所有证据文件及 SHA-256；`root-source-commit.json`、`source/` 和 `candidate.patch` 绑定已提交的 4 个文件。`baseline-source/` 是从旧 Git 提交恢复的两个生产文件，已确认在 `49a91de9` 与 `1c0dab83` 间一致；它不代表反例运行时完整工作树的同时冻结快照。

`before/`、`initial-after/`、`final-isolated/`、`integrated/` 和 `independent/` 保留原始记录。`case-identity-overlap.json` 列出每条记录及精确交叠。原日志与配置中的绝对路径仅作为历史来源；归档的 `.mjs` / `.ts` 文件不由核验程序执行。

[压缩包](artifacts/memory-index-freshness-2026-10-30.tar.gz)和[逐成员索引](artifacts/memory-index-freshness-evidence-index-2026-10-30.json)保存上述证据。无需解包或执行归档代码，运行以下命令核对哈希、失败保留、记录数量、多重集交叠与源码收据：

```sh
python3 docs/artifacts/memory-index-freshness-reconcile-2026-10-30.py
python3 docs/artifacts/memory-index-freshness-reconcile-2026-10-30.py --workspace .
```

核验只读既有证据，不重新运行测试、构建或probe。全部G07资源与模型质量验收仍未完成。
