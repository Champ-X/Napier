import type { ChangeEvent } from "react";
import { useState } from "react";

import type { CredentialReference, ModelSummary } from "@napier/contracts";

import type {
  BrowserTaskBackend,
  BrowserTaskModelProvider,
} from "./browser-task-api";
import { browserTaskCopy } from "./browser-task-copy";
import type { BrowserTaskFormDefaults } from "./browser-task-form-types";

export interface BrowserTaskModelFieldsProps {
  busy: boolean;
  backend: BrowserTaskBackend;
  defaults: BrowserTaskFormDefaults;
}

export function BrowserTaskModelFields({
  busy,
  backend,
  defaults,
}: BrowserTaskModelFieldsProps) {
  const cloud = backend === "browser_use_cloud";
  const initialProvider = cloud
    ? "browser-use"
    : defaults.defaultModel.provider;
  const [provider, setProvider] =
    useState<BrowserTaskModelProvider>(initialProvider);
  const [modelId, setModelId] = useState(
    cloud ? "browser-use-2.0" : defaults.defaultModel.id,
  );
  const initialReference = activeCredential(
    defaults.credentials,
    initialProvider,
  );
  const [credentialEnv, setCredentialEnv] = useState(
    initialReference
      ? ""
      : cloud
        ? "BROWSER_USE_API_KEY"
        : initialProvider === "openai"
          ? defaults.defaultCredentialEnv
          : credentialEnvironment(initialProvider),
  );
  const credential = activeCredential(defaults.credentials, provider);
  const modelCopy = browserTaskCopy.form.model;

  function changeProvider(event: ChangeEvent<HTMLSelectElement>): void {
    const next = event.currentTarget.value as BrowserTaskModelProvider;
    setProvider(next);
    setModelId(defaultModelId(defaults.models, next));
    setCredentialEnv(
      activeCredential(defaults.credentials, next)
        ? ""
        : credentialEnvironment(next),
    );
  }

  return (
    <>
      <label>
        <span>{modelCopy.provider}</span>
        <select
          name="provider"
          value={provider}
          disabled={busy}
          onChange={changeProvider}
        >
          {cloud ? null : <option value="openai">OpenAI</option>}
          {cloud ? null : <option value="anthropic">Anthropic</option>}
          {cloud ? null : <option value="google">Google</option>}
          <option value="browser-use">Browser Use</option>
          {cloud ? null : <option value="deepseek">DeepSeek</option>}
          {cloud ? null : <option value="openrouter">OpenRouter</option>}
        </select>
      </label>
      <label>
        <span>{modelCopy.id}</span>
        <input
          name="modelId"
          value={modelId}
          onChange={(event) => setModelId(event.currentTarget.value)}
          required
          disabled={busy}
        />
      </label>
      <div className="browser-task-credential">
        <strong>{modelCopy.credential}</strong>
        <p>
          {credential
            ? `${modelCopy.activeCredential} · ${credential.label} · ${modelCopy.availability[credential.availability]}. ${modelCopy.secretServerSide}`
            : `${provider} · ${modelCopy.noActiveCredential} ${modelCopy.addCredential}`}
        </p>
        <details
          open={
            !credential ||
            ["missing", "error"].includes(credential.availability)
          }
        >
          <summary>{modelCopy.environmentOverride}</summary>
          <label>
            <span>{modelCopy.variableName}</span>
            <input
              name="credentialEnv"
              value={credentialEnv}
              onChange={(event) => setCredentialEnv(event.currentTarget.value)}
              disabled={busy}
              autoComplete="off"
              placeholder={credentialEnvironment(provider)}
            />
          </label>
        </details>
      </div>
      <label>
        <span>{modelCopy.maximumSteps}</span>
        <input
          name="maxSteps"
          type="number"
          min={1}
          max={100}
          defaultValue={defaults.defaultMaxSteps}
          required
          disabled={busy}
        />
      </label>
      {cloud ? (
        <label>
          <span>{modelCopy.maximumCost}</span>
          <input
            name="maxCostUsd"
            type="number"
            min={0.01}
            max={100}
            step={0.01}
            defaultValue={1}
            required
            disabled={busy}
          />
        </label>
      ) : null}
    </>
  );
}

export function browserTaskModelFieldsKey(
  backend: BrowserTaskBackend,
  defaults: BrowserTaskFormDefaults,
): string {
  const credentials = defaults.credentials
    .map((credential) => `${credential.id}:${credential.revision}`)
    .sort()
    .join(",");
  return `${backend}:${defaults.defaultModel.provider}:${defaults.defaultModel.id}:${credentials}`;
}

function activeCredential(
  credentials: readonly CredentialReference[],
  provider: BrowserTaskModelProvider,
): CredentialReference | undefined {
  return credentials.find(
    (credential) =>
      credential.providerId === provider && credential.status === "active",
  );
}

function defaultModelId(
  models: readonly ModelSummary[],
  provider: BrowserTaskModelProvider,
): string {
  return (
    models.find((model) => model.provider === provider && model.configured)
      ?.id ??
    models.find((model) => model.provider === provider)?.id ??
    DEFAULT_MODEL_IDS[provider]
  );
}

const DEFAULT_MODEL_IDS: Record<BrowserTaskModelProvider, string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-haiku-4-5",
  google: "gemini-2.5-flash",
  "browser-use": "browser-use-2.0",
  deepseek: "deepseek-chat",
  openrouter: "anthropic/claude-haiku-4.5",
};

function credentialEnvironment(provider: BrowserTaskModelProvider): string {
  return {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GEMINI_API_KEY",
    "browser-use": "BROWSER_USE_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
  }[provider];
}
