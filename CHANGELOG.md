# Changelog

Recent changes are recorded here. Earlier accumulated entries remain in the
[legacy changelog](docs/archive/changelog-through-2026-09-07.md), with their
original version/date heading preserved.

## Unreleased

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

### Documentation

- Add a current documentation index and local development/troubleshooting
  guide; update configuration, preview, search, and recovery references.
- Archive superseded UI proposals and accumulated implementation logs,
  label dated acceptance snapshots, and replace the old backlog with a
  concise review of current gaps.

The documentation review date is 2026-09-07. These entries do not declare a new
package release or revalidate historical release evidence.
