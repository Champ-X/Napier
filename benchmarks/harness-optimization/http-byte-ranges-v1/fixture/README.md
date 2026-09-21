# Byte range requests

`parseRanges(header,size,maxRanges=16)` from src/ranges.mjs returns null for an
ignored malformed/unsupported header, [] for valid but wholly unsatisfiable ranges,
or sorted inclusive [start,end] pairs of BigInts, merging overlap and adjacency.
size must be a nonnegative BigInt; maxRanges a positive safe integer; invalid
arguments throw TypeError even when the header is absent. null/undefined header
means absent; any other nonstring header throws TypeError. Accept exactly the
case-sensitive unit `bytes=` followed by comma-separated decimal `first-last`,
`first-`, or `-suffix` forms. ASCII spaces/tabs may surround the whole header and
individual ranges, but may not appear inside a range. Leading zeros are allowed.
Reject empty items, signs, extra hyphens, newline, other characters, first>last,
and more than maxRanges raw items as malformed (null). Validate all items before
selecting satisfiable ones. Clip last to size-1. first>=size and suffix=0 are
unsatisfiable. A suffix >= size selects the entire nonempty resource. size=0 has
no satisfiable ranges. Preserve exact integers of arbitrary length.

`rangeResponse(header,size,maxRanges=16)` in src/response.mjs returns:

- ignored/absent: {status:200,ranges:null,contentRange:null}
- unsatisfiable: {status:416,ranges:[],contentRange:'bytes \*/SIZE'}
- one merged range: {status:206,ranges:[[START,END]],contentRange:'bytes START-END/SIZE'}
- multiple merged ranges: {status:206,ranges:[...],contentRange:null}
  The ranges retain BigInts. No input mutation, I/O or dependencies.
