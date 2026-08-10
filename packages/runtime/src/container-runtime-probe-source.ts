const PYTHON_RUNTIME_PROBE_SOURCE = [
  "import ast,base64,builtins,json,os,resource,signal,sys,threading,time,tracemalloc,types,zlib",
  'print(json.dumps({"executable":os.path.realpath(sys.executable),"version":".".join(str(value) for value in sys.version_info[:3])}))',
].join("\n");

export const CONTAINER_RUNTIME_IDENTITY_SOURCE = String.raw`
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const identity = (file) => { const executable = fs.realpathSync(file); return { executable, executableSha256: hash(executable) }; };
let shell = null;
try { shell = identity("/bin/sh"); } catch {}
let git = null;
const gitCandidates = [...new Set([
  "/usr/bin/git",
  "/usr/local/bin/git",
  "/opt/homebrew/bin/git",
  ...(process.env.PATH || "/usr/local/bin:/usr/bin:/bin").split(path.delimiter).filter(path.isAbsolute).map((directory) => path.join(directory, "git")),
])];
for (const candidate of gitCandidates) {
  try {
    const result = childProcess.spawnSync(candidate, ["--version"], {
      encoding: "utf8",
      env: { CI: "1", LANG: "C", LC_ALL: "C", NO_COLOR: "1" },
      timeout: 2000,
      maxBuffer: 512,
      windowsHide: true,
    });
    if (result.status !== 0) continue;
    const version = result.stdout.trim();
    if (!/^git version [^\u0000-\u001f\u007f]{1,160}$/.test(version)) continue;
    git = { ...identity(candidate), version };
    break;
  } catch {}
}
let python = null;
for (const candidate of ["/usr/local/bin/python3", "/usr/bin/python3", "/opt/conda/bin/python3", "python3"]) {
  try {
    const result = childProcess.spawnSync(candidate, ["-I", "-B", "-S", "-c", ${JSON.stringify(PYTHON_RUNTIME_PROBE_SOURCE)}], {
      encoding: "utf8",
      env: {
        CI: "1",
        LANG: "C",
        LC_ALL: "C",
        PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONHASHSEED: "0",
        PYTHONNOUSERSITE: "1",
      },
      timeout: 2000,
      maxBuffer: 2048,
      windowsHide: true,
    });
    if (result.status !== 0) continue;
    const observed = JSON.parse(result.stdout);
    if (typeof observed.executable !== "string" || typeof observed.version !== "string") continue;
    python = { ...identity(observed.executable), version: observed.version };
    break;
  } catch {}
}
process.stdout.write(JSON.stringify({ node: identity(process.execPath), shell, git, python }));
`;
