# TTL LRU cache

`validateTime(now,lastNow)` in `src/clock.mjs` accepts finite nonnegative numbers
with now >= lastNow, returning now; invalid input throws TypeError.
`deadline(now,ttlMs)` accepts finite nonnegative numbers, rejects overflow of their
sum, and returns now+ttlMs. All validation failures use TypeError.

`TtlLruCache(capacity,ttlMs)` in `src/cache.mjs` takes a positive safe-integer
capacity and a finite nonnegative TTL. Export this class. Initial logical time is
zero. Methods: `put(key,value,now)` (returns undefined), `get(key,now)` (returns
`{found:false}` or `{found:true,value}`), `delete(key,now)` (boolean), `keys(now)`
(new array from least to most recently used), and `size(now)` (number).
Keys are nonempty strings. Values are arbitrary and retained by identity,
including undefined; a hit must therefore be distinguishable from a miss.

Each valid operation advances logical time monotonically and first removes all
entries whose expiration <= now. Expiration is set by put as now+ttlMs; reading
does not renew it. A hit becomes most recently used; a miss, keys or size does
not reorder remaining entries. put replaces and renews an existing key, making
it most recent; then evicts least recent entries until within capacity. TTL zero
never retains an entry and removes an existing instance of that key. delete
reports whether an unexpired key existed. Returned key arrays cannot mutate the
cache. Validate key, time and (for put) expiration before modifying any cache
state, purging entries or advancing time. Invalid calls leave all state intact.
