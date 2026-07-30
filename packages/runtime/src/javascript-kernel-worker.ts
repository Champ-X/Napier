import { sha256 } from "./ed25519.js";

export const JAVASCRIPT_KERNEL_PROTOCOL_PREFIX = "NAPIER_JS_RESULT ";
export const MAX_JAVASCRIPT_KERNEL_CODE_BYTES = 16 * 1024;
export const DEFAULT_JAVASCRIPT_KERNEL_EVALUATION_TIMEOUT_MS = 1_000;
export const MAX_JAVASCRIPT_KERNEL_EVALUATION_TIMEOUT_MS = 2_000;
export const MAX_JAVASCRIPT_KERNEL_PREVIEW_CHARS = 4_096;
export const MAX_JAVASCRIPT_KERNEL_CONSOLE_ENTRIES = 12;
export const MAX_JAVASCRIPT_KERNEL_CONSOLE_CHARS = 256;
export const MAX_JAVASCRIPT_KERNEL_WORKER_ARGUMENT_CHARS = 2_048;
export const MAX_JAVASCRIPT_KERNEL_PROTOCOL_TOTAL_CHARS = 30 * 1024;
export const JAVASCRIPT_KERNEL_OUTPUT_BUDGET_EXHAUSTED =
  "JavaScript kernel output budget exhausted";
const JAVASCRIPT_KERNEL_RENDER_TIMEOUT_MS = 100;
const outputBudgetPreviewUtf16Base64 = Buffer.from(
  JAVASCRIPT_KERNEL_OUTPUT_BUDGET_EXHAUSTED,
  "utf16le",
).toString("base64");

