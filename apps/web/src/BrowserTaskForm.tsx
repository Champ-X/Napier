import type { ChangeEvent, FormEvent } from "react";
import { useState } from "react";
import { Hand, Pause, Play, RotateCcw, Square } from "lucide-react";

import type { CredentialReference, ModelSummary } from "@napier/contracts";
import type {
  BrowserTaskBackend,
  BrowserTaskModelProvider,
} from "./browser-task-api";
import type {
  BrowserTaskFormValue,
  BrowserTaskRunner,
} from "./use-browser-task-runner";

export interface BrowserTaskFormProps {
  runner: BrowserTaskRunner;
  defaults: {
    defaultModel: {
      provider: BrowserTaskModelProvider;
      id: string;
    };
    defaultCredentialEnv: string;
    defaultMaxSteps: number;
    models: readonly ModelSummary[];
    credentials: readonly CredentialReference[];
  };
}

export function BrowserTaskForm({ runner, defaults }: BrowserTaskFormProps) {
  const [backend, setBackend] =
    useState<BrowserTaskBackend>("browser_use_local");
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void runner.start(formValue(new FormData(event.currentTarget)));
  }
  return (
    <form
      className="browser-task-form"
      aria-busy={runner.busy}
      onSubmit={submit}
    >
      <label className="browser-task-wide">
        <span>Execution backend</span>
        <select
          name="backend"
          value={backend}
          disabled={runner.busy}
          onChange={(event) =>
            setBackend(event.currentTarget.value as BrowserTaskBackend)
          }
        >
          <option value="browser_use_local">Browser Use local</option>
          <option value="browser_use_cloud">Browser Use Cloud</option>
        </select>
      </label>
      {backend === "browser_use_cloud" ? (
        <CloudDisclosure />
      ) : (
        <LocalDisclosure />
      )}
      <BrowserTaskScopeFields busy={runner.busy} />
      <BrowserTaskModelFields
        key={modelFieldsKey(backend, defaults)}
        busy={runner.busy}
        backend={backend}
        defaults={defaults}
      />
      <div className="browser-task-actions browser-task-wide">
        {runner.busy ? (
          <BrowserTaskActiveControls runner={runner} />
        ) : (
          <>
            {runner.canRetry ? (
              <button type="button" onClick={() => void runner.retry()}>
                <RotateCcw size={12} aria-hidden="true" />
                Retry same task
              </button>
            ) : null}
            <button type="submit">
              <Play size={12} fill="currentColor" aria-hidden="true" />
              Start {backend === "browser_use_cloud" ? "Cloud" : "local"} task
            </button>
          </>
        )}
        <span role="status">
          {runner.created || runner.snapshot
            ? `${(runner.created ?? runner.snapshot)!.backend} · ${runner.snapshot ? "restored history · " : runner.recovered ? "reconnected · " : ""}${runner.status}`
            : runner.status === "restoring"
              ? "Checking for an active browser task…"
              : "Native Playwright remains the default Agent backend."}
        </span>
      </div>
    </form>
  );
}

function BrowserTaskActiveControls({ runner }: { runner: BrowserTaskRunner }) {
  const started = runner.events.find(
    (
      event,
    ): event is Extract<
      import("./browser-task-api").BrowserTaskApiEvent,
      { type: "started" }
    > => event.type === "started" && event.backend === "browser_use_local",
  );
  const localControls =
    runner.created?.backend === "browser_use_local" &&
    started?.pauseAvailable === true &&
    started.takeoverAvailable === true;
  return (
    <>
      {localControls && runner.status === "running" ? (
        <button type="button" onClick={() => void runner.pause()}>
          <Pause size={12} fill="currentColor" aria-hidden="true" />
          Pause
        </button>
      ) : null}
      {localControls && ["paused", "takeover"].includes(runner.status) ? (
        <button type="button" onClick={() => void runner.resume()}>
          <Play size={12} fill="currentColor" aria-hidden="true" />
          Resume agent
        </button>
      ) : null}
      {localControls && ["running", "paused"].includes(runner.status) ? (
        <button type="button" onClick={() => void runner.takeover()}>
          <Hand size={12} aria-hidden="true" />
          Take over
        </button>
      ) : null}
      <button
        type="button"
        className="danger"
        aria-busy={runner.status === "stopping"}
        disabled={["stopping", "starting"].includes(runner.status)}
        onClick={() => void runner.stop()}
      >
        <Square size={12} fill="currentColor" aria-hidden="true" />
        {runner.status === "stopping" ? "Stopping…" : "Stop"}
      </button>
    </>
  );
}

function LocalDisclosure() {
  return (
    <div className="browser-task-local-disclosure browser-task-wide">
      <strong>Visible local browser and takeover</strong>
      <p>
        This backend opens a separate visible browser with a fresh local
        profile. Page data stays on this machine except for the selected model
        provider. Downloads, uploads, typing, secrets, purchases, publishing,
        deletion, and challenge bypass remain disabled.
      </p>
      <p>
        Pause freezes only the agent process. Take over leaves the browser
        interactive for you; Resume agent makes it re-observe your current page.
        A detected CAPTCHA enters takeover automatically. Stop closes the task
        browser and its process group.
      </p>
    </div>
  );
}

