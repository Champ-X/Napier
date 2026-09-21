/** Synthetic contract analysis with distinct obligations and no path anchors. */
export const PROGRESSIVE_REASONING_SECTIONS = [
  [
    "Accepted input",
    "The request accepts a positive integer quantity and an existing account identifier. Omitted metadata retains its documented default; an explicitly empty value stays empty.",
  ],
  [
    "Rejected input",
    "A boolean quantity must be rejected before consulting the balance. An unknown account produces the specified lookup error without creating any new record.",
  ],
  [
    "Boundary values",
    "An amount equal to the available balance is permitted and leaves zero remaining. A larger amount fails without subtracting a partial amount or emitting a success receipt.",
  ],
  [
    "Ordering",
    "Check authorization before exposing account availability. Apply the debit before publishing its receipt so observers cannot receive confirmation for an unapplied operation.",
  ],
  [
    "Cancellation",
    "A cancellation received before acceptance returns the documented cancelled result. After acceptance, the durable operation finishes and subsequent lookup reveals its recorded outcome.",
  ],
  [
    "Duplicate delivery",
    "Repeating an accepted request identifier returns the stored receipt without another debit. Reusing that identifier with a different amount is a conflict, even if sufficient funds remain.",
  ],
  [
    "Concurrent updates",
    "Two competing debits must serialize their balance comparison and write. Their combined accepted amount cannot exceed the opening balance in the absence of another credit.",
  ],
  [
    "Recovery",
    "Reopening storage after a committed debit retains its receipt and remaining balance. An operation interrupted before commit leaves neither a receipt nor a changed balance.",
  ],
  [
    "Visibility",
    "A reader sees either the complete prior record or the complete committed record. Intermediate fields are never published separately, and unrelated accounts keep their own values.",
  ],
  [
    "Completion",
    "Compare each observed outcome with these obligations after exercising the implementation. Report any unchecked branch explicitly and retain errors as evidence for the next repair.",
  ],
] as const;

export const PROGRESSIVE_REASONING = PROGRESSIVE_REASONING_SECTIONS.map(
  ([heading, body]) => `## ${heading}\n${body}`,
).join("\n\n");
