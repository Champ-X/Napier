# Resumable upload buffer

`checkChunk(total,offset,bytes)` in src/chunk.mjs validates positive safe-integer
total, safe-integer offset>=0, a nonempty Uint8Array, and offset+length<=total;
return undefined or throw TypeError. Buffer is acceptable as Uint8Array.
`UploadBuffer(total)` in src/upload.mjs accepts a safe integer 1..1,000,000.
Methods: write(offset,bytes) -> count of newly supplied bytes; missing() -> sorted
half-open [start,end] intervals still missing; complete() -> boolean; finish() ->
fresh Uint8Array containing the full resource, throwing TypeError if incomplete.
Chunks may arrive out of order and overlap. Repeated identical bytes are accepted
idempotently; ANY conflicting overlapping byte rejects the entire write with
TypeError, even if part of the chunk was previously missing. Invalid calls leave
all bytes/coverage intact. Copy caller buffers on write and on finish. missing()
returns fresh arrays. No filesystem I/O, network, dependencies or implicit clocks.