function CloudDisclosure() {
  return (
    <div className="browser-task-cloud-disclosure browser-task-wide">
      <strong>Cloud data and billing boundary</strong>
      <p>
        Browser Use receives the task, start URL, allowed domains, page data,
        and screenshots. Napier sends no workspace files or model secrets; only
        the Browser Use API key authenticates the request. The read-only policy
        forbids downloads. Napier disables recording and does not request
        profiles, proxy, workspace, skills, or secret forwarding. Provider-plan
        retention applies; zero retention is not assumed.
      </p>
      <p>
        The USD ceiling is enforced by polling reported provider cost, so usage
        can cross the ceiling between polls.
      </p>
      <p>
        Stop tears down the one-off task and session. Cloud v2 Pause and Take
        over are unavailable.
      </p>
      <label className="browser-task-cloud-consent">
        <input name="cloudConsent" type="checkbox" required />
        <span>
          I understand this task sends page data to Browser Use Cloud.
        </span>
      </label>
    </div>
  );
}

function BrowserTaskScopeFields({ busy }: { busy: boolean }) {
  return (
    <>
      <label className="browser-task-wide">
        <span>Task</span>
        <textarea
          name="task"
          rows={3}
          required
          disabled={busy}
          placeholder="Summarize the latest release notes on this site"
        />
      </label>
      <label className="browser-task-wide">
        <span>Start URL</span>
        <input
          name="startUrl"
          type="url"
          required
          disabled={busy}
          placeholder="https://example.com/releases"
        />
      </label>
      <label className="browser-task-wide">
        <span>Allowed domains</span>
        <input
          name="allowedDomains"
          disabled={busy}
          placeholder="Derived from Start URL, or comma-separated"
        />
      </label>
    </>
  );
}

function BrowserTaskModelFields({
  busy,
  backend,
  defaults,
}: {
  busy: boolean;
  backend: BrowserTaskBackend;
  defaults: BrowserTaskFormProps["defaults"];
}) {
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
        <span>Model provider</span>
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
        <span>Model ID</span>
        <input
          name="modelId"
          value={modelId}
          onChange={(event) => setModelId(event.currentTarget.value)}
          required
          disabled={busy}
        />
      </label>
      <div className="browser-task-credential">
        <strong>Credential</strong>
        <p>
          {credential
            ? `Active credential · ${credential.label} · ${credentialAvailability(credential.availability)}. The secret stays server-side.`
            : `No active ${provider} reference. Add one in Context → Credentials, or use an environment override.`}
        </p>
        <details
          open={
            !credential ||
            ["missing", "error"].includes(credential.availability)
          }
        >
          <summary>Environment override</summary>
          <label>
            <span>Variable name</span>
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
        <span>Maximum steps</span>
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
          <span>Maximum cost (USD)</span>
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

function formValue(data: FormData): BrowserTaskFormValue {
  const backend = field(data, "backend") as BrowserTaskBackend;
  if (backend === "browser_use_cloud" && !data.has("cloudConsent")) {
    throw new Error("Cloud data-flow consent is required");
  }
  return {
    backend,
    task: field(data, "task"),
    startUrl: field(data, "startUrl"),
    allowedDomains: field(data, "allowedDomains"),
    provider: field(data, "provider") as BrowserTaskModelProvider,
    modelId: field(data, "modelId"),
    credentialEnv: field(data, "credentialEnv"),
    maxSteps: Number(field(data, "maxSteps")),
    maxCostUsd:
      backend === "browser_use_cloud" ? Number(field(data, "maxCostUsd")) : 1,
  };
}

function field(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
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
    {
      openai: "gpt-4.1-mini",
      anthropic: "claude-haiku-4-5",
      google: "gemini-2.5-flash",
      "browser-use": "browser-use-2.0",
      deepseek: "deepseek-chat",
      openrouter: "anthropic/claude-haiku-4.5",
    }[provider]
  );
}

function credentialEnvironment(provider: string): string {
  return {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GEMINI_API_KEY",
    "browser-use": "BROWSER_USE_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
  }[provider as BrowserTaskModelProvider];
}

function credentialAvailability(
  availability: CredentialReference["availability"],
): string {
  return {
    unknown: "not yet checked",
    available: "available",
    missing: "missing",
    error: "needs repair",
  }[availability];
}

function modelFieldsKey(
  backend: BrowserTaskBackend,
  defaults: BrowserTaskFormProps["defaults"],
): string {
  const credentials = defaults.credentials
    .map((credential) => `${credential.id}:${credential.revision}`)
    .sort()
    .join(",");
  return `${backend}:${defaults.defaultModel.provider}:${defaults.defaultModel.id}:${credentials}`;
}
