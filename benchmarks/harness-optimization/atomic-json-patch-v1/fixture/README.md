# Atomic JSON Patch

Inputs are JSON values (finite numbers, dense arrays and plain objects; no cycles).
`decodePointer(path)` in src/pointer.mjs takes a string: empty string means root,
otherwise it must start with /. Split on /, decode ~1 as / and ~0 as ~, in one
pass; reject any other ~ escape with TypeError. Do not percent-decode or normalize.
`applyPatch(document,operations)` in src/patch.mjs returns an independent modified
JSON document without mutating either input, even when an operation fails.
operations must be a dense array of objects with op and path; unknown ops or bad
arguments throw TypeError. Supported ops: add, remove, replace, copy, move, test.
add/replace/test require own value; copy/move require from pointer. Extra fields
are ignored. Traverse only own keys. All path parents must exist and be containers.
Object keys including **proto**/constructor/prototype are literal data. Array
indices must be canonical decimal nonnegative safe integers, no leading zeros.
`-` allowed only as the final destination token for add/copy/move (append). add
inserts at 0..length, object add replaces or creates. replace/remove/test require
an existing target. Array remove shifts. Root add/replace replace the document;
root remove is invalid. copy deep-copies source before insertion. move removes
source then adds at destination (indices evaluated after removal); reject moving
root to nonroot, or moving into a descendant of source by decoded path tokens.
Moving any existing path to itself is a no-op. test uses structural equality:
object order irrelevant, array order significant, numbers equal by ===. A failed
test or invalid/missing path throws TypeError. No dependencies or filesystem I/O.
