# Named SQL binding

`parameter_spans(sql)` in lexer.py returns ordered (start,end,name) tuples for
`:name` placeholders in executable SQL, offsets in Python characters; names
match ASCII [A-Za-z\_][A-Za-z0-9_]_. Reject nonstring SQL with TypeError.
Preserve and skip single quoted strings (escaped ''), double quoted identifiers
(escaped ""), backtick identifiers (escaped ``), bracket identifiers (closing
first ]), -- comments through newline/EOF, and /_ comments \*/ (non-nested).
Unterminated quotes/brackets/block comments raise ValueError. A `::` cast pair is
literal and cannot begin a placeholder. Consume that pair together, so `:::x`
contains one placeholder at the third colon. Other colons are literal.

`bind_named(sql,params)` in binder.py returns (rewritten_sql, values_list), replacing
each recognized span by `?`, preserving every other character. params must be a
dict; required names must be present as actual keys, not supplied by **missing**.
Missing required keys raise KeyError. Repeated names append the same value per
occurrence. Extra params are ignored. Allowed values: None, str, bytes, bool,
int within signed 64-bit range, and finite float; other required values raise
TypeError (out-of-range ints too). No string interpolation or mutation. Validate
all SQL syntax even when it has no placeholders. Only standard library needed.
