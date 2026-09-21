import json
import sys
from shipping import shipping

print("READY", flush=True)
for line in sys.stdin:
    try:
        request = json.loads(line)
        result = {**request, "shipping": shipping(request["subtotal"], request.get("expedited", False))}
    except (ValueError, TypeError, KeyError) as error:
        result = {"error": str(error)}
    print(json.dumps(result, sort_keys=True), flush=True)
