import { sha256 } from "./ed25519.js";
import { PYTHON_KERNEL_JSON_WORKER_SOURCE } from "./python-kernel-json-worker.js";
import { PYTHON_KERNEL_CODE_BRIDGE_WORKER_SOURCE } from "./python-kernel-code-bridge-worker.js";
import { deflateSync } from "node:zlib";

export const PYTHON_KERNEL_PROTOCOL_PREFIX = "NAPIER_PY_RESULT ";
export const MAX_PYTHON_KERNEL_CODE_BYTES = 16 * 1024;
export const DEFAULT_PYTHON_KERNEL_EVALUATION_TIMEOUT_MS = 1_000;
export const MAX_PYTHON_KERNEL_EVALUATION_TIMEOUT_MS = 2_000;
export const MAX_PYTHON_KERNEL_PREVIEW_CHARS = 4_096;
export const MAX_PYTHON_KERNEL_CONSOLE_ENTRIES = 12;
export const MAX_PYTHON_KERNEL_CONSOLE_CHARS = 256;
export const MAX_PYTHON_KERNEL_WORKER_ARGUMENT_CHARS = 2_048;
export const MAX_PYTHON_KERNEL_PROTOCOL_TOTAL_CHARS = 96 * 1024;
export const MAX_PYTHON_KERNEL_TRACED_MEMORY_BYTES = 32 * 1024 * 1024;
export const PYTHON_KERNEL_OUTPUT_BUDGET_EXHAUSTED =
  "Python kernel output budget exhausted";
export const PYTHON_KERNEL_MEMORY_LIMIT_MARKER = "NAPIER_PY_MEMORY_LIMIT";
export const PYTHON_KERNEL_TIMEOUT_MARKER = "NAPIER_PY_EVALUATION_TIMEOUT";

