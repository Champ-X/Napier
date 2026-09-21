# Source map mappings

`decodeVlq(text)` from src/vlq.mjs decodes concatenated base64 VLQ values into
signed integers: alphabet ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/
Each base64 digit: low five bits payload, high bit continuation. Least significant
payload bit of the accumulated unsigned integer is sign; remaining bits magnitude.
Require shortest encodings (a multi-digit integer cannot end with zero payload),
reject negative zero, invalid characters, truncated continuation, magnitudes above
2147483647, nonstring input, with TypeError. Empty string => [].
`decodeMappings(text)` from src/mappings.mjs decodes Source Map v3 mappings string.
Semicolons separate generated lines (0-based); commas separate segments. Empty
lines allowed; empty segments within a nonempty line are invalid. Each segment
must decode to exactly 1, 4, or 5 integers. Field 1 is generated-column delta:
reset generated column to zero on each line. Fields 2..4 are source-index,
original-line, original-column deltas; field 5 is name-index delta. Those four
states start zero and carry across ALL segments/lines, including unmapped segments.
Return flat objects {generatedLine,generatedColumn} for 1-field segments; add
source, originalLine, originalColumn for 4/5-field; add name only for 5-field.
Every resulting index must be in [0,2147483647]. Generated columns must be strictly
increasing within each line after its first segment (first can be zero). Other
deltas may be negative if resulting states remain valid. Reject errors with
TypeError, no mutation or dependencies. Empty mappings => [].
