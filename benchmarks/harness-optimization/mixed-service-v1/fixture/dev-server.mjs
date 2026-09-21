import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
const backend = spawn("python3", ["-B", "-u", "backend/server.py"], {stdio:["ignore","inherit","inherit"]});
const server = createServer(async (request, response) => {
  try {
    if (request.url === "/ready" || request.url === "/api/quote") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const upstream = await fetch("http://127.0.0.1:8091" + request.url, {
        method: request.method,
        headers: {"content-type":"application/json"},
        ...(request.method === "POST" ? {body:Buffer.concat(chunks)} : {}),
        signal: AbortSignal.timeout(5000),
      });
      response.writeHead(upstream.status, {"content-type":"application/json"});
      response.end(await upstream.text());
      return;
    }
    const modules = {"/app.js":"frontend/app.ts", "/booking.js":"frontend/booking.ts"};
    if (Object.hasOwn(modules, request.url)) {
      response.writeHead(200, {"content-type":"text/javascript"});
      response.end(stripTypeScriptTypes(await readFile(modules[request.url], "utf8")));
    } else if (request.url === "/") {
      response.writeHead(200, {"content-type":"text/html"});
      response.end(await readFile("frontend/index.html"));
    } else { response.writeHead(404); response.end(); }
  } catch { response.writeHead(503); response.end("Backend not ready"); }
});
const stop = () => { backend.kill("SIGTERM"); server.close(() => process.exit(0)); };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
backend.once("error", error => { console.error(error.message); process.exit(1); });
backend.once("exit", code => { if (code) process.exit(code); });
server.listen(8090, "0.0.0.0", () => console.log("Frontend listening on 8090; GET /ready checks Python backend"));
