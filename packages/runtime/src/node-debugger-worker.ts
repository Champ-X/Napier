import { deflateSync } from "node:zlib";

import { sha256 } from "./ed25519.js";
import { NODE_DEBUGGER_SOURCE_MAP_CONTROLLER_SOURCE } from "./node-debugger-source-map-worker.js";

export const MAX_NODE_DEBUG_SOURCE_BYTES = 1024 * 1024;
export const MAX_NODE_DEBUG_BREAKPOINTS = 16;
export const MAX_NODE_DEBUG_STACK_FRAMES = 32;
export const MAX_NODE_DEBUG_SCOPES = 8;
export const MAX_NODE_DEBUG_VARIABLES = 32;
export const MAX_NODE_DEBUG_REFERENCES = 128;
export const MAX_NODE_DEBUG_EXPRESSION_CHARS = 500;
export const MAX_NODE_DEBUG_VALUE_CHARS = 256;
export const MAX_NODE_DEBUG_OUTPUT_ENTRIES = 16;
export const MAX_NODE_DEBUG_OUTPUT_CHARS = 4_096;
export const MAX_NODE_DEBUG_OUTPUT_ENTRY_CHARS = 512;
export const MAX_NODE_DEBUG_WORKER_ARGUMENT_CHARS = 2_048;
export const NODE_DEBUGGER_PROTOCOL_FAILURE_MARKER =
  "NAPIER_DAP_PROTOCOL_FAILURE";
export const NODE_DEBUGGER_WORKER_FAILURE_MARKER = "NAPIER_DAP_WORKER_FAILURE";

