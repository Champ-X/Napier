# Transactional key/value store

`cloneJson(value)` in src/value.mjs returns an independent JSON value. Accept null,
booleans, strings, finite numbers, dense arrays, and plain objects whose prototype
is Object.prototype or null, recursively; reject undefined, nonfinite numbers,
functions, symbols, BigInt, sparse arrays, class instances and cycles with TypeError.
Treat own enumerable string keys literally, including **proto**, constructor and
prototype. Shared acyclic references are allowed and independently copied. Getters,
nonenumerable and symbol keys are outside this API's input domain.

`TransactionStore(initial={})` in src/store.mjs takes a plain object mapping
nonempty string keys to JSON values. All input/output JSON values are cloned.
Methods: get(key) -> {found:false} or {found:true,value}; set(key,value) -> undefined;
delete(key) -> boolean; snapshot() -> fresh plain object; begin(name) -> undefined;
commit() -> undefined; rollback(name) -> undefined; depth() -> active frame count.
Keys and frame names must be nonempty strings. begin records current state and
pushes a uniquely named active frame (duplicate active name raises TypeError).
commit pops ONLY the top frame, preserving current state, and raises TypeError
without an active frame. rollback(name) restores state at that frame's begin and
removes that frame and all descendants; unknown names raise TypeError. Rolling
back an outer frame also undoes committed inner changes. Names can be reused
after removal. Each invalid call leaves values and frame stack unchanged.
