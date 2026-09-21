# BM25 document search

`tokenize(text)` in src/tokenize.mjs accepts strings; normalize NFKC, lowercase,
then extract maximal runs of Unicode letters/numbers using Unicode properties
\p{L} and \p{N}. Return tokens in order including duplicates. Reject nonstrings
with TypeError. No stemming or stop words.
`SearchIndex(documents=[])` in src/search.mjs accepts a dense array of plain
objects {id,text}, unique nonempty string IDs and string text. Copy/own contents.
Methods: upsert(document) -> undefined (replace or add by ID); delete(id) -> boolean;
search(query,limit=10) -> fresh array of {id,score}. Validate all arguments with
TypeError; limit is safe integer 0..1000. Invalid calls leave index unchanged.
IDs such as **proto** are literal. query tokenization as above, deduplicate query
terms. Empty query or no matching documents returns []. Score each document using
BM25 with k1=1.2, b=0.75, natural log:
idf(t) = log(1 + (N - df(t) + 0.5)/(df(t) + 0.5));
score(d) = sum over unique query terms present in d of
idf(t) * tf(t,d)*2.2 / (tf(t,d) + 1.2*(0.25 + 0.75*len(d)/avgLen)).
N includes all indexed documents, even empty ones; len counts all tokens;
avgLen is total token count/N. Empty corpus/all-empty documents produce no hits.
Recompute effective statistics after upsert/delete. Only positive-score hits,
descending score, exact score ties by ID JavaScript string < order. Apply limit
after sorting. Return only id and score. No dependencies, filesystem or network.
