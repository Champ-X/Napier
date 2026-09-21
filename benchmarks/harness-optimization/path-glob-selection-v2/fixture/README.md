# Workspace file selection

`matchesPath(pattern,path)` in src/glob.mjs supports POSIX relative paths:
nonempty string, no leading/trailing /, empty component, backslash, '.' or '..'
component. Patterns use the same structure; `?` matches one Unicode code point
within a component, `*` zero or more code points within a component, and a whole
`**` component matches zero or more whole components. `**` embedded in a larger
component is invalid. Everything else is literal, including brackets, punctuation
and regex characters. File paths cannot contain `*` or `?` (reject TypeError).
Dot-prefixed files have no special status. Match case sensitively. Validate both
arguments, throwing TypeError for invalid input.
`selectPaths(paths,rules)` in src/select.mjs takes dense arrays: paths are valid
path strings and rules are plain objects {pattern,include}, include boolean.
Validate ALL inputs before selection, including rules when paths is empty.
A file is initially excluded; each matching rule overwrites inclusion (last wins).
Return included paths in input order with duplicates removed. Do not mutate inputs.
Use no dependencies, filesystem, or RegExp features beyond the standard library.
