# Documentation History

Historical narratives are preserved in Git instead of duplicated in the working
tree. Use the [current documentation index](../README.md) for active behavior
and constraints. Cleanup date: **2026-09-09**.

The links below are pinned to `02ff34a551c2179a1edfaa785e539d1e4de9047f`, the source immediately before cleanup.
Original dates, measurements and acceptance claims remain bound to that history.

| Record                                                                                                                                                                                           | Status / replacement                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| [Detailed architecture narrative](https://github.com/Champ-X/Napier/blob/02ff34a551c2179a1edfaa785e539d1e4de9047f/docs/architecture.md)                                                          | Current [architecture](../architecture.md)                                       |
| [Workbench V2 proposal](https://github.com/Champ-X/Napier/blob/02ff34a551c2179a1edfaa785e539d1e4de9047f/docs/archive/napier-workbench-v2-design.md)                                              | Replaced by [DESIGN.md](../../DESIGN.md)                                         |
| [Frontend optimization proposal, 2026-08-24](https://github.com/Champ-X/Napier/blob/02ff34a551c2179a1edfaa785e539d1e4de9047f/docs/archive/web-frontend-optimization-design-2026-08-24.zh-CN.md)  | Replaced by [DESIGN.md](../../DESIGN.md)                                         |
| [Harness design, 2026-08-22](https://github.com/Champ-X/Napier/blob/02ff34a551c2179a1edfaa785e539d1e4de9047f/docs/agent-harness-optimization-design-2026-08-22.zh-CN.md)                         | Dated proposal; current [architecture](../architecture.md)                       |
| [Harness acceptance, assessed 2026-08-27](https://github.com/Champ-X/Napier/blob/02ff34a551c2179a1edfaa785e539d1e4de9047f/docs/agent-harness-optimization-acceptance-matrix-2026-08-23.zh-CN.md) | Historical source-bound acceptance narrative                                     |
| [Phase 0 migration evidence](https://github.com/Champ-X/Napier/blob/02ff34a551c2179a1edfaa785e539d1e4de9047f/docs/phase-0-migration-evidence.md)                                                 | Historical development-host measurements                                         |
| [Earlier interview deep dive](https://github.com/Champ-X/Napier/blob/02ff34a551c2179a1edfaa785e539d1e4de9047f/docs/napier-interview-deep-dive.zh-CN.md)                                          | Replaced by the [learning guide](../napier-architecture-learning-guide.zh-CN.md) |
| [Implemented slices through 2026-09-07](https://github.com/Champ-X/Napier/blob/02ff34a551c2179a1edfaa785e539d1e4de9047f/docs/archive/implemented-slices-through-2026-09-07.md)                   | Completed work; current [gaps](../next-stage-gap-matrix.md)                      |
| [Changelog through 2026-09-07](https://github.com/Champ-X/Napier/blob/02ff34a551c2179a1edfaa785e539d1e4de9047f/docs/archive/changelog-through-2026-09-07.md)                                     | Earlier history; current [changelog](../../CHANGELOG.md)                         |
| [Super Design UI memory, 2026-08-19](https://github.com/Champ-X/Napier/blob/02ff34a551c2179a1edfaa785e539d1e4de9047f/.claude/super-design/ui-memory.md)                                          | Obsolete generated component log; no current developer rules                     |

The same records are available offline from this checkout:

```bash
git show 02ff34a551c2179a1edfaa785e539d1e4de9047f:docs/architecture.md
```

Replace the path after `:` with the path in the relevant link. This reads the
historical content without restoring old requirements into the working tree.

Machine-readable evidence remains under [docs/artifacts](../artifacts/). Old
path names in signed/hash-bound inventories and evidence-verifier exclusion
lists describe historical inputs, and their original values are preserved.
Source comparisons against those snapshots can fail on a later checkout; see
the [current verification limits](../next-stage-gap-matrix.md). This index does
not refresh the receipts or assert that the current tree matches their source.
