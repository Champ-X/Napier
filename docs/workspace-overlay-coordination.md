# Workbench overlay coordination

Settings and Developer Workbench suspend background evidence and mobile
navigation without replacing their component instances. The shell remembers its
opener before changing visibility. On close, it removes inert isolation before
restoring focus to an available control in the resumed foreground surface.
Generation checks prevent an old queued restoration from moving focus behind a
new overlay.

Formal artifacts, workspace files, skill resources and the browser rail remain
mounted while hidden and inert. This preserves source/preview selection, iframe
state and browser takeover form/controller state. The workspace rail receives an
effective closed presentation without changing its stored open preference.
Inspector and navigation Escape listeners do not act while suspended; a second
Escape can close the restored surface. Existing semantic CSS and user-owned rail,
composer and style changes are preserved.

The initial approval-review capture exposed Settings and evidence overlapping at
320px. The first capture of this fix found another real defect: collapsing the
mobile navigation during suspension unmounted its search input. Its value
survived, but focus returned to the first navigation button. The
[failed capture](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/workspace-overlay-capture-failure-2026-10-29.json)
retains that evidence. Navigation now preserves the search node and hides its
mobile surface instead of changing its collapse preference.

## Verification

The [final browser receipt](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/workspace-overlay-ui-2026-10-29.json) records
five production browser scenarios and 17 screenshots at 1440px and 320px:

- Settings and Developer Workbench opened above evidence, including resizing,
  Tab/Shift+Tab containment, foreground-only Escape and subsequent evidence close.
- Formal artifact Raw source selection and DOM identity preserved through each
  shell overlay; the interactive HTML preview retains its Step 2 state.
- Keyboard Settings above narrow evidence and mobile navigation; composer/search
  drafts, the original search node and its restored focus are preserved. Settings
  also retains an unsent endpoint through the wide-to-narrow transition.

There were zero horizontal-overflow, page-error or external-browser-request
observations, and the shared model ledger recorded zero invocations. Nine
source/build/script trees, package-lock and all screenshot hashes were checked
again before saving the receipt unchanged. All 28 preserved user files matched
their pre-verification hashes. Screenshots were inspected for the former overlap
and focus restoration.

Reproduce after building Web and with current Contracts/Runtime/Server builds:

```sh
node scripts/check-workspace-overlay-ui.mjs /tmp/<new-receipt>.json
npm exec -w @napier/web -- vitest run \
  test/workbench-overlay-suspension.test.tsx \
  test/workbench-overlay-surfaces.test.tsx \
  test/workspace-file-inspector.test.tsx \
  test/ledger-navigation.test.ts \
  test/workbench-header-model-select.test.tsx --maxWorkers=1
```

The focused suite passed 30 tests across five files. The two new files passed
21 tests again after fixture type corrections. Web typecheck/build and an
explicit strict TSX check of those tests passed. The Web design contract reports
89 CSS files, 284 variables, zero literal-color debt and zero sub-12px debt.
Architecture retains its ten prior failures; no budget or compatibility baseline
was increased. The unrelated Runtime public-API failures were not re-executed
for this Web-only slice.

## Boundaries

The browser uses real production HTTP/UI and deterministic local artifact
fixtures, not live-model tasks. The HTML fixture's existing DOM button-click
convention verifies retained iframe state, not physical pointer interaction
inside that frame. Browser takeover and skill-resource state are tested with
real components and mocked API boundaries, not live backend sessions. This is
current dirty-worktree evidence including preserved user frontend changes, not
a clean release receipt.

This completes the reproduced overlay suspension defect, not all G06-B work.
Unified next-action presentation, deeper review links/version navigation,
broader inspector interaction consistency and comparative usability measurements
remain required by goal.md.
