import {
  JAVASCRIPT_KERNEL_CALL_PREFIX,
  JAVASCRIPT_KERNEL_CALL_RESULT_PREFIX,
  MAX_JAVASCRIPT_KERNEL_BRIDGE_FRAME_PAYLOAD_BYTES,
  MAX_JAVASCRIPT_KERNEL_BRIDGE_RESPONSE_FRAMES,
  MAX_JAVASCRIPT_KERNEL_BRIDGE_RESULT_BYTES,
} from "./javascript-kernel-code-bridge.js";
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
export const MAX_JAVASCRIPT_KERNEL_BRIDGE_CALLS = 8;
export const MAX_JAVASCRIPT_KERNEL_BRIDGE_WAIT_MS = 30_000;
export const JAVASCRIPT_KERNEL_OUTPUT_BUDGET_EXHAUSTED =
  "JavaScript kernel output budget exhausted";
const JAVASCRIPT_KERNEL_RENDER_TIMEOUT_MS = 100;
const MAX_BRIDGE_INPUT_JSON_CHARS = 8 * 1024;
const outputBudgetPreviewUtf16Base64 = Buffer.from(
  JAVASCRIPT_KERNEL_OUTPUT_BUDGET_EXHAUSTED,
  "utf16le",
).toString("base64");

