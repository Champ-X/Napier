# Semantic version ordering

Implement the SemVer 2.0 syntax and precedence rules below without dependencies.

`parseVersion(text)` in `src/version.mjs` returns `{core, prerelease, build}`:
`core` is exactly three decimal digit strings; the other fields are arrays of
identifier strings. Preserve spelling and arbitrarily large integers exactly.
Core fields must be nonnegative integers with no leading zeros except `0`.
Prerelease identifiers are nonempty ASCII alphanumeric/hyphen strings separated
by dots; identifiers containing only digits must not have leading zeros.
Build identifiers follow the same character rules but may have leading zeros.
Optional prerelease starts with `-`, optional build with `+`, in that order.
Reject nonstrings, surrounding whitespace, `v` prefixes, empty identifiers,
missing components and any other characters with TypeError.

`compareVersions(left,right)` in `src/order.mjs` validates both operands and
returns exactly -1, 0 or 1. Compare core integers numerically without precision
loss. Equal core: a release is greater than any prerelease; compare prerelease
identifiers in order, numeric below nonnumeric, numeric by exact integer value,
and nonnumeric by ASCII lexicographic order. A shorter equal prefix sorts first.
Ignore build metadata in precedence.

`sortVersions(values)` validates every element of a dense array, even a singleton,
returns a new ascending array, preserves original strings and preserves original
order among versions with equal precedence. Reject sparse/nonarray input with
TypeError. Never mutate inputs. Node's standard library is available.
