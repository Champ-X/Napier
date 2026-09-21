# Binary frames

`checksum(bytes)` in src/checksum.mjs accepts Uint8Array, returns unsigned CRC32
(IEEE polynomial 0xEDB88320, initial/final xor 0xFFFFFFFF); empty => 0. Reject other
inputs with TypeError. No mutation.
`FrameDecoder(maxPayload=65536)` in src/decoder.mjs parses frames consisting of:
4-byte unsigned big-endian payload length, payload bytes, 4-byte unsigned big-endian
CRC32 of payload. maxPayload is safe integer 0..1,000,000. `push(chunk)` accepts
Uint8Array and returns an array of freshly owned Uint8Array payloads for complete
frames. Uint8Array subclasses such as Node Buffer are valid if freshly owned.
Preserve incomplete tail across calls, arbitrary fragmentation/coalescing,
and zero-length frames. Validate length as soon as four header bytes are available.
Reject length>maxPayload or bad checksum with TypeError; that push returns no frames
and permanently poisons decoder. Future push/finish throw TypeError. Invalid chunk
type also poisons decoder. `finish()` returns undefined if no incomplete frame and
closes decoder; incomplete frame throws TypeError and poisons it. Calls after close
throw TypeError. Constructor invalid input throws TypeError. No dependencies/I/O.
