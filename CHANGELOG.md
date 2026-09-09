# Changelog

Recent changes are recorded here. Earlier accumulated entries remain in the
[Git history index](docs/archive/README.md), with their original dates and
source baselines preserved.

## Unreleased

### Runtime

- Separate semantic progress from execution activity so ongoing inspection,
  implementation and verification receive bounded continuation windows; keep
  plan control tools available during acquisition convergence. Commit: `9b90593c`.
- Compact older complete execution units within the same Run at model request
  boundaries, preserving user messages and binding checkpoints to model context
  receipts. Commit: `02ff34a5`.

### Development and models

- Reload development services when the root `.env` is created, edited,
  replaced, or removed, including the Web proxy when the API port changes.
- Allow provider setup to check credentials again and prefer DeepSeek V4 Flash
  when configured, while preserving explicit Agent model choices.
  Commit: `d85a4944`.

### Workbench

- Add the browser-tab favicon and correct logo clipping, panel backgrounds,
  and collapsed workspace navigation. Commit: `9cab7176`.
- Preserve healthy browser sessions after target-action timeouts and keep
  manual recovery linked to the original run context, model, and capabilities.
  Commit: `8242fe4e`.
- Isolate generated deliverables by thread and serve inspected HTML through
  directory-scoped previews that support local assets. Commit: `51a9c642`.
- Render available search evidence, label image-page candidates, and show
  specific read/network failure diagnostics. Commit: `f5a5937b`.

### Documentation and developer checks

- Consolidate current architecture, including Run progress and incremental
  context compaction, into a concise source-linked reference.
- Remove superseded design proposals, duplicate historical logs, redirect-only
  pages and obsolete Super Design UI memory; preserve fixed Git references in
  the history index.
- Reconcile layout prose with the existing tokens and controller; centralize
  quantitative source-size rules in the architecture budget.
- Permit responsive CSS and additional viewport coverage while retaining the
  required desktop baselines in `check:desktop-scope`.
- Refresh the documentation index and current gap matrix, including the existing
  public API and release-source failures.

Documentation cleanup: 2026-09-09. This entry does not declare a package release
or refresh historical acceptance evidence.
