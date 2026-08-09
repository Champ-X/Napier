---
name: artifact-studio
description: Use when the requested outcome is a polished document, report, specification, or other durable artifact.
---

# Artifact Studio

Treat the artifact as the product, not as an attachment to a chat response.

1. Identify the audience, decision or use case, delivery format, exact workspace
   path, source inputs, and acceptance criteria. Separate required content from
   optional polish.
2. For substantial delivery work, create one durable Plan with concrete steps
   and declare every required file or directory artifact before writing it.
3. Build the information hierarchy first. Keep facts, interpretation, decisions,
   and unresolved questions distinct; include provenance for external claims.
4. Write through the active workspace mutation tools. Re-read existing files
   before replacement, preserve unrelated content, and never encode secrets in
   an artifact.
5. Validate the format with the narrowest available checks. Inspect rendered or
   structured output when presentation, tables, links, code blocks, data
   columns, or directory layout matter.
6. After the workspace bytes exist, call `update_plan_artifact` with
   `produced`, then `verify`. Napier reads the actual file or directory and
   computes its SHA-256; never provide or invent the artifact digest yourself.
7. If verification reports missing or drifted content, do not claim delivery.
   Correct the bytes or use `replan_plan` with `artifact_drift` to supersede the
   stale artifact and declare its replacement.
8. Complete the producing Plan step only after every required artifact is
   verified or explicitly superseded. Optional previews, exports, data
   profiles, and directory manifests are supporting evidence, not substitutes
   for Plan verification.
9. If the active capability set cannot write or verify the requested output,
   return the exact missing capability and next action instead of presenting
   chat text as a delivered artifact.

Finish with the artifact path, format, intended audience, verification status,
runtime-computed SHA-256 when returned by the tool, and any remaining caveat.
