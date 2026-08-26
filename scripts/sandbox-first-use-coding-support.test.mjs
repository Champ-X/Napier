import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSandboxFirstUseEnvironment } from "./sandbox-first-use-coding-support.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Sandbox first-use Coding support", () => {
  it("isolates model, registry, package, and ambient Docker credentials", async () => {
    const root = path.join(
      tmpdir(),
      `napier-first-use-environment-${process.pid}-${roots.length}`,
    );
    roots.push(root);
    const environment = await createSandboxFirstUseEnvironment(
      {
        PATH: "/usr/bin",
        LANG: "C",
        DEEPSEEK_API_KEY: "model-secret",
        OPENAI_API_KEY: "model-secret",
        ANTHROPIC_API_KEY: "model-secret",
        GOOGLE_API_KEY: "model-secret",
        GEMINI_API_KEY: "model-secret",
        OPENROUTER_API_KEY: "model-secret",
        GITHUB_TOKEN: "registry-secret",
        GH_TOKEN: "registry-secret",
        NPM_TOKEN: "registry-secret",
        NODE_AUTH_TOKEN: "registry-secret",
        DOCKER_CONFIG: "/private/docker",
        DOCKER_CONTEXT: "private-context",
        DOCKER_CERT_PATH: "/private/certs",
        DOCKER_TLS_VERIFY: "1",
      },
      root,
      "unix:///local/docker.sock",
    );

    expect(environment).toEqual(
      expect.objectContaining({
        PATH: "/usr/bin",
        LANG: "C",
        CI: "true",
        DOCKER_HOST: "unix:///local/docker.sock",
      }),
    );
    for (const name of [
      "DEEPSEEK_API_KEY",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GOOGLE_API_KEY",
      "GEMINI_API_KEY",
      "OPENROUTER_API_KEY",
      "GITHUB_TOKEN",
      "GH_TOKEN",
      "NPM_TOKEN",
      "NODE_AUTH_TOKEN",
      "DOCKER_CONTEXT",
      "DOCKER_CERT_PATH",
      "DOCKER_TLS_VERIFY",
    ]) {
      expect(environment).not.toHaveProperty(name);
    }
    expect(environment.DOCKER_CONFIG).not.toBe("/private/docker");
    expect(
      await readFile(
        path.join(environment.DOCKER_CONFIG, "config.json"),
        "utf8",
      ),
    ).toBe('{"auths":{}}\n');
  });

  it("resolves required Windows environment keys case-insensitively", async () => {
    const root = path.join(
      tmpdir(),
      `napier-first-use-windows-environment-${process.pid}-${roots.length}`,
    );
    roots.push(root);
    const environment = await createSandboxFirstUseEnvironment(
      {
        Path: "C:\\Windows\\System32",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
        SystemRoot: "C:\\Windows",
      },
      root,
      "npipe:////./pipe/docker_engine",
    );

    expect(environment).toEqual(
      expect.objectContaining({
        PATH: "C:\\Windows\\System32",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
        SystemRoot: "C:\\Windows",
        DOCKER_HOST: "npipe:////./pipe/docker_engine",
      }),
    );
  });

  it("exposes only the inherited buildx executable in the empty Docker config", async () => {
    const root = path.join(
      tmpdir(),
      `napier-first-use-buildx-environment-${process.pid}-${roots.length}`,
    );
    roots.push(root);
    const inheritedDockerConfig = path.join(root, "inherited-docker");
    const inheritedPlugins = path.join(inheritedDockerConfig, "cli-plugins");
    const buildx = path.join(inheritedPlugins, "docker-buildx");
    await mkdir(inheritedPlugins, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(inheritedDockerConfig, "config.json"),
        '{"auths":{"registry.example":{"auth":"secret"}}}\n',
        { mode: 0o600 },
      ),
      writeFile(buildx, "#!/bin/sh\nexit 0\n", { mode: 0o755 }),
      writeFile(path.join(inheritedPlugins, "docker-compose"), "secret\n", {
        mode: 0o755,
      }),
    ]);

    const environment = await createSandboxFirstUseEnvironment(
      { PATH: "/usr/bin", DOCKER_CONFIG: inheritedDockerConfig },
      path.join(root, "isolated"),
      "unix:///local/docker.sock",
    );
    const isolatedPlugin = path.join(
      environment.DOCKER_CONFIG,
      "cli-plugins",
      "docker-buildx",
    );

    expect(
      await readFile(
        path.join(environment.DOCKER_CONFIG, "config.json"),
        "utf8",
      ),
    ).toBe('{"auths":{}}\n');
    expect(await readdir(environment.DOCKER_CONFIG)).toEqual([
      "cli-plugins",
      "config.json",
    ]);
    expect(await readdir(path.dirname(isolatedPlugin))).toEqual([
      "docker-buildx",
    ]);
    expect((await lstat(isolatedPlugin)).isSymbolicLink()).toBe(true);
    expect(await readlink(isolatedPlugin)).toBe(buildx);
  });
});
