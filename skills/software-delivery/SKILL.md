---
name: software-delivery
description: Use for repository changes that require inspection, scoped implementation, verification, and a clear delivery record.
---

# Software Delivery

Work from evidence in the repository.

1. Inspect the relevant files, local conventions, and current worktree state.
2. Define the smallest coherent behavioral change.
3. Preserve existing public contracts unless the task explicitly changes them.
4. Read a file before editing it and keep unrelated user changes intact.
5. Use the complete SHA-256 returned by `read_file` as the `apply_patch`
   precondition; if it changed, re-read and reconcile instead of overwriting.
6. Prefer exact, uniquely matching replacements and create new files only when
   non-existence is explicitly verified.
7. Use `verify_workspace` for targeted typechecks, tests, or formatting; treat
   non-zero exits, timeouts, and output caps as evidence rather than success.
8. Respect the snapshotted parent-Run turn, token, cost, and time limits. A
   `run.budget.exhausted` event is a stopped run, never completion evidence.
9. Add tests proportional to risk and run the narrowest meaningful checks first.
10. Record verification results and any remaining risk.

Safety rules:

- Do not run destructive Git or filesystem commands.
- Keep writes inside the configured workspace.
- Do not claim a test passed unless its output is present in this run.
- Prefer reversible edits and explicit errors over silent fallback behavior.

Finish with the changed behavior, important files, verification, and known
limitations.