const NODE_DEBUGGER_CONTROLLER_SOURCE = String.raw`
const crypto = require("node:crypto");
const fs = require("node:fs");
const inspector = require("node:inspector");
const { SourceMap } = require("node:module");
const path = require("node:path");
const { createInterface } = require("node:readline");
const { fileURLToPath, pathToFileURL } = require("node:url");
const { parentPort } = require("node:worker_threads");

const MAX_HEADER_BYTES = 512;
const MAX_MESSAGE_BYTES = 24 * 1024;
const MAX_PROTOCOL_BYTES = 30 * 1024;
const MAX_SOURCE_BYTES = ${MAX_NODE_DEBUG_SOURCE_BYTES};
const MAX_BREAKPOINTS = ${MAX_NODE_DEBUG_BREAKPOINTS};
const MAX_STACK_FRAMES = ${MAX_NODE_DEBUG_STACK_FRAMES};
const MAX_SCOPES = ${MAX_NODE_DEBUG_SCOPES};
const MAX_VARIABLES = ${MAX_NODE_DEBUG_VARIABLES};
const MAX_REFERENCES = ${MAX_NODE_DEBUG_REFERENCES};
const MAX_EXPRESSION_CHARS = ${MAX_NODE_DEBUG_EXPRESSION_CHARS};
const MAX_VALUE_CHARS = ${MAX_NODE_DEBUG_VALUE_CHARS};
const MAX_OUTPUT_ENTRIES = ${MAX_NODE_DEBUG_OUTPUT_ENTRIES};
const MAX_OUTPUT_CHARS = ${MAX_NODE_DEBUG_OUTPUT_CHARS};
const MAX_OUTPUT_ENTRY_CHARS = ${MAX_NODE_DEBUG_OUTPUT_ENTRY_CHARS};
const PROTOCOL_FAILURE = ${JSON.stringify(NODE_DEBUGGER_PROTOCOL_FAILURE_MARKER)};
const AUTH = crypto.randomBytes(16).toString("hex");
const SCOPE_TYPES = new Set(["local", "closure", "catch", "block", "script"]);

const session = new inspector.Session();
session.connectToMainThread();
let outputSeq = 1;
let outputBytes = 0;
let inputBytes = 0;
let inputCount = 0;
let inputBuffer = Buffer.alloc(0);
let inputTail = Promise.resolve();
let initialized = false;
let configured = false;
let running = false;
let paused = false;
let terminated = false;
let launch;
let targetUrl;
let activeSourceMap;
let sourceMapEntries = [];
let sourceMapSourceName;
let sourceLines = 0;
let pauseReason;
let frameSequence = 1;
let referenceSequence = 1;
let outputCount = 0;
let outputChars = 0;
let outputTruncated = false;
const breakpoints = new Map();
const frames = new Map();
const references = new Map();
const scriptUrls = new Map();
const workspaceModules = new Map();

function post(method, params = {}) {
  return new Promise((resolve, reject) => {
    session.post(method, params, (error, result) => {
      if (error) reject(error);
      else resolve(result || {});
    });
  });
}

function authenticatedBody(body) {
  return { ...(body || {}), napierAuth: AUTH };
}

function send(message) {
  const value = {
    ...message,
    seq: outputSeq++,
    body: authenticatedBody(message.body),
  };
  const body = JSON.stringify(value);
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes < 1 || bytes > MAX_MESSAGE_BYTES) failProtocol();
  const frame = "Content-Length: " + bytes + "\r\n\r\n" + body;
  outputBytes += Buffer.byteLength(frame, "utf8");
  if (outputBytes > MAX_PROTOCOL_BYTES) failProtocol();
  fs.writeSync(1, frame);
}

function respond(request, body) {
  send({
    type: "response",
    request_seq: request.seq,
    success: true,
    command: request.command,
    body,
  });
}

function rejectRequest(request, message) {
  send({
    type: "response",
    request_seq: request.seq,
    success: false,
    command: request.command,
    message,
    body: {},
  });
}

function event(name, body) {
  send({ type: "event", event: name, body });
}

function failProtocol() {
  try {
    fs.writeSync(2, PROTOCOL_FAILURE + "\n");
  } finally {
    exitController(72);
  }
}

function exitController(code) {
  try {
    session.disconnect();
  } catch {}
  parentPort.postMessage({ kind: "napier-debugger-exit", code });
  process.exit(code);
}

function exactRecord(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function requestMessage(value) {
  return (
    exactRecord(value, ["seq", "type", "command", "arguments"]) &&
    Number.isSafeInteger(value.seq) &&
    value.seq >= 1 &&
    value.type === "request" &&
    typeof value.command === "string" &&
    /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value.command) &&
    (value.arguments === undefined ||
      (value.arguments &&
        typeof value.arguments === "object" &&
        !Array.isArray(value.arguments)))
  );
}

function visibleString(value, maximum) {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  );
}

function inside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(".." + path.sep) &&
      !path.isAbsolute(relative))
  );
}

${NODE_DEBUGGER_SOURCE_MAP_CONTROLLER_SOURCE}

function resetPausedState() {
  frames.clear();
  references.clear();
  frameSequence = 1;
  referenceSequence = 1;
}

function boundedText(value, maximum = MAX_VALUE_CHARS) {
  const text = typeof value === "string" ? value : String(value || "");
  return text.slice(0, maximum);
}

function observeWorkspaceModule(url) {
  if (!launch || typeof url !== "string" || !url.startsWith("file:")) return;
  try {
    const absolute = fileURLToPath(url);
    observeWorkspaceFile(absolute);
  } catch {}
}

function observeWorkspaceFile(absolute) {
  if (!launch || !inside(absolute, launch.workspaceRoot)) return;
  const info = fs.statSync(absolute);
  if (!info.isFile() || info.size > MAX_SOURCE_BYTES) return;
  const source = fs.readFileSync(absolute);
  workspaceModules.set(path.relative(launch.workspaceRoot, absolute), {
    absolute,
    sha256: crypto.createHash("sha256").update(source).digest("hex"),
  });
}

function moduleSnapshot() {
  const entries = [];
  let stable = true;
  for (const [relative, observed] of [...workspaceModules.entries()].sort(
    (left, right) => left[0].localeCompare(right[0]),
  )) {
    let current;
    try {
      const source = fs.readFileSync(observed.absolute);
      current = crypto.createHash("sha256").update(source).digest("hex");
    } catch {
      current = "";
    }
    if (current !== observed.sha256) stable = false;
    entries.push({ path: relative, sha256: observed.sha256 });
  }
  return {
    moduleCount: entries.length,
    moduleSetSha256: crypto
      .createHash("sha256")
      .update(JSON.stringify(entries))
      .digest("hex"),
    stable,
  };
}

function emitModuleSnapshot() {
  event("napierModuleSnapshot", moduleSnapshot());
}

function stackFrame(frame) {
  const frameId = frameSequence++;
  frames.set(frameId, frame);
  const location = frameLocation(frame);
  if (!location) throw new Error("Workspace frame location is unavailable");
  return {
    id: frameId,
    name: boundedText(frame.functionName || "(anonymous)", 120),
    source: location.source,
    line: location.line,
    column: location.column,
  };
}

function referenceFor(objectId) {
  if (!objectId || references.size >= MAX_REFERENCES) return 0;
  const reference = referenceSequence++;
  references.set(reference, objectId);
  return reference;
}

function remoteValue(remote) {
  if (!remote || typeof remote !== "object") {
    return { result: "undefined", type: "undefined", variablesReference: 0 };
  }
  let result;
  if (typeof remote.unserializableValue === "string") {
    result = remote.unserializableValue;
  } else if (
    Object.prototype.hasOwnProperty.call(remote, "value") &&
    (remote.value === null || typeof remote.value !== "object")
  ) {
    result =
      typeof remote.value === "string"
        ? JSON.stringify(remote.value)
        : String(remote.value);
  } else {
    result = remote.description || remote.subtype || remote.type || "object";
  }
  return {
    result: boundedText(result),
    type: boundedText(remote.subtype || remote.type || "unknown", 40),
    variablesReference: referenceFor(remote.objectId),
  };
}

function clearExecutionState() {
  paused = false;
  pauseReason = undefined;
  resetPausedState();
}

async function configureOutputCapture() {
  const binding = "__napierDebugOutput_" + crypto.randomBytes(8).toString("hex");
  await post("Runtime.addBinding", { name: binding });
  session.on("Runtime.bindingCalled", ({ params }) => {
    if (params.name !== binding || typeof params.payload !== "string") return;
    let payload;
    try {
      payload = JSON.parse(params.payload);
    } catch {
      return;
    }
    if (
      !exactRecord(payload, ["stream", "text"]) ||
      !["stdout", "stderr"].includes(payload.stream) ||
      typeof payload.text !== "string"
    ) {
      return;
    }
    if (outputTruncated) return;
    const remaining = MAX_OUTPUT_CHARS - outputChars;
    const text = payload.text.slice(
      0,
      Math.min(MAX_OUTPUT_ENTRY_CHARS, Math.max(0, remaining)),
    );
    if (text) {
      outputCount += 1;
      outputChars += text.length;
      event("output", { category: payload.stream, output: text });
    }
    if (
      payload.text.length > text.length ||
      outputCount >= MAX_OUTPUT_ENTRIES ||
      outputChars >= MAX_OUTPUT_CHARS
    ) {
      outputTruncated = true;
      event("output", {
        category: "console",
        output: "[debug target output truncated]",
        napierTruncated: true,
      });
    }
  });
  const expression =
    "(() => {" +
    "const emit=globalThis[" +
    JSON.stringify(binding) +
    "];" +
    "const capture=(stream)=>(chunk,encoding,callback)=>{" +
    "let text;try{text=typeof chunk==='string'?chunk:Buffer.isBuffer(chunk)?chunk.toString(typeof encoding==='string'?encoding:'utf8'):String(chunk)}catch{text='[unavailable output]'}" +
    "try{emit(JSON.stringify({stream,text}))}catch{}" +
    "if(typeof encoding==='function')encoding();else if(typeof callback==='function')callback();" +
    "return true};" +
    "process.stdout.write=capture('stdout');process.stderr.write=capture('stderr');" +
    "})()";
  const configuredCapture = await post("Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  if (configuredCapture.exceptionDetails) {
    throw new Error("Debug output capture could not be configured");
  }
}

session.on("Debugger.scriptParsed", ({ params }) => {
  if (
    typeof params.scriptId === "string" &&
    typeof params.url === "string" &&
    params.url
  ) {
    scriptUrls.set(params.scriptId, params.url);
    observeWorkspaceModule(params.url);
  }
});

session.on("Debugger.paused", ({ params }) => {
  if (terminated) return;
  const workspaceFrames = params.callFrames.filter((frame) =>
    frameLocation(frame),
  );
  const hitBreakpoints = Array.isArray(params.hitBreakpoints)
    ? params.hitBreakpoints
    : [];
  if (workspaceFrames.length === 0) {
    void post("Debugger.resume").catch(failProtocol);
    return;
  }
  if (
    hitBreakpoints.length > 0 &&
    !hitBreakpoints.some((breakpointId) => {
      const requested = breakpoints.get(breakpointId);
      return workspaceFrames.some(
        (frame) => frameLocation(frame)?.line === requested?.line,
      );
    })
  ) {
    void post("Debugger.resume").catch(failProtocol);
    return;
  }
  clearExecutionState();
  paused = true;
  pauseReason =
    params.reason === "exception"
      ? "exception"
      : params.reason === "debugCommand"
        ? "pause"
        : hitBreakpoints.length > 0
          ? "breakpoint"
          : "step";
  for (const frame of workspaceFrames.slice(0, MAX_STACK_FRAMES)) {
    stackFrame(frame);
  }
  emitModuleSnapshot();
  event("stopped", {
    reason: pauseReason,
    threadId: 1,
    allThreadsStopped: true,
    ...(params.reason === "exception"
      ? { description: "Target paused on an exception" }
      : {}),
  });
});

session.on("Debugger.resumed", () => {
  if (terminated) return;
  clearExecutionState();
});

async function initialize(request) {
  if (initialized) throw new Error("DAP is already initialized");
  initialized = true;
  respond(request, {
    supportsConfigurationDoneRequest: true,
    supportsEvaluateForHovers: true,
    supportsSetVariable: false,
    supportsStepBack: false,
    supportsTerminateRequest: false,
  });
  event("initialized", {});
}

async function launchRequest(request) {
  if (!initialized || launch) throw new Error("DAP launch state is invalid");
  launch = validateLaunch(request.arguments);
  targetUrl = pathToFileURL(launch.program).href;
  activeSourceMap = launch.sourceMap;
  sourceMapEntries = launch.sourceMapEntries || [];
  sourceMapSourceName = launch.sourceMapSourceName;
  sourceLines = launch.source.split("\n").length;
  observeWorkspaceFile(launch.sourceTarget);
  observeWorkspaceFile(launch.program);
  if (launch.sourceMapTarget) observeWorkspaceFile(launch.sourceMapTarget);
  await post("Runtime.enable");
  await post("Debugger.enable");
  await configureOutputCapture();
  const argvExpression =
    "process.argv=" +
    JSON.stringify([process.execPath, launch.program, ...launch.args]);
  const argvResult = await post("Runtime.evaluate", {
    expression: argvExpression,
    returnByValue: true,
  });
  if (argvResult.exceptionDetails) {
    throw new Error("Debug target arguments could not be configured");
  }
  respond(request, {
    sourceSha256: launch.sourceSha256,
    sourcePath: launch.sourcePath,
    programSha256: launch.programSha256,
    programPath: launch.programPath,
    sourceMapMode: launch.sourceMapMode,
    ...(launch.sourceMapMode === "external"
      ? {
          sourceMapSha256: launch.sourceMapSha256,
          sourceMapPath: launch.sourceMapPath,
        }
      : {}),
    nodeVersion: process.versions.node,
  });
}

async function setExceptionBreakpoints(request) {
  if (
    !launch ||
    configured ||
    !exactRecord(request.arguments, ["filters"]) ||
    !Array.isArray(request.arguments.filters) ||
    request.arguments.filters.length > 1 ||
    request.arguments.filters.some(
      (filter) => !["uncaught", "all"].includes(filter),
    )
  ) {
    throw new Error("DAP exception breakpoints are invalid");
  }
  await post("Debugger.setPauseOnExceptions", {
    state:
      request.arguments.filters[0] === "all"
        ? "all"
        : request.arguments.filters[0] === "uncaught"
          ? "uncaught"
          : "none",
  });
  respond(request, {});
}

async function setBreakpoints(request) {
  if (!launch || configured) {
    throw new Error("DAP breakpoint state is invalid");
  }
  const argumentsValue = request.arguments;
  if (
    !exactRecord(argumentsValue, ["source", "breakpoints"]) ||
    !exactRecord(argumentsValue.source, ["path"]) ||
    argumentsValue.source.path !== launch.sourcePath ||
    !Array.isArray(argumentsValue.breakpoints) ||
    argumentsValue.breakpoints.length < 1 ||
    argumentsValue.breakpoints.length > MAX_BREAKPOINTS
  ) {
    throw new Error("DAP breakpoints are invalid");
  }
  for (const breakpointId of breakpoints.keys()) {
    await post("Debugger.removeBreakpoint", { breakpointId }).catch(() => {});
  }
  breakpoints.clear();
  const values = [];
  const seen = new Set();
  for (const [index, breakpoint] of argumentsValue.breakpoints.entries()) {
    if (
      !exactRecord(breakpoint, ["line", "column"]) ||
      !Number.isSafeInteger(breakpoint.line) ||
      breakpoint.line < 1 ||
      breakpoint.line > sourceLines ||
      (breakpoint.column !== undefined &&
        (!Number.isSafeInteger(breakpoint.column) ||
          breakpoint.column < 1 ||
          breakpoint.column > 10_000))
    ) {
      throw new Error("DAP breakpoint location is invalid");
    }
    const key = breakpoint.line + ":" + (breakpoint.column || 1);
    if (seen.has(key)) throw new Error("DAP breakpoints must be unique");
    seen.add(key);
    const generated = generatedLocationForBreakpoint(breakpoint);
    const result = await post("Debugger.setBreakpointByUrl", {
      url: targetUrl,
      lineNumber: generated.lineNumber,
      columnNumber: generated.columnNumber,
    });
    breakpoints.set(result.breakpointId, breakpoint);
    values.push({
      id: index + 1,
      verified: true,
      line: breakpoint.line,
      column: breakpoint.column || 1,
      source: {
        name: path.basename(launch.sourcePath),
        path: launch.sourcePath,
        sourceReference: 0,
      },
    });
  }
  respond(request, { breakpoints: values });
}

async function configurationDone(request) {
  if (!launch || configured || breakpoints.size < 1) {
    throw new Error("DAP configuration state is invalid");
  }
  configured = true;
  running = true;
  respond(request, {});
  void runTarget();
}

async function runTarget() {
  try {
    const result = await post("Runtime.evaluate", {
      expression: "require(" + JSON.stringify(launch.program) + ")",
      awaitPromise: true,
      generatePreview: false,
    });
    if (terminated) return;
    running = false;
    const failed = Boolean(result.exceptionDetails);
    emitModuleSnapshot();
    event("exited", { exitCode: failed ? 1 : 0 });
    event("terminated", { restart: false });
    terminated = true;
    exitController(failed ? 1 : 0);
  } catch {
    if (terminated) return;
    running = false;
    emitModuleSnapshot();
    event("exited", { exitCode: 1 });
    event("terminated", { restart: false });
    terminated = true;
    exitController(1);
  }
}

async function threads(request) {
  if (!launch || terminated) throw new Error("DAP session is unavailable");
  respond(request, { threads: [{ id: 1, name: "main" }] });
}

async function verifyModules(request) {
  if (!launch || !paused || terminated) {
    throw new Error("DAP module verification state is invalid");
  }
  respond(request, moduleSnapshot());
}

async function stackTrace(request) {
  if (!paused) throw new Error("Debug target is not paused");
  const argumentsValue = request.arguments || {};
  if (
    !exactRecord(argumentsValue, ["threadId", "startFrame", "levels"]) ||
    argumentsValue.threadId !== 1
  ) {
    throw new Error("DAP stack request is invalid");
  }
  const allFrames = [...frames.entries()].map(([id, frame]) => {
    const location = frameLocation(frame);
    if (!location) throw new Error("Workspace frame location is unavailable");
    return {
      id,
      name: boundedText(frame.functionName || "(anonymous)", 120),
      source: location.source,
      line: location.line,
      column: location.column,
    };
  });
  const start = Number.isSafeInteger(argumentsValue.startFrame)
    ? Math.max(0, argumentsValue.startFrame)
    : 0;
  const levels = Number.isSafeInteger(argumentsValue.levels)
    ? Math.max(0, Math.min(MAX_STACK_FRAMES, argumentsValue.levels))
    : MAX_STACK_FRAMES;
  respond(request, {
    stackFrames: allFrames.slice(start, start + levels),
    totalFrames: allFrames.length,
    reason: pauseReason,
  });
}

async function scopes(request) {
  if (
    !paused ||
    !exactRecord(request.arguments, ["frameId"]) ||
    !Number.isSafeInteger(request.arguments.frameId)
  ) {
    throw new Error("DAP scopes request is invalid");
  }
  const frame = frames.get(request.arguments.frameId);
  if (!frame) throw new Error("DAP frame is unavailable");
  const values = [];
  for (const scope of frame.scopeChain) {
    if (
      values.length >= MAX_SCOPES ||
      !SCOPE_TYPES.has(scope.type) ||
      !scope.object ||
      !scope.object.objectId
    ) {
      continue;
    }
    const reference = referenceFor(scope.object.objectId);
    if (!reference) continue;
    values.push({
      name: scope.name
        ? boundedText(scope.name, 80)
        : scope.type === "local"
          ? "Local"
          : boundedText(scope.type, 80),
      variablesReference: reference,
      expensive: false,
      presentationHint: scope.type,
    });
  }
  respond(request, { scopes: values });
}

async function variables(request) {
  if (
    !paused ||
    !exactRecord(request.arguments, ["variablesReference"]) ||
    !Number.isSafeInteger(request.arguments.variablesReference)
  ) {
    throw new Error("DAP variables request is invalid");
  }
  const objectId = references.get(request.arguments.variablesReference);
  if (!objectId) throw new Error("DAP variables reference is unavailable");
  const result = await post("Runtime.getProperties", {
    objectId,
    ownProperties: true,
    accessorPropertiesOnly: false,
    generatePreview: false,
  });
  const values = [];
  for (const property of (result.result || []).slice(0, MAX_VARIABLES)) {
    if (!visibleString(property.name, 200)) continue;
    const rendered = property.value
      ? remoteValue(property.value)
      : { result: "<accessor>", type: "accessor", variablesReference: 0 };
    values.push({
      name: property.name,
      value: rendered.result,
      type: rendered.type,
      variablesReference: rendered.variablesReference,
    });
  }
  respond(request, {
    variables: values,
    truncated: (result.result || []).length > MAX_VARIABLES,
  });
}

async function evaluate(request) {
  if (
    !paused ||
    !exactRecord(request.arguments, ["expression", "frameId", "context"]) ||
    !visibleString(request.arguments.expression, MAX_EXPRESSION_CHARS) ||
    !Number.isSafeInteger(request.arguments.frameId) ||
    !["watch", "hover", "repl"].includes(request.arguments.context)
  ) {
    throw new Error("DAP evaluate request is invalid");
  }
  const frame = frames.get(request.arguments.frameId);
  if (!frame) throw new Error("DAP frame is unavailable");
  const result = await post("Debugger.evaluateOnCallFrame", {
    callFrameId: frame.callFrameId,
    expression: request.arguments.expression,
    silent: true,
    returnByValue: false,
    generatePreview: false,
    throwOnSideEffect: true,
    timeout: 250,
  });
  if (result.exceptionDetails) {
    rejectRequest(request, "Expression could not be evaluated without side effects");
    return;
  }
  respond(request, remoteValue(result.result));
}

async function resumeRequest(request, method) {
  if (!paused) throw new Error("Debug target is not paused");
  respond(
    request,
    request.command === "continue" ? { allThreadsContinued: true } : {},
  );
  event("continued", { threadId: 1, allThreadsContinued: true });
  clearExecutionState();
  await post(method);
}

async function pauseRequest(request) {
  if (!running || paused || terminated) {
    throw new Error("Debug target is not running");
  }
  respond(request, {});
  await post("Debugger.pause");
}

async function disconnect(request) {
  respond(request, {});
  terminated = true;
  if (paused) await post("Debugger.resume").catch(() => {});
  exitController(0);
}

async function handle(request) {
  try {
    switch (request.command) {
      case "initialize":
        await initialize(request);
        return;
      case "launch":
        await launchRequest(request);
        return;
      case "setBreakpoints":
        await setBreakpoints(request);
        return;
      case "setExceptionBreakpoints":
        await setExceptionBreakpoints(request);
        return;
      case "configurationDone":
        await configurationDone(request);
        return;
      case "threads":
        await threads(request);
        return;
      case "napierVerifyModules":
        await verifyModules(request);
        return;
      case "stackTrace":
        await stackTrace(request);
        return;
      case "scopes":
        await scopes(request);
        return;
      case "variables":
        await variables(request);
        return;
      case "evaluate":
        await evaluate(request);
        return;
      case "continue":
        await resumeRequest(request, "Debugger.resume");
        return;
      case "next":
        await resumeRequest(request, "Debugger.stepOver");
        return;
      case "stepIn":
        await resumeRequest(request, "Debugger.stepInto");
        return;
      case "stepOut":
        await resumeRequest(request, "Debugger.stepOut");
        return;
      case "pause":
        await pauseRequest(request);
        return;
      case "disconnect":
        await disconnect(request);
        return;
      default:
        rejectRequest(request, "DAP command is unavailable");
    }
  } catch {
    rejectRequest(request, "DAP request failed");
  }
}

function parseInput() {
  while (inputBuffer.byteLength > 0) {
    const boundary = inputBuffer.indexOf("\r\n\r\n");
    if (boundary < 0) {
      if (inputBuffer.byteLength > MAX_HEADER_BYTES) failProtocol();
      return;
    }
    if (boundary > MAX_HEADER_BYTES) failProtocol();
    const header = inputBuffer.subarray(0, boundary).toString("ascii");
    const match = /^Content-Length: ([1-9]\d*)$/.exec(header);
    if (!match) failProtocol();
    const bodyBytes = Number(match[1]);
    if (
      !Number.isSafeInteger(bodyBytes) ||
      bodyBytes < 1 ||
      bodyBytes > MAX_MESSAGE_BYTES
    ) {
      failProtocol();
    }
    const end = boundary + 4 + bodyBytes;
    if (inputBuffer.byteLength < end) return;
    const body = inputBuffer.subarray(boundary + 4, end).toString("utf8");
    if (Buffer.byteLength(body, "utf8") !== bodyBytes) failProtocol();
    let request;
    try {
      request = JSON.parse(body);
    } catch {
      failProtocol();
    }
    if (!requestMessage(request)) failProtocol();
    inputCount += 1;
    if (inputCount > 64) failProtocol();
    inputTail = inputTail.then(() => handle(request)).catch(failProtocol);
    inputBuffer = inputBuffer.subarray(end);
  }
}

fs.createReadStream(null, { fd: 0, autoClose: false }).on("data", (chunk) => {
  inputBytes += chunk.byteLength;
  if (inputBytes > MAX_PROTOCOL_BYTES) failProtocol();
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  if (inputBuffer.byteLength > MAX_MESSAGE_BYTES + MAX_HEADER_BYTES) {
    failProtocol();
  }
  parseInput();
});

setInterval(() => {}, 1_000);
`;

