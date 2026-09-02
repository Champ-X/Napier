# Frontend visual quality gate

Use this checklist only after the implementation is rendered.

- The primary action or reading path is clear within five seconds.
- Typography has a deliberate hierarchy and no text is clipped or illegibly
  small at the tested viewports.
- Spacing, alignment, borders, radii, and control heights follow one coherent
  system instead of varying accidentally.
- Dense data remains scannable; secondary metadata is visually quieter than
  the content it explains.
- Keyboard focus is visible, controls have accessible names, and color is not
  the only state cue.
- Loading, empty, error, selected, hover, and disabled states remain legible.
- The page has no unintended horizontal overflow at the target and narrow
  viewports.
- Animation is purposeful and respects reduced-motion preferences.
- Browser inspection shows no uncaught runtime error or failed local asset.

Report which viewports and interactions were actually checked. A source-only
review does not pass this gate.
