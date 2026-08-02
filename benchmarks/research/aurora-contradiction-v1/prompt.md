Create and verify `reports/aurora-brief.md` from exactly three fixed Research Sources.

1. Call `research_source capture` exactly three times. Do not use `browser`.
2. Prefer the two official primary sources over the secondary blog.
3. Create citations with these exact claims and ranges:
   - `Project Aurora launched in 2024.` Cite line 2 from both primary sources.
   - `A secondary source claims 2023, conflicting with two primary sources.` Cite line 2 from all three sources.
   - `Retention is 30 days.` Cite line 3 from both primary sources.
4. Write a Markdown report with a `# Aurora Research Brief` heading, then one exact claim per line followed by its citation tokens. Add an `## Evidence Ledger` section listing citation IDs without repeating tokens.
5. Use `apply_patch` to create the report, then call `research_source verify_report` with the actual complete-file SHA-256.
6. Finish with a short confirmation. Do not quote source text outside the required claim lines.
