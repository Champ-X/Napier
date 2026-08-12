import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function githubJson(runGh, endpoint, cwd) {
  const result = await githubCommand(
    runGh,
    [
      "api",
      "--hostname",
      "github.com",
      "--method",
      "GET",
      "--header",
      "Accept: application/vnd.github+json",
      "--header",
      "X-GitHub-Api-Version: 2022-11-28",
      endpoint,
    ],
    cwd,
  );
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("GitHub Actions response is invalid");
  }
}

export async function githubJsonWithRetry(runGh, endpoint, cwd, sleep = delay) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      return await githubJson(runGh, endpoint, cwd);
    } catch (error) {
      if (attempt === 11) throw error;
      await sleep(1_000);
    }
  }
}

export async function githubCommand(runGh, args, cwd) {
  try {
    return await runGh(args, { cwd });
  } catch {
    throw new Error("GitHub Actions command failed");
  }
}

export async function runGithubCli(args, options) {
  const { stdout, stderr } = await execFileAsync("gh", args, {
    cwd: options.cwd,
    env: commandEnvironment(),
    timeout: 120_000,
    killSignal: "SIGTERM",
    maxBuffer: 2 * 1024 * 1024,
  });
  return { stdout, stderr };
}

export async function runGitCli(args, options) {
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd: options.cwd,
    env: commandEnvironment(),
    timeout: 10_000,
    killSignal: "SIGTERM",
    maxBuffer: 64 * 1024,
  });
  return { stdout, stderr };
}

function commandEnvironment() {
  const names = [
    "APPDATA",
    "GH_CONFIG_DIR",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "HOME",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "LOCALAPPDATA",
    "NODE_EXTRA_CA_CERTS",
    "NO_PROXY",
    "PATH",
    "SSL_CERT_FILE",
    "TMPDIR",
    "USERPROFILE",
    "XDG_CONFIG_HOME",
  ];
  return Object.fromEntries([
    ...names
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]),
    ["GH_PROMPT_DISABLED", "1"],
    ["NO_COLOR", "1"],
  ]);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