const bridgeParts = [
  "(()=>{",
  "Object.defineProperties(globalThis,{SharedArrayBuffer:{value:undefined},Atomics:{value:undefined},FinalizationRegistry:{value:undefined},WeakRef:{value:undefined},WebAssembly:{value:undefined}});",
  "let value,logs=[],logsTruncated=false;",
  "const stringify=JSON.stringify,string=String,array=Array.isArray,cut=Function.call.bind(String.prototype.slice),tag=Function.call.bind(Object.prototype.toString),setPrototype=Object.setPrototypeOf;setPrototype(logs,null);",
  'const format=(input,limit)=>{let text;try{const type=typeof input;text=input===null?"null":type==="string"?stringify(input):type==="undefined"?"undefined":type==="bigint"?string(input)+"n":type!=="object"||tag(input)==="[object Error]"?string(input):stringify(input)}catch{text=string(input)}if(text===undefined)text=string(input);return{text:cut(text,0,limit),truncated:text.length>limit}};',
  `const capture=(...values)=>{if(logs.length>=${MAX_JAVASCRIPT_KERNEL_CONSOLE_ENTRIES}){logsTruncated=true;return}let text="";for(let index=0;index<values.length;index++){if(index>0)text+=" ";text+=format(values[index],${MAX_JAVASCRIPT_KERNEL_CONSOLE_CHARS}).text}logs[logs.length]=cut(text,0,${MAX_JAVASCRIPT_KERNEL_CONSOLE_CHARS})};`,
  'Object.defineProperty(globalThis,"console",{value:Object.freeze({log:capture,info:capture,warn:capture,error:capture})});',
  `Object.defineProperty(globalThis,"__napierKernelResult",{value:()=>{const preview=format(value,${MAX_JAVASCRIPT_KERNEL_PREVIEW_CHARS}),type=typeof value,objectLike=value!==null&&(type==="object"||type==="function"),console=[];setPrototype(console,null);for(let index=0;index<logs.length;index++)console[index]=logs[index];return{preview:preview.text,previewTruncated:preview.truncated,console,consoleTruncated:logsTruncated,promise:objectLike&&typeof value.then==="function",timedOut:objectLike&&value.code==="ERR_SCRIPT_EXECUTION_TIMEOUT",valueType:value===null?"null":array(value)?"array":type}}});`,
  "return(next,reset)=>{value=next;if(reset){logs.length=0;logsTruncated=false}}",
  "})()",
];
const bridgeSource = bridgeParts.join("");
const workerParts = [
  'const vm=require("vm"),readline=require("readline");',
  `const prefix=${JSON.stringify(JAVASCRIPT_KERNEL_PROTOCOL_PREFIX)};`,
  "let outputChars=0;",
  'const context=vm.createContext(Object.create(null),{codeGeneration:{strings:false,wasm:false},microtaskMode:"afterEvaluate"});',
  `const bridge=vm.runInContext(${JSON.stringify(bridgeSource)},context);`,
  'readline.createInterface({input:process.stdin,crlfDelay:Infinity}).on("line",line=>{',
  "let request,code;",
  `try{request=JSON.parse(line);if(!request||request.kind!=="napier.javascript-kernel-request"||request.schemaVersion!==1||!/^kernelrequest_[a-z0-9]{20}$/.test(request.id)||typeof request.codeBase64!=="string"||!Number.isSafeInteger(request.timeoutMs)||request.timeoutMs<1||request.timeoutMs>${MAX_JAVASCRIPT_KERNEL_EVALUATION_TIMEOUT_MS})throw 0;code=Buffer.from(request.codeBase64,"base64").toString("utf8");if(!code||Buffer.byteLength(code,"utf8")>${MAX_JAVASCRIPT_KERNEL_CODE_BYTES}||Buffer.from(code,"utf8").toString("base64")!==request.codeBase64)throw 0}catch{return}`,
  'const started=Date.now();bridge(undefined,true);let status="ok",terminal=false,value;',
  'try{value=vm.runInContext(code,context,{timeout:request.timeoutMs})}catch(error){status="error";value=error}',
  "bridge(value,false);let rendered;",
  `try{rendered=vm.runInContext('globalThis["__napierKernelResult"]()',context,{timeout:${JAVASCRIPT_KERNEL_RENDER_TIMEOUT_MS}})}catch{status="error";terminal=true;rendered={preview:"JavaScript kernel result rendering failed",previewTruncated:false,console:[],consoleTruncated:false,promise:false,timedOut:false,valueType:"error"}}`,
  'if(status==="error"&&rendered.timedOut)terminal=true;',
  'if(status==="ok"&&rendered.promise){status="error";terminal=true;rendered.preview="Promises are not supported";rendered.previewTruncated=false}',
  'const previewUtf16Base64=Buffer.from(rendered.preview,"utf16le").toString("base64"),consoleUtf16Base64=[];for(let index=0;index<rendered.console.length;index++)consoleUtf16Base64[index]=Buffer.from(rendered.console[index],"utf16le").toString("base64");',
  'const durationMs=Date.now()-started;let output=prefix+JSON.stringify({kind:"napier.javascript-kernel-result",schemaVersion:1,id:request.id,status,terminal,valueType:status==="error"?"error":rendered.valueType,previewUtf16Base64,previewTruncated:rendered.previewTruncated,consoleUtf16Base64,consoleTruncated:rendered.consoleTruncated,durationMs});',
  `if(outputChars+output.length+1>${MAX_JAVASCRIPT_KERNEL_PROTOCOL_TOTAL_CHARS}){status="error";terminal=true;output=prefix+JSON.stringify({kind:"napier.javascript-kernel-result",schemaVersion:1,id:request.id,status,terminal,valueType:"error",previewUtf16Base64:${JSON.stringify(outputBudgetPreviewUtf16Base64)},previewTruncated:false,consoleUtf16Base64:[],consoleTruncated:false,durationMs})}`,
  'outputChars+=output.length+1;process.stdout.write(output+"\\n")',
  "});",
];

export const JAVASCRIPT_KERNEL_WORKER_SOURCE = workerParts.join("");
export const JAVASCRIPT_KERNEL_WORKER_SHA256 = sha256(
  JAVASCRIPT_KERNEL_WORKER_SOURCE,
);
export const JAVASCRIPT_KERNEL_WORKER_LOADER_SOURCE =
  'eval(process.argv.slice(1).join(""))';
export const JAVASCRIPT_KERNEL_WORKER_ARGUMENTS = Object.freeze([
  "--max-old-space-size=64",
  "-e",
  JAVASCRIPT_KERNEL_WORKER_LOADER_SOURCE,
  "--",
  ...chunkWorkerSource(JAVASCRIPT_KERNEL_WORKER_SOURCE),
]);

function chunkWorkerSource(source: string): string[] {
  const chunks: string[] = [];
  for (
    let offset = 0;
    offset < source.length;
    offset += MAX_JAVASCRIPT_KERNEL_WORKER_ARGUMENT_CHARS
  ) {
    chunks.push(
      source.slice(
        offset,
        offset + MAX_JAVASCRIPT_KERNEL_WORKER_ARGUMENT_CHARS,
      ),
    );
  }
  return chunks;
}