export const NODE_DEBUGGER_WORKER_SOURCE = [
  'const { Worker } = require("node:worker_threads");',
  `const marker=${JSON.stringify(NODE_DEBUGGER_WORKER_FAILURE_MARKER)};`,
  `const controller=${JSON.stringify(NODE_DEBUGGER_CONTROLLER_SOURCE)};`,
  "const worker=new Worker(controller,{eval:true});",
  'worker.on("error",()=>{try{process.stderr.write(marker+"\\n")}finally{process.exit(73)}});',
  'worker.on("message",message=>{if(message&&message.kind==="napier-debugger-exit"&&Number.isInteger(message.code))process.exit(message.code)});',
  'worker.on("exit",code=>{if(code!==0)process.exit(code)});',
  "setInterval(()=>{},1000);",
].join("");

export const NODE_DEBUGGER_WORKER_SHA256 = sha256(NODE_DEBUGGER_WORKER_SOURCE);
export const NODE_DEBUGGER_WORKER_LOADER_SOURCE =
  'const z=require("node:zlib");eval(z.inflateSync(Buffer.from(process.argv.slice(1).join(""),"base64")).toString("utf8"))';
export const NODE_DEBUGGER_WORKER_ARGUMENTS = Object.freeze([
  "--max-old-space-size=128",
  "-e",
  NODE_DEBUGGER_WORKER_LOADER_SOURCE,
  "--",
  ...chunkWorkerSource(NODE_DEBUGGER_WORKER_SOURCE),
]);

function chunkWorkerSource(source: string): string[] {
  const encoded = deflateSync(Buffer.from(source, "utf8"), {
    level: 9,
  }).toString("base64");
  const chunks: string[] = [];
  for (
    let offset = 0;
    offset < encoded.length;
    offset += MAX_NODE_DEBUG_WORKER_ARGUMENT_CHARS
  ) {
    chunks.push(
      encoded.slice(offset, offset + MAX_NODE_DEBUG_WORKER_ARGUMENT_CHARS),
    );
  }
  return chunks;
}
