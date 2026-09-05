import {
  PYTHON_KERNEL_CALL_PREFIX,
  PYTHON_KERNEL_CALL_RESULT_PREFIX,
  MAX_PYTHON_KERNEL_BRIDGE_FRAME_PAYLOAD_BYTES,
  MAX_PYTHON_KERNEL_BRIDGE_RESPONSE_FRAMES,
  MAX_PYTHON_KERNEL_BRIDGE_RESULT_BYTES,
} from "./python-kernel-code-bridge.js";

export const MAX_PYTHON_KERNEL_BRIDGE_CALLS = 8;
export const MAX_PYTHON_KERNEL_BRIDGE_INPUT_JSON_CHARS = 8 * 1024;
export const MAX_PYTHON_KERNEL_BRIDGE_RESPONSE_CHARS = 30 * 1024;

export const PYTHON_KERNEL_CODE_BRIDGE_WORKER_SOURCE = String.raw`
CALL_PREFIX = ${JSON.stringify(PYTHON_KERNEL_CALL_PREFIX)}
CALL_RESULT_PREFIX = ${JSON.stringify(PYTHON_KERNEL_CALL_RESULT_PREFIX)}
MAX_BRIDGE_CALLS = ${MAX_PYTHON_KERNEL_BRIDGE_CALLS}
MAX_BRIDGE_INPUT_JSON_CHARS = ${MAX_PYTHON_KERNEL_BRIDGE_INPUT_JSON_CHARS}
MAX_BRIDGE_RESPONSE_CHARS = ${MAX_PYTHON_KERNEL_BRIDGE_RESPONSE_CHARS}
MAX_BRIDGE_FRAME_BYTES = ${MAX_PYTHON_KERNEL_BRIDGE_FRAME_PAYLOAD_BYTES}
MAX_BRIDGE_RESPONSE_FRAMES = ${MAX_PYTHON_KERNEL_BRIDGE_RESPONSE_FRAMES}
MAX_BRIDGE_RESULT_BYTES = ${MAX_PYTHON_KERNEL_BRIDGE_RESULT_BYTES}
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

def read_bridge_response(call_id):
    state = None
    ignored = 0
    while ignored <= MAX_BRIDGE_RESPONSE_FRAMES * 2:
        response_line = PROTOCOL_STDIN.readline(MAX_BRIDGE_RESPONSE_CHARS + 1)
        if not response_line or len(response_line) > MAX_BRIDGE_RESPONSE_CHARS:
            raise RuntimeError("Python Code Bridge response is unavailable")
        if not response_line.startswith(CALL_RESULT_PREFIX):
            ignored += 1
            continue
        try:
            response = json.loads(response_line[len(CALL_RESULT_PREFIX):])
        except BaseException:
            ignored += 1
            continue
        if (
            not isinstance(response, dict)
            or response.get("evaluationId") != BRIDGE_EVALUATION_ID
            or response.get("callId") != call_id
        ):
            ignored += 1
            continue
        keys = set(response)
        expected_keys = {
            "kind", "schemaVersion", "evaluationId", "callId", "ok",
            "frameIndex", "frameCount", "payloadBytes", "payloadSha256",
            "payloadEncoding", "payloadBase64"
        }
        valid = (
            keys == expected_keys
            and response.get("kind") == "napier.python-kernel-call-result-frame"
            and response.get("schemaVersion") == 2
            and isinstance(response.get("ok"), bool)
            and isinstance(response.get("frameIndex"), int)
            and not isinstance(response.get("frameIndex"), bool)
            and isinstance(response.get("frameCount"), int)
            and not isinstance(response.get("frameCount"), bool)
            and isinstance(response.get("payloadBytes"), int)
            and not isinstance(response.get("payloadBytes"), bool)
            and 0 <= response.get("payloadBytes") <= MAX_BRIDGE_RESULT_BYTES
            and 1 <= response.get("frameCount") <= MAX_BRIDGE_RESPONSE_FRAMES
            and response.get("frameCount") == max(
                1,
                (response.get("payloadBytes") + MAX_BRIDGE_FRAME_BYTES - 1)
                // MAX_BRIDGE_FRAME_BYTES,
            )
            and 0 <= response.get("frameIndex") < response.get("frameCount")
            and isinstance(response.get("payloadSha256"), str)
            and len(response.get("payloadSha256")) == 64
            and all(char in "0123456789abcdef" for char in response.get("payloadSha256"))
            and response.get("payloadEncoding") == "base64"
            and isinstance(response.get("payloadBase64"), str)
        )
        if not valid:
            state = None
            ignored += 1
            continue
        try:
            chunk = base64.b64decode(response["payloadBase64"], validate=True)
            if base64.b64encode(chunk).decode("ascii") != response["payloadBase64"]:
                raise ValueError()
        except BaseException:
            state = None
            ignored += 1
            continue
        expected_bytes = (
            MAX_BRIDGE_FRAME_BYTES
            if response["frameIndex"] < response["frameCount"] - 1
            else response["payloadBytes"]
            - MAX_BRIDGE_FRAME_BYTES * (response["frameCount"] - 1)
        )
        if len(chunk) != expected_bytes:
            state = None
            ignored += 1
            continue
        if state is not None and response["frameIndex"] != state["nextIndex"]:
            state = None
            ignored += 1
        if state is None:
            if response["frameIndex"] != 0:
                continue
            state = {
                "ok": response["ok"],
                "frameCount": response["frameCount"],
                "payloadBytes": response["payloadBytes"],
                "payloadSha256": response["payloadSha256"],
                "nextIndex": 0,
                "parts": [],
            }
        if (
            response["ok"] != state["ok"]
            or response["frameCount"] != state["frameCount"]
            or response["payloadBytes"] != state["payloadBytes"]
            or response["payloadSha256"] != state["payloadSha256"]
            or response["frameIndex"] != state["nextIndex"]
        ):
            state = None
            ignored += 1
            continue
        state["parts"].append(chunk)
        state["nextIndex"] += 1
        if state["nextIndex"] != state["frameCount"]:
            continue
        payload = b"".join(state["parts"])
        if (
            len(payload) != state["payloadBytes"]
            or hashlib.sha256(payload).hexdigest() != state["payloadSha256"]
        ):
            state = None
            ignored += 1
            continue
        try:
            payload_text = payload.decode("utf-8", errors="strict")
            if state["ok"]:
                return json.loads(payload_text)
            raise RuntimeError(payload_text)
        except RuntimeError:
            raise
        except BaseException as error:
            raise RuntimeError("Python Code Bridge response is invalid") from error
    raise RuntimeError("Python Code Bridge response is invalid")

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
        return read_bridge_response(call_id)
    finally:
        signal.setitimer(signal.ITIMER_REAL, remaining_timeout[0], remaining_timeout[1])

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