export const PYTHON_KERNEL_WORKER_SOURCE = String.raw`
import ast
import base64
import builtins
import hashlib
import json
import os
import resource
import signal
import sys
import threading
import time
import tracemalloc
import types

${PYTHON_KERNEL_JSON_WORKER_SOURCE}

PREFIX = ${JSON.stringify(PYTHON_KERNEL_PROTOCOL_PREFIX)}
MAX_CODE_BYTES = ${MAX_PYTHON_KERNEL_CODE_BYTES}
MAX_TIMEOUT_MS = ${MAX_PYTHON_KERNEL_EVALUATION_TIMEOUT_MS}
MAX_PREVIEW_CHARS = ${MAX_PYTHON_KERNEL_PREVIEW_CHARS}
MAX_CONSOLE_ENTRIES = ${MAX_PYTHON_KERNEL_CONSOLE_ENTRIES}
MAX_CONSOLE_CHARS = ${MAX_PYTHON_KERNEL_CONSOLE_CHARS}
MAX_PROTOCOL_CHARS = ${MAX_PYTHON_KERNEL_PROTOCOL_TOTAL_CHARS}
MAX_TRACED_MEMORY_BYTES = ${MAX_PYTHON_KERNEL_TRACED_MEMORY_BYTES}
MAX_AST_NODES = 20000

for limit, value in (
    (resource.RLIMIT_CPU, 30),
    (resource.RLIMIT_NPROC, 0),
    (resource.RLIMIT_FSIZE, 0),
    (resource.RLIMIT_CORE, 0),
    (resource.RLIMIT_NOFILE, 32),
):
    resource.setrlimit(limit, (value, value))

SAFE_BUILTINS = {
    name: getattr(builtins, name)
    for name in (
        "ArithmeticError", "AssertionError", "Exception", "IndexError",
        "KeyError", "LookupError", "OverflowError", "RuntimeError",
        "StopIteration", "TypeError", "ValueError", "ZeroDivisionError",
        "abs", "all", "any", "bin", "bool", "bytearray", "bytes",
        "callable", "chr", "complex", "dict", "divmod", "enumerate",
        "filter", "float", "format", "frozenset", "hash", "hex", "int",
        "isinstance", "issubclass", "iter", "len", "list", "map", "max",
        "min", "next", "oct", "ord", "pow", "print", "range", "repr",
        "reversed", "round", "set", "slice", "sorted", "str", "sum",
        "tuple", "zip",
    )
}
STATE = {"__builtins__": SAFE_BUILTINS}
INPUT_BOUND = False
PROTOCOL_STDOUT = sys.stdout
PROTOCOL_STDERR = sys.stderr
PROTOCOL_STDIN = sys.stdin
OUTPUT_CHARS = 0
tracemalloc.start()

${PYTHON_KERNEL_CODE_BRIDGE_WORKER_SOURCE}

FORBIDDEN_NODES = (
    ast.AsyncFor,
    ast.AsyncFunctionDef,
    ast.AsyncWith,
    ast.Await,
    ast.ClassDef,
    ast.Global,
    ast.GeneratorExp,
    ast.Import,
    ast.ImportFrom,
    ast.Nonlocal,
    ast.With,
    ast.Yield,
    ast.YieldFrom,
)
FORBIDDEN_ATTRIBUTES = {
    "ag_frame", "cr_frame", "f_back", "f_builtins", "f_code",
    "f_globals", "f_locals", "gi_code", "gi_frame", "tb_frame", "tb_next",
}

class Capture:
    def __init__(self):
        self.entries = []
        self.buffer = ""
        self.truncated = False

    def write(self, value):
        text = str(value)
        self.buffer += text
        while "\n" in self.buffer:
            line, self.buffer = self.buffer.split("\n", 1)
            self._append(line)
        if len(self.buffer) > MAX_CONSOLE_CHARS:
            self.buffer = self.buffer[:MAX_CONSOLE_CHARS]
            self.truncated = True
        return len(text)

    def flush(self):
        return None

    def finish(self):
        if self.buffer:
            self._append(self.buffer)
            self.buffer = ""

    def _append(self, value):
        if len(self.entries) >= MAX_CONSOLE_ENTRIES:
            self.truncated = True
            return
        if len(value) > MAX_CONSOLE_CHARS:
            self.truncated = True
        self.entries.append(value[:MAX_CONSOLE_CHARS])

def validate_tree(tree):
    count = 0
    for node in ast.walk(tree):
        count += 1
        if count > MAX_AST_NODES:
            raise ValueError("Python kernel syntax exceeds its node limit")
        if isinstance(node, FORBIDDEN_NODES):
            raise ValueError(
                "Python kernel syntax is unavailable: " + type(node).__name__
            )
        if isinstance(node, ast.Name) and node.id.startswith("_"):
            raise ValueError("Python kernel private names are unavailable")
        if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            if node.id == "napier":
                raise ValueError("Python kernel napier binding is read-only")
            if INPUT_BOUND and node.id == "input":
                raise ValueError("Python kernel input binding is read-only")
        if isinstance(node, ast.Attribute) and node.attr.startswith("_"):
            raise ValueError("Python kernel private attributes are unavailable")
        if isinstance(node, ast.Attribute) and node.attr in FORBIDDEN_ATTRIBUTES:
            raise ValueError("Python kernel frame access is unavailable")
        if (
            isinstance(node, ast.Constant)
            and isinstance(node.value, int)
            and not isinstance(node.value, bool)
            and abs(node.value) > 10000000
        ):
            raise ValueError("Python kernel integer literal exceeds its limit")
        if isinstance(node, (ast.FunctionDef, ast.Lambda)):
            decorators = getattr(node, "decorator_list", ())
            if decorators:
                raise ValueError("Python kernel decorators are unavailable")

def execute_source(source):
    tree = ast.parse(source, filename="<napier-python-kernel>", mode="exec")
    validate_tree(tree)
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        prefix = ast.Module(body=tree.body[:-1], type_ignores=[])
        if prefix.body:
            exec(compile(prefix, "<napier-python-kernel>", "exec"), STATE, STATE)
        expression = ast.Expression(body=tree.body[-1].value)
        return eval(
            compile(expression, "<napier-python-kernel>", "eval"),
            STATE,
            STATE,
        )
    exec(compile(tree, "<napier-python-kernel>", "exec"), STATE, STATE)
    return None

def memory_guard(frame, event, argument):
    del frame, event, argument
    if tracemalloc.get_traced_memory()[0] > MAX_TRACED_MEMORY_BYTES:
        PROTOCOL_STDERR.write(
            ${JSON.stringify(`${PYTHON_KERNEL_MEMORY_LIMIT_MARKER}\n`)}
        )
        PROTOCOL_STDERR.flush()
        os._exit(70)
    return memory_guard

def timeout_guard(signum, frame):
    del signum, frame
    PROTOCOL_STDERR.write(
        ${JSON.stringify(`${PYTHON_KERNEL_TIMEOUT_MARKER}\n`)}
    )
    PROTOCOL_STDERR.flush()
    os._exit(71)

def value_type(value):
    if value is None:
        return "none"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "float"
    if isinstance(value, complex):
        return "complex"
    if isinstance(value, str):
        return "string"
    if isinstance(value, bytes):
        return "bytes"
    if isinstance(value, list):
        return "list"
    if isinstance(value, tuple):
        return "tuple"
    if isinstance(value, dict):
        return "dict"
    if isinstance(value, (set, frozenset)):
        return "set"
    if isinstance(value, types.FunctionType):
        return "function"
    return "object"

def render(value, depth=0, seen=None):
    if seen is None:
        seen = set()
    if depth > 4:
        return "..."
    if value is None or isinstance(value, (bool, int, float, complex)):
        return repr(value)
    if isinstance(value, str):
        return repr(value[:1024]) + ("..." if len(value) > 1024 else "")
    if isinstance(value, bytes):
        return repr(value[:512]) + ("..." if len(value) > 512 else "")
    identity = id(value)
    if identity in seen:
        return "<cycle>"
    seen.add(identity)
    try:
        if isinstance(value, list):
            items = [render(item, depth + 1, seen) for item in value[:20]]
            if len(value) > 20:
                items.append("...")
            return "[" + ", ".join(items) + "]"
        if isinstance(value, tuple):
            items = [render(item, depth + 1, seen) for item in value[:20]]
            if len(value) > 20:
                items.append("...")
            suffix = "," if len(value) == 1 else ""
            return "(" + ", ".join(items) + suffix + ")"
        if isinstance(value, dict):
            items = []
            for index, (key, item) in enumerate(value.items()):
                if index >= 20:
                    items.append("...")
                    break
                items.append(
                    render(key, depth + 1, seen)
                    + ": "
                    + render(item, depth + 1, seen)
                )
            return "{" + ", ".join(items) + "}"
        if isinstance(value, (set, frozenset)):
            items = sorted(render(item, depth + 1, seen) for item in value)
            if len(items) > 20:
                items = items[:20] + ["..."]
            return "{" + ", ".join(items) + "}"
        if isinstance(value, types.FunctionType):
            return "<function " + value.__name__ + ">"
        return "<" + type(value).__name__ + ">"
    finally:
        seen.discard(identity)

def encode_utf16(value):
    return base64.b64encode(
        value.encode("utf-16-le", errors="surrogatepass")
    ).decode("ascii")

def response_line(payload):
    return PREFIX + json.dumps(
        payload,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )

def write_response(payload):
    global OUTPUT_CHARS
    output = response_line(payload)
    if OUTPUT_CHARS + len(output) + 1 > MAX_PROTOCOL_CHARS:
        payload = {
            "kind": "napier.python-kernel-result",
            "schemaVersion": 1,
            "id": payload["id"],
            "status": "error",
            "terminal": True,
            "valueType": "error",
            "previewUtf16Base64": encode_utf16(
                ${JSON.stringify(PYTHON_KERNEL_OUTPUT_BUDGET_EXHAUSTED)}
            ),
            "jsonValueUtf8Base64": None,
            "previewTruncated": False,
            "consoleUtf16Base64": [],
            "consoleTruncated": False,
            "durationMs": payload["durationMs"],
            "pythonVersion": payload["pythonVersion"],
            "memoryPeakBytes": payload["memoryPeakBytes"],
            "memoryLimitBytes": payload["memoryLimitBytes"],
        }
        output = response_line(payload)
    OUTPUT_CHARS += len(output) + 1
    PROTOCOL_STDOUT.write(output + "\n")
    PROTOCOL_STDOUT.flush()

def handle(line):
    global INPUT_BOUND
    try:
        request = json.loads(line)
        request_keys = set(request) if isinstance(request, dict) else set()
        base_keys = {
            "kind", "schemaVersion", "id", "codeBase64", "timeoutMs"
        }
        optional_keys = {"inputJsonBase64", "resultMode", "bridge"}
        if (
            not isinstance(request, dict)
            or not base_keys.issubset(request_keys)
            or not request_keys.issubset(base_keys | optional_keys)
            or request["kind"] != "napier.python-kernel-request"
            or request["schemaVersion"] != 1
            or not isinstance(request["id"], str)
            or not request["id"].startswith("pykernelrequest_")
            or len(request["id"]) != 36
            or not isinstance(request["codeBase64"], str)
            or not isinstance(request["timeoutMs"], int)
            or isinstance(request["timeoutMs"], bool)
            or request["timeoutMs"] < 1
            or request["timeoutMs"] > MAX_TIMEOUT_MS
            or not isinstance(request.get("bridge", False), bool)
            or (
                "inputJsonBase64" in request
                and not isinstance(request["inputJsonBase64"], str)
            )
            or request.get("resultMode", "standard")
            not in ("standard", "workflow_intermediate", "workflow_final")
        ):
            return
        code_bytes = base64.b64decode(request["codeBase64"], validate=True)
        if (
            not code_bytes
            or len(code_bytes) > MAX_CODE_BYTES
            or base64.b64encode(code_bytes).decode("ascii")
            != request["codeBase64"]
        ):
            return
        source = code_bytes.decode("utf-8", errors="strict")
    except BaseException:
        return

    started = time.monotonic()
    capture = Capture()
    previous_stdout, previous_stderr = sys.stdout, sys.stderr
    status = "ok"
    terminal = False
    value = None
    tracemalloc.reset_peak()
    begin_bridge(request["id"], request.get("bridge", False))
    try:
        sys.stdout = capture
        sys.stderr = capture
        sys.settrace(memory_guard)
        signal.signal(signal.SIGALRM, timeout_guard)
        signal.setitimer(signal.ITIMER_REAL, request["timeoutMs"] / 1000)
        if "inputJsonBase64" in request:
            if INPUT_BOUND:
                raise ValueError("Python kernel input is already bound")
            STATE["input"] = decode_json_input(request["inputJsonBase64"])
            INPUT_BOUND = True
        value = execute_source(source)
    except BaseException as error:
        status = "error"
        value = type(error).__name__ + ": " + str(error)
        if isinstance(error, (MemoryError, KeyboardInterrupt, SystemExit)):
            terminal = True
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        sys.settrace(None)
        sys.stdout = previous_stdout
        sys.stderr = previous_stderr
        end_bridge()
        capture.finish()

    memory_peak_bytes = tracemalloc.get_traced_memory()[1]
    if memory_peak_bytes > MAX_TRACED_MEMORY_BYTES:
        status = "error"
        terminal = True
        value = "MemoryError: Python kernel traced memory limit exceeded"

    active_threads = [
        thread
        for thread in threading.enumerate()
        if thread is not threading.current_thread()
    ]
    if active_threads:
        status = "error"
        terminal = True
        value = "Python kernel background threads are unavailable"

    result_mode = request.get("resultMode", "standard")
    include_presentation = result_mode == "standard" or status == "error"
    preview = (
        value
        if status == "error"
        else render(value) if include_presentation else ""
    )
    json_value_base64 = (
        encode_json_value(value)
        if status == "ok" and result_mode != "workflow_intermediate"
        else None
    )
    if not isinstance(preview, str):
        preview = str(preview)
    preview_truncated = len(preview) > MAX_PREVIEW_CHARS
    preview = preview[:MAX_PREVIEW_CHARS]
    duration_ms = max(0, int((time.monotonic() - started) * 1000))
    write_response({
        "kind": "napier.python-kernel-result",
        "schemaVersion": 1,
        "id": request["id"],
        "status": status,
        "terminal": terminal,
        "valueType": "error" if status == "error" else value_type(value),
        "previewUtf16Base64": encode_utf16(preview),
        "jsonValueUtf8Base64": json_value_base64,
        "previewTruncated": preview_truncated,
        "consoleUtf16Base64": [
            encode_utf16(entry) for entry in (
                capture.entries if include_presentation else []
            )
        ],
        "consoleTruncated": (
            capture.truncated if include_presentation else False
        ),
        "durationMs": duration_ms,
        "pythonVersion": "{}.{}.{}".format(*sys.version_info[:3]),
        "memoryPeakBytes": memory_peak_bytes,
        "memoryLimitBytes": MAX_TRACED_MEMORY_BYTES,
    })

for request_line in sys.stdin:
    handle(request_line.rstrip("\r\n"))
`;

export const PYTHON_KERNEL_WORKER_SHA256 = sha256(PYTHON_KERNEL_WORKER_SOURCE);
export const PYTHON_KERNEL_WORKER_LOADER_SOURCE =
  'import base64,sys,zlib;exec(zlib.decompress(base64.b64decode("".join(sys.argv[1:]),validate=True)).decode("utf-8"))';
export const PYTHON_KERNEL_WORKER_ARGUMENTS = Object.freeze([
  "-I",
  "-B",
  "-S",
  "-u",
  "-c",
  PYTHON_KERNEL_WORKER_LOADER_SOURCE,
  ...chunkWorkerSource(PYTHON_KERNEL_WORKER_SOURCE),
]);

function chunkWorkerSource(source: string): string[] {
  const encoded = deflateSync(Buffer.from(source, "utf8"), {
    level: 9,
  }).toString("base64");
  const chunks: string[] = [];
  for (
    let offset = 0;
    offset < encoded.length;
    offset += MAX_PYTHON_KERNEL_WORKER_ARGUMENT_CHARS
  ) {
    chunks.push(
      encoded.slice(offset, offset + MAX_PYTHON_KERNEL_WORKER_ARGUMENT_CHARS),
    );
  }
  return chunks;
}
