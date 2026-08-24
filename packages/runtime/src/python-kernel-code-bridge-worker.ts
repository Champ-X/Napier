import {
  PYTHON_KERNEL_CALL_PREFIX,
  PYTHON_KERNEL_CALL_RESULT_PREFIX,
} from "./python-kernel-code-bridge.js";

export const MAX_PYTHON_KERNEL_BRIDGE_CALLS = 8;
export const MAX_PYTHON_KERNEL_BRIDGE_INPUT_JSON_CHARS = 8 * 1024;
export const MAX_PYTHON_KERNEL_BRIDGE_RESPONSE_CHARS = 256 * 1024;

export const PYTHON_KERNEL_CODE_BRIDGE_WORKER_SOURCE = String.raw`
CALL_PREFIX = ${JSON.stringify(PYTHON_KERNEL_CALL_PREFIX)}
CALL_RESULT_PREFIX = ${JSON.stringify(PYTHON_KERNEL_CALL_RESULT_PREFIX)}
MAX_BRIDGE_CALLS = ${MAX_PYTHON_KERNEL_BRIDGE_CALLS}
MAX_BRIDGE_INPUT_JSON_CHARS = ${MAX_PYTHON_KERNEL_BRIDGE_INPUT_JSON_CHARS}
MAX_BRIDGE_RESPONSE_CHARS = ${MAX_PYTHON_KERNEL_BRIDGE_RESPONSE_CHARS}
BRIDGE_ENABLED = False
BRIDGE_EVALUATION_ID = ""
BRIDGE_NEXT_CALL_ID = 0

def begin_bridge(evaluation_id, enabled):
    global BRIDGE_ENABLED, BRIDGE_EVALUATION_ID, BRIDGE_NEXT_CALL_ID
    BRIDGE_ENABLED = enabled
    BRIDGE_EVALUATION_ID = evaluation_id
    BRIDGE_NEXT_CALL_ID = 0

def end_bridge():
    global BRIDGE_ENABLED, BRIDGE_EVALUATION_ID
    BRIDGE_ENABLED = False
    BRIDGE_EVALUATION_ID = ""

def valid_tool_id(value):
    if not isinstance(value, str) or len(value) < 1 or len(value) > 128:
        return False
    if not (("A" <= value[0] <= "Z") or ("a" <= value[0] <= "z")):
        return False
    return all(
        ("A" <= char <= "Z")
        or ("a" <= char <= "z")
        or ("0" <= char <= "9")
        or char in "_.:-"
        for char in value[1:]
    )

def bridge_call(tool_id, value):
    global BRIDGE_NEXT_CALL_ID, OUTPUT_CHARS
    if not BRIDGE_ENABLED:
        raise RuntimeError("napier.call is not enabled for this evaluation")
    if not valid_tool_id(tool_id):
        raise ValueError("napier.call toolId is invalid")
    if BRIDGE_NEXT_CALL_ID >= MAX_BRIDGE_CALLS:
        raise RuntimeError("napier.call limit exceeded")
    try:
        input_json = json.dumps(
            value, ensure_ascii=True, allow_nan=False, separators=(",", ":")
        )
    except BaseException as error:
        raise ValueError("napier.call input must be JSON serializable") from error
    if len(input_json) > MAX_BRIDGE_INPUT_JSON_CHARS:
        raise ValueError("napier.call input exceeded its limit")
    BRIDGE_NEXT_CALL_ID += 1
    call_id = BRIDGE_NEXT_CALL_ID
    payload = json.dumps({
        "kind": "napier.python-kernel-call",
        "schemaVersion": 1,
        "evaluationId": BRIDGE_EVALUATION_ID,
        "callId": call_id,
        "toolId": tool_id,
        "inputJson": input_json,
    }, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
    output = CALL_PREFIX + payload
    if OUTPUT_CHARS + len(output) + 1 > MAX_PROTOCOL_CHARS:
        raise RuntimeError("Python kernel output budget exhausted")
    OUTPUT_CHARS += len(output) + 1
    PROTOCOL_STDOUT.write(output + "\n")
    PROTOCOL_STDOUT.flush()
    remaining_timeout = signal.getitimer(signal.ITIMER_REAL)
    signal.setitimer(signal.ITIMER_REAL, 0)
    try:
        response_line = PROTOCOL_STDIN.readline(MAX_BRIDGE_RESPONSE_CHARS + 1)
    finally:
        signal.setitimer(signal.ITIMER_REAL, remaining_timeout[0], remaining_timeout[1])
    if not response_line or len(response_line) > MAX_BRIDGE_RESPONSE_CHARS:
        raise RuntimeError("Python Code Bridge response is unavailable")
    if not response_line.startswith(CALL_RESULT_PREFIX):
        raise RuntimeError("Python Code Bridge response is invalid")
    try:
        response = json.loads(response_line[len(CALL_RESULT_PREFIX):])
        keys = set(response) if isinstance(response, dict) else set()
        if (
            not isinstance(response, dict)
            or not keys.issubset({
                "kind", "schemaVersion", "evaluationId", "callId",
                "ok", "resultJson", "error"
            })
            or response.get("kind") != "napier.python-kernel-call-result"
            or response.get("schemaVersion") != 1
            or response.get("evaluationId") != BRIDGE_EVALUATION_ID
            or response.get("callId") != call_id
            or not isinstance(response.get("ok"), bool)
        ):
            raise ValueError()
        if response["ok"]:
            if not isinstance(response.get("resultJson"), str):
                raise ValueError()
            return json.loads(response["resultJson"])
        if not isinstance(response.get("error"), str):
            raise ValueError()
        raise RuntimeError(response["error"])
    except RuntimeError:
        raise
    except BaseException as error:
        raise RuntimeError("Python Code Bridge response is invalid") from error

class NapierBridge:
    __slots__ = ()

    def call(self, tool_id, value):
        return bridge_call(tool_id, value)

    def capability(self, query):
        if not isinstance(query, str) or not query.strip():
            raise ValueError("napier.capability query is invalid")
        result = bridge_call("capability", {"query": query})
        details = result.get("details") if isinstance(result, dict) else None
        descriptors = details.get("descriptors") if isinstance(details, dict) else None
        return descriptors if isinstance(descriptors, list) else []

STATE["napier"] = NapierBridge()
`;
