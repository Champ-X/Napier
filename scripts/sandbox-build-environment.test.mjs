import assert from "node:assert/strict";
import { test } from "vitest";
import { dockerEnvironment } from "./sandbox-multi-architecture-live.mjs";

test("Buildx preserves explicit proxy routing while excluding model credentials", () => {
  const env = {
    DOCKER_HOST: "unix:///test/docker.sock",
    DOCKER_CONFIG: "/test/docker-config",
    PATH: "/test/bin",
    HTTPS_PROXY: "http://configured-proxy.invalid:3128",
    http_proxy: "http://configured-proxy.invalid:3128",
    NO_PROXY: "127.0.0.1,localhost",
    all_proxy: "socks5://configured-proxy.invalid:1080",
    DEEPSEEK_API_KEY: "test-placeholder-must-not-pass",
    UNRELATED_SECRET: "test-placeholder-must-not-pass",
  };
  assert.deepEqual(dockerEnvironment(true, env), {
    DOCKER_HOST: env.DOCKER_HOST,
    DOCKER_CONFIG: env.DOCKER_CONFIG,
    PATH: env.PATH,
    HTTPS_PROXY: env.HTTPS_PROXY,
    http_proxy: env.http_proxy,
    NO_PROXY: env.NO_PROXY,
    all_proxy: env.all_proxy,
  });
  assert.deepEqual(dockerEnvironment(false, env), {
    DOCKER_HOST: env.DOCKER_HOST,
    DOCKER_CONFIG: env.DOCKER_CONFIG,
    PATH: env.PATH,
  });
  assert.deepEqual(dockerEnvironment(true, {}), {});
});
