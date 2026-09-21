# Weighted routes

`validateGraph(nodes,edges)` from src/graph.mjs validates and returns undefined.
nodes is a dense array of unique nonempty string IDs. edges is a dense array of
plain records {from,to,cost}; endpoints must exist and cost must be a nonnegative
safe integer. The sum of ALL input edge costs must be a safe integer (reject if
not). Directed parallel edges, self edges and zero costs are allowed. Reject
invalid input with TypeError; do not mutate inputs.
`shortestRoute(nodes,edges,start,end)` in src/route.mjs validates the entire graph
and both endpoints, even when start=end or invalid edges are unreachable. Return
null if unreachable, otherwise {cost,path}, where path is an array of node IDs.
Choose minimum total cost; ties choose minimum edge count; further ties choose
lexicographically smallest whole path using JavaScript string `<` order per ID.
A node ID is compared as a whole string, not a delimiter-joined encoding. start=end
returns {cost:0,path:[start]}. Results must not alias caller input. No dependencies.
