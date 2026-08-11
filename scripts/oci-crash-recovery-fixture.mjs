export const OCI_CRASH_RECOVERY_CHILD_SOURCE = String.raw`
import { pathToFileURL } from "node:url";

const runtime = await import(pathToFileURL(process.env.NAPIER_RUNTIME_ENTRY).href);
const sandbox = new runtime.OciContainerSandboxAdapter(
  process.env.NAPIER_CRASH_IMAGE_ID,
);
const source = [
  'const http=require("node:http");',
  'const server=http.createServer((request,response)=>{',
  'response.statusCode=request.url==="/__napier_crash_ready"?200:404;',
  'response.end("napier_crash_recovery_ready");',
  '});',
  'server.listen(31879,"0.0.0.0");',
].join("");
const prepared = await runtime.prepareCommandExecution(
  {
    workspaceRoot: process.env.NAPIER_CRASH_WORKSPACE,
    sandbox,
  },
  {
    runtime: "node",
    args: ["-e", source],
    timeoutMs: 120000,
  },
);
const io = runtime.bindWorkspaceProcessIo(prepared, undefined, {
  protocol: "http",
  containerPort: 31879,
  healthPath: "/__napier_crash_ready",
});
const child = await sandbox.launch(io.launch);
process.stdout.write(JSON.stringify({
  healthUrl: new URL("/__napier_crash_ready", child.localService.url).href,
  serviceIdentitySha256: child.localService.identitySha256,
}) + "\n");
await new Promise(() => {});
`;
