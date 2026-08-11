import path from "node:path";

import {
  ExecutionError,
  FileError,
  loadSkills,
  type ExecutionEnv,
  type FileInfo,
  type Result,
  type ShellExecOptions,
  type Skill,
} from "@earendil-works/pi-agent-core";

const VIRTUAL_ROOT = "/project/skills";

export async function parseProjectSkillInMemory(
  skillName: string,
  text: string,
  signal?: AbortSignal,
): Promise<Skill | undefined> {
  const env = new FrozenSkillEnv(skillName, text);
  try {
    const result = await loadSkills(env, `${VIRTUAL_ROOT}/${skillName}`);
    check(signal);
    return result.diagnostics.length === 0 &&
      result.skills.length === 1 &&
      result.skills[0]?.name === skillName &&
      result.skills[0].description.trim().length > 0
      ? result.skills[0]
      : undefined;
  } finally {
    await env.cleanup();
  }
}

class FrozenSkillEnv implements ExecutionEnv {
  readonly cwd = "/project";
  private readonly dir: string;
  private readonly file: string;

  constructor(
    skillName: string,
    private readonly text: string,
  ) {
    this.dir = `${VIRTUAL_ROOT}/${skillName}`;
    this.file = `${this.dir}/SKILL.md`;
  }

  async absolutePath(
    value: string,
    signal?: AbortSignal,
  ): Promise<Result<string, FileError>> {
    return this.abort<string>(signal) ?? this.good(this.resolved(value));
  }

  async joinPath(
    parts: string[],
    signal?: AbortSignal,
  ): Promise<Result<string, FileError>> {
    return this.abort<string>(signal) ?? this.good(path.posix.join(...parts));
  }

  async readTextFile(
    value: string,
    signal?: AbortSignal,
  ): Promise<Result<string, FileError>> {
    const aborted = this.abort<string>(signal);
    if (aborted) return aborted;
    return this.resolved(value) === this.file
      ? this.good(this.text)
      : this.bad("not_found", "Memory Skill path not found");
  }

  async readTextLines(
    value: string,
    options?: { maxLines?: number; abortSignal?: AbortSignal },
  ): Promise<Result<string[], FileError>> {
    const result = await this.readTextFile(value, options?.abortSignal);
    return result.ok
      ? this.good(result.value.split(/\r?\n/u).slice(0, options?.maxLines))
      : result;
  }

  async readBinaryFile(
    value: string,
    signal?: AbortSignal,
  ): Promise<Result<Uint8Array, FileError>> {
    const result = await this.readTextFile(value, signal);
    return result.ok
      ? this.good(new TextEncoder().encode(result.value))
      : result;
  }

  async fileInfo(
    value: string,
    signal?: AbortSignal,
  ): Promise<Result<FileInfo, FileError>> {
    const aborted = this.abort<FileInfo>(signal);
    if (aborted) return aborted;
    const info = this.info(value);
    return info
      ? this.good(info)
      : this.bad("not_found", "Memory Skill path not found");
  }

  async listDir(
    value: string,
    signal?: AbortSignal,
  ): Promise<Result<FileInfo[], FileError>> {
    const aborted = this.abort<FileInfo[]>(signal);
    if (aborted) return aborted;
    const resolved = this.resolved(value);
    if (resolved === this.dir) return this.good([this.info(this.file)!]);
    if (resolved === "/project") return this.good([this.info(VIRTUAL_ROOT)!]);
    if (resolved === VIRTUAL_ROOT) return this.good([this.info(this.dir)!]);
    return this.bad("not_directory", "Memory Skill path is not a directory");
  }

  async canonicalPath(
    value: string,
    signal?: AbortSignal,
  ): Promise<Result<string, FileError>> {
    const aborted = this.abort<string>(signal);
    if (aborted) return aborted;
    const resolved = this.resolved(value);
    return this.info(resolved)
      ? this.good(resolved)
      : this.bad("not_found", "Memory Skill path not found");
  }

  async exists(
    value: string,
    signal?: AbortSignal,
  ): Promise<Result<boolean, FileError>> {
    const aborted = this.abort<boolean>(signal);
    return aborted ?? this.good(Boolean(this.info(value)));
  }

  async writeFile(): Promise<Result<void, FileError>> {
    return this.bad("permission_denied", "Memory Skill writes are denied");
  }

  async appendFile(): Promise<Result<void, FileError>> {
    return this.bad("permission_denied", "Memory Skill writes are denied");
  }

  async createDir(): Promise<Result<void, FileError>> {
    return this.bad("permission_denied", "Memory Skill writes are denied");
  }

  async remove(): Promise<Result<void, FileError>> {
    return this.bad("permission_denied", "Memory Skill writes are denied");
  }

  async createTempDir(): Promise<Result<string, FileError>> {
    return this.bad(
      "not_supported",
      "Memory Skill temporary storage is denied",
    );
  }

  async createTempFile(): Promise<Result<string, FileError>> {
    return this.bad(
      "not_supported",
      "Memory Skill temporary storage is denied",
    );
  }

  async exec(
    _command: string,
    _options?: ShellExecOptions,
  ): Promise<
    Result<{ stdout: string; stderr: string; exitCode: number }, ExecutionError>
  > {
    return {
      ok: false,
      error: new ExecutionError(
        "shell_unavailable",
        "Memory Skill shell is denied",
      ),
    };
  }

  async cleanup(): Promise<void> {}

  private abort<T>(signal?: AbortSignal): Result<T, FileError> | undefined {
    return signal?.aborted
      ? this.bad<T>("aborted", "Memory Skill read aborted")
      : undefined;
  }

  private good<T>(value: T): Result<T, FileError> {
    return { ok: true, value };
  }

  private bad<T>(
    code: ConstructorParameters<typeof FileError>[0],
    message: string,
  ): Result<T, FileError> {
    return { ok: false, error: new FileError(code, message) };
  }

  private resolved(value: string) {
    return path.posix.resolve(this.cwd, value);
  }

  private info(value: string): FileInfo | undefined {
    const resolved = this.resolved(value);
    if (resolved === this.file) {
      return {
        name: "SKILL.md",
        path: this.file,
        kind: "file",
        size: Buffer.byteLength(this.text),
        mtimeMs: 0,
      };
    }
    if (["/project", VIRTUAL_ROOT, this.dir].includes(resolved)) {
      return {
        name: path.posix.basename(resolved),
        path: resolved,
        kind: "directory",
        size: 0,
        mtimeMs: 0,
      };
    }
  }
}

function check(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Operation aborted", "AbortError");
  }
}