const bridgeParts = [
  "(()=>{",
  "Object.defineProperties(globalThis,{SharedArrayBuffer:{value:undefined},Atomics:{value:undefined},FinalizationRegistry:{value:undefined},WeakRef:{value:undefined},WebAssembly:{value:undefined}});",
  "let value,logs=[],logsTruncated=false,evaluationId='',bridgeEnabled=false,nextCallId=0,calls=[],settlers=Object.create(null),waiting='idle';",
  "const stringify=JSON.stringify,string=String,array=Array.isArray,cut=Function.call.bind(String.prototype.slice),tag=Function.call.bind(Object.prototype.toString),setPrototype=Object.setPrototypeOf;setPrototype(logs,null);",
  'const format=(input,limit)=>{let text;try{const type=typeof input;text=input===null?"null":type==="string"?stringify(input):type==="undefined"?"undefined":type==="bigint"?string(input)+"n":type!=="object"||tag(input)==="[object Error]"?string(input):stringify(input)}catch{text=string(input)}if(text===undefined)text=string(input);return{text:cut(text,0,limit),truncated:text.length>limit}};',
  `const capture=(...values)=>{if(logs.length>=${MAX_JAVASCRIPT_KERNEL_CONSOLE_ENTRIES}){logsTruncated=true;return}let text="";for(let index=0;index<values.length;index++){if(index>0)text+=" ";text+=format(values[index],${MAX_JAVASCRIPT_KERNEL_CONSOLE_CHARS}).text}logs[logs.length]=cut(text,0,${MAX_JAVASCRIPT_KERNEL_CONSOLE_CHARS})};`,
  'Object.defineProperty(globalThis,"console",{value:Object.freeze({log:capture,info:capture,warn:capture,error:capture})});',
  `const napierCall=(toolId,input)=>{if(!bridgeEnabled)return Promise.reject(new Error("napier.call is not enabled for this evaluation"));if(typeof toolId!=="string"||!(/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/).test(toolId))return Promise.reject(new Error("napier.call toolId is invalid"));if(nextCallId>=${MAX_JAVASCRIPT_KERNEL_BRIDGE_CALLS})return Promise.reject(new Error("napier.call limit exceeded"));let inputJson;try{inputJson=stringify(input)}catch{return Promise.reject(new Error("napier.call input must be JSON serializable"))}if(inputJson===undefined||inputJson.length>${MAX_BRIDGE_INPUT_JSON_CHARS})return Promise.reject(new Error("napier.call input exceeded its limit"));const id=++nextCallId;calls[calls.length]=stringify({kind:"napier.javascript-kernel-call",schemaVersion:1,evaluationId,callId:id,toolId,inputJson});return new Promise((resolve,reject)=>{settlers[id]={resolve,reject}})};`,
  'const napierCapability=query=>{if(typeof query!=="string"||!query.trim())return Promise.reject(new Error("napier.capability query is invalid"));return napierCall("capability",{query}).then(result=>{const details=result&&result.details;return details&&Array.isArray(details.descriptors)?details.descriptors:[]})};',
  'Object.defineProperty(globalThis,"napier",{value:Object.freeze({call:napierCall,capability:napierCapability})});',
  `Object.defineProperty(globalThis,"__napierKernelResult",{value:()=>{const preview=format(value,${MAX_JAVASCRIPT_KERNEL_PREVIEW_CHARS}),type=typeof value,objectLike=value!==null&&(type==="object"||type==="function"),console=[];setPrototype(console,null);for(let index=0;index<logs.length;index++)console[index]=logs[index];return{preview:preview.text,previewTruncated:preview.truncated,console,consoleTruncated:logsTruncated,promise:objectLike&&typeof value.then==="function",timedOut:objectLike&&value.code==="ERR_SCRIPT_EXECUTION_TIMEOUT",valueType:value===null?"null":array(value)?"array":type}}});`,
  'return Object.freeze({setValue:(next,reset)=>{value=next;if(reset){logs.length=0;logsTruncated=false}},begin:(id,enabled)=>{evaluationId=id;bridgeEnabled=enabled;nextCallId=0;calls.length=0;settlers=Object.create(null);waiting="idle"},wait:()=>{waiting="pending";Promise.resolve(value).then(next=>{value=next;waiting="resolved"},error=>{value=error;waiting="rejected"})},state:()=>waiting,take:()=>calls.length?calls.shift():"",pending:id=>!!settlers[id],settle:(id,ok,payload)=>{const entry=settlers[id];if(!entry)return false;delete settlers[id];if(ok){let result;try{result=JSON.parse(payload)}catch(error){entry.reject(error);return true}entry.resolve(result)}else entry.reject(new Error(payload));return true}});',
  "})()",
];
const bridgeSource = bridgeParts.join("");
const workerParts = [
  'const crypto=require("crypto"),vm=require("vm"),readline=require("readline");',
  `const resultPrefix=${JSON.stringify(JAVASCRIPT_KERNEL_PROTOCOL_PREFIX)},callPrefix=${JSON.stringify(JAVASCRIPT_KERNEL_CALL_PREFIX)},callResultPrefix=${JSON.stringify(JAVASCRIPT_KERNEL_CALL_RESULT_PREFIX)};`,
  `const maxBridgeFrameBytes=${MAX_JAVASCRIPT_KERNEL_BRIDGE_FRAME_PAYLOAD_BYTES},maxBridgeFrames=${MAX_JAVASCRIPT_KERNEL_BRIDGE_RESPONSE_FRAMES},maxBridgeResultBytes=${MAX_JAVASCRIPT_KERNEL_BRIDGE_RESULT_BYTES};`,
  "let outputChars=0,active,responseFrames=Object.create(null);",
  'const context=vm.createContext(Object.create(null),{codeGeneration:{strings:false,wasm:false},microtaskMode:"afterEvaluate"});',
  `const bridge=vm.runInContext(${JSON.stringify(bridgeSource)},context);`,
  'const flushCalls=()=>{if(!active)return;let call;while((call=bridge.take()))process.stdout.write(callPrefix+call+"\\n")};',
  'const exact=(value,keys)=>{if(!value||typeof value!=="object"||Array.isArray(value))return false;const own=Object.keys(value);return own.length===keys.length&&own.every(key=>keys.includes(key))};',
  "const resetFrame=id=>{delete responseFrames[id]};",
  'const acceptBridgeFrame=line=>{let response;try{response=JSON.parse(line.slice(callResultPrefix.length))}catch{return}if(!active||!response||response.evaluationId!==active.id||!Number.isSafeInteger(response.callId)||!bridge.pending(response.callId))return;const id=response.callId;const keys=["kind","schemaVersion","evaluationId","callId","ok","frameIndex","frameCount","payloadBytes","payloadSha256","payloadEncoding","payloadBase64"];if(!exact(response,keys)||response.kind!=="napier.javascript-kernel-call-result-frame"||response.schemaVersion!==2||typeof response.ok!=="boolean"||!Number.isSafeInteger(response.frameIndex)||!Number.isSafeInteger(response.frameCount)||!Number.isSafeInteger(response.payloadBytes)||response.payloadBytes<0||response.payloadBytes>maxBridgeResultBytes||response.frameCount<1||response.frameCount>maxBridgeFrames||response.frameCount!==Math.max(1,Math.ceil(response.payloadBytes/maxBridgeFrameBytes))||response.frameIndex<0||response.frameIndex>=response.frameCount||typeof response.payloadSha256!=="string"||!(/^[a-f0-9]{64}$/).test(response.payloadSha256)||response.payloadEncoding!=="base64"||typeof response.payloadBase64!=="string"){resetFrame(id);return}let chunk;try{chunk=Buffer.from(response.payloadBase64,"base64");if(chunk.toString("base64")!==response.payloadBase64)throw 0}catch{resetFrame(id);return}const expectedBytes=response.frameIndex<response.frameCount-1?maxBridgeFrameBytes:response.payloadBytes-maxBridgeFrameBytes*(response.frameCount-1);if(chunk.length!==expectedBytes){resetFrame(id);return}let state=responseFrames[id];if(state&&response.frameIndex!==state.nextIndex){resetFrame(id);state=undefined}if(!state){if(response.frameIndex!==0)return;state={ok:response.ok,frameCount:response.frameCount,payloadBytes:response.payloadBytes,payloadSha256:response.payloadSha256,nextIndex:0,parts:[]};responseFrames[id]=state}if(response.ok!==state.ok||response.frameCount!==state.frameCount||response.payloadBytes!==state.payloadBytes||response.payloadSha256!==state.payloadSha256||response.frameIndex!==state.nextIndex){resetFrame(id);return}state.parts.push(chunk);state.nextIndex++;if(state.nextIndex!==state.frameCount)return;resetFrame(id);const payload=Buffer.concat(state.parts);if(payload.length!==state.payloadBytes||crypto.createHash("sha256").update(payload).digest("hex")!==state.payloadSha256)return;const text=payload.toString("utf8");if(!Buffer.from(text,"utf8").equals(payload))return;if(!bridge.settle(id,state.ok,text))return;vm.runInContext("0",context,{timeout:100});flushCalls()};',
  'readline.createInterface({input:process.stdin,crlfDelay:Infinity}).on("line",line=>{if(line.startsWith(callResultPrefix)){acceptBridgeFrame(line);return}if(!active)void evaluate(line)});',
  "async function evaluate(line){",
  "let request,code;",
  `try{request=JSON.parse(line);if(!request||request.kind!=="napier.javascript-kernel-request"||request.schemaVersion!==1||!/^kernelrequest_[a-z0-9]{20}$/.test(request.id)||typeof request.codeBase64!=="string"||typeof request.bridge!=="boolean"||!Number.isSafeInteger(request.timeoutMs)||request.timeoutMs<1||request.timeoutMs>${MAX_JAVASCRIPT_KERNEL_EVALUATION_TIMEOUT_MS})throw 0;code=Buffer.from(request.codeBase64,"base64").toString("utf8");if(!code||Buffer.byteLength(code,"utf8")>${MAX_JAVASCRIPT_KERNEL_CODE_BYTES}||Buffer.from(code,"utf8").toString("base64")!==request.codeBase64)throw 0}catch{return}`,
  'const started=Date.now();active={id:request.id};responseFrames=Object.create(null);bridge.begin(request.id,request.bridge);bridge.setValue(undefined,true);let status="ok",terminal=false,value;',
  'try{value=vm.runInContext(code,context,{timeout:request.timeoutMs})}catch(error){status="error";value=error}',
  "bridge.setValue(value,false);let rendered;",
  `try{rendered=vm.runInContext('globalThis["__napierKernelResult"]()',context,{timeout:${JAVASCRIPT_KERNEL_RENDER_TIMEOUT_MS}})}catch{status="error";terminal=true;rendered={preview:"JavaScript kernel result rendering failed",previewTruncated:false,console:[],consoleTruncated:false,promise:false,timedOut:false,valueType:"error"}}`,
  'if(status==="error"&&rendered.timedOut)terminal=true;',
  `if(status==="ok"&&rendered.promise&&request.bridge){bridge.wait();flushCalls();const deadline=Date.now()+${MAX_JAVASCRIPT_KERNEL_BRIDGE_WAIT_MS};while(bridge.state()==="pending"&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,1));vm.runInContext("0",context,{timeout:${JAVASCRIPT_KERNEL_RENDER_TIMEOUT_MS}});flushCalls()}if(bridge.state()==="pending"){status="error";terminal=true;bridge.setValue(new Error("JavaScript Code Bridge timed out"),false)}else if(bridge.state()==="rejected")status="error";try{rendered=vm.runInContext('globalThis["__napierKernelResult"]()',context,{timeout:${JAVASCRIPT_KERNEL_RENDER_TIMEOUT_MS}})}catch{status="error";terminal=true;rendered={preview:"JavaScript kernel result rendering failed",previewTruncated:false,console:[],consoleTruncated:false,promise:false,timedOut:false,valueType:"error"}}}`,
  'else if(status==="ok"&&rendered.promise){status="error";terminal=true;rendered.preview="Promises are not supported";rendered.previewTruncated=false}',
  'const previewUtf16Base64=Buffer.from(rendered.preview,"utf16le").toString("base64"),consoleUtf16Base64=[];for(let index=0;index<rendered.console.length;index++)consoleUtf16Base64[index]=Buffer.from(rendered.console[index],"utf16le").toString("base64");',
  'const durationMs=Date.now()-started;let output=resultPrefix+JSON.stringify({kind:"napier.javascript-kernel-result",schemaVersion:1,id:request.id,status,terminal,valueType:status==="error"?"error":rendered.valueType,previewUtf16Base64,previewTruncated:rendered.previewTruncated,consoleUtf16Base64,consoleTruncated:rendered.consoleTruncated,durationMs});',
  `if(outputChars+output.length+1>${MAX_JAVASCRIPT_KERNEL_PROTOCOL_TOTAL_CHARS}){status="error";terminal=true;output=resultPrefix+JSON.stringify({kind:"napier.javascript-kernel-result",schemaVersion:1,id:request.id,status,terminal,valueType:"error",previewUtf16Base64:${JSON.stringify(outputBudgetPreviewUtf16Base64)},previewTruncated:false,consoleUtf16Base64:[],consoleTruncated:false,durationMs})}`,
  'outputChars+=output.length+1;process.stdout.write(output+"\\n");active=undefined',
  "}",
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
