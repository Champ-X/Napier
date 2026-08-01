export const MAX_PYTHON_KERNEL_INPUT_BYTES = 8 * 1024;
export const MAX_PYTHON_KERNEL_JSON_VALUE_BYTES = 32 * 1024;

export const PYTHON_KERNEL_JSON_WORKER_SOURCE = String.raw`
MAX_INPUT_BYTES = ${MAX_PYTHON_KERNEL_INPUT_BYTES}
MAX_JSON_VALUE_BYTES = ${MAX_PYTHON_KERNEL_JSON_VALUE_BYTES}
MAX_JSON_DEPTH = 16
MAX_JSON_NODES = 4096
MAX_SAFE_INTEGER = 9007199254740991

def finite_number(value):
    if isinstance(value, int) and not isinstance(value, bool):
        return abs(value) <= MAX_SAFE_INTEGER
    if isinstance(value, float):
        return value == value and value not in (float("inf"), float("-inf"))
    return True

def freeze_json_value(value, depth=0, state=None):
    if state is None:
        state = {"nodes": 0}
    state["nodes"] += 1
    if state["nodes"] > MAX_JSON_NODES or depth > MAX_JSON_DEPTH:
        raise ValueError("Python kernel input exceeds its JSON shape limit")
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if not finite_number(value):
            raise ValueError("Python kernel input number is invalid")
        return value
    if isinstance(value, list):
        return tuple(
            freeze_json_value(item, depth + 1, state) for item in value
        )
    if isinstance(value, dict):
        if any(not isinstance(key, str) for key in value):
            raise ValueError("Python kernel input object key is invalid")
        frozen = {
            key: freeze_json_value(item, depth + 1, state)
            for key, item in value.items()
        }
        return types.MappingProxyType(frozen)
    raise ValueError("Python kernel input is not JSON-compatible")

def decode_json_input(encoded):
    if not isinstance(encoded, str):
        raise ValueError("Python kernel input encoding is invalid")
    raw = base64.b64decode(encoded, validate=True)
    if (
        not raw
        or len(raw) > MAX_INPUT_BYTES
        or base64.b64encode(raw).decode("ascii") != encoded
    ):
        raise ValueError("Python kernel input encoding is invalid")
    value = json.loads(raw.decode("utf-8", errors="strict"))
    return freeze_json_value(value)

def project_json_value(value, depth=0, state=None, seen=None):
    if state is None:
        state = {"nodes": 0}
    if seen is None:
        seen = set()
    state["nodes"] += 1
    if state["nodes"] > MAX_JSON_NODES or depth > MAX_JSON_DEPTH:
        raise ValueError("Python kernel result exceeds its JSON shape limit")
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if not finite_number(value):
            raise ValueError("Python kernel result number is invalid")
        return value
    if not isinstance(value, (list, tuple, dict, types.MappingProxyType)):
        raise ValueError("Python kernel result is not JSON-compatible")
    identity = id(value)
    if identity in seen:
        raise ValueError("Python kernel result contains a cycle")
    seen.add(identity)
    try:
        if isinstance(value, (list, tuple)):
            return [
                project_json_value(item, depth + 1, state, seen)
                for item in value
            ]
        if any(not isinstance(key, str) for key in value):
            raise ValueError("Python kernel result object key is invalid")
        return {
            key: project_json_value(item, depth + 1, state, seen)
            for key, item in value.items()
        }
    finally:
        seen.discard(identity)

def encode_json_value(value):
    try:
        projected = project_json_value(value)
        text = json.dumps(
            projected,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        raw = text.encode("utf-8")
        if len(raw) > MAX_JSON_VALUE_BYTES:
            return None
        return base64.b64encode(raw).decode("ascii")
    except (TypeError, ValueError, OverflowError):
        return None
`;
