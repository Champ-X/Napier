# Streaming CSV text

`CsvDecoder(maxFieldLength=100000)` from src/decoder.mjs accepts safe integer limit
0..1,000,000. `push(text)` takes a string fragment, returns completed rows (arrays
of strings). `finish()` emits the pending last row, returns [] if no pending row,
and closes decoder. Calls after close/error throw TypeError. Invalid input, quoted
syntax, limit overflow or unterminated quote at finish throws TypeError and poisons
decoder. Failed push returns no partial results. Each decoded field's length is
bounded in UTF-16 code units (including newlines within quoted fields).
Rules: comma separator; unquoted LF, CR and CRLF terminate records; CRLF is one
terminator even split across calls. Quoted fields begin with " at field start;
inside, doubled " decodes to one quote, and CR/LF/comma are literal. After a closing
quote only comma, record terminator or EOF is allowed. Quotes inside unquoted
fields are invalid. No trimming, BOM handling or Unicode normalization. Empty
input gives []; blank line gives [['']]; final newline gives no additional row;
trailing comma gives a final empty field. Preserve quoted newlines exactly. Empty
pushes are valid. Returned arrays cannot alter decoder state.
`parseCsv(text,maxFieldLength=100000)` from src/parse.mjs uses the same rules and
returns all rows from a complete string. No dependencies or I/O.
