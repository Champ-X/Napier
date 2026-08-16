import type { KernelPluginInspection } from "@napier/contracts/kernel-plugins";

import { extensionCopy as copy } from "./extension-copy";

export default function KernelPluginDesk({
  plugins,
}: {
  plugins: KernelPluginInspection[];
}) {
  return (
    <section
      className="kernel-plugin-desk"
      aria-labelledby="kernel-plugins-title"
    >
      <header>
        <div>
          <span>{copy.plugins.eyebrow}</span>
          <h3 id="kernel-plugins-title">{copy.plugins.title}</h3>
        </div>
        <span>
          {plugins.filter((plugin) => plugin.status === "enabled").length}/
          {plugins.length}
        </span>
      </header>
      <p>{copy.plugins.body}</p>
      {plugins.length === 0 ? (
        <p className="empty-panel">{copy.plugins.empty}</p>
      ) : null}
      <div>
        {plugins.map((plugin) => (
          <article
            key={plugin.id}
            className={`kernel-plugin-card ${plugin.status}`}
          >
            <header>
              <div>
                <strong>{plugin.displayName}</strong>
                <code>
                  {plugin.id}@{plugin.version}
                </code>
              </div>
              <span>
                {plugin.status === "enabled"
                  ? copy.plugins.enabled
                  : copy.plugins.disabled}
              </span>
            </header>
            <p>{plugin.description}</p>
            <dl>
              <PluginFact
                label={copy.plugins.contributes}
                value={pluginContributions(plugin).join(" · ") || "—"}
              />
              <PluginFact
                label={copy.plugins.permissions}
                value={
                  plugin.permissions.join(" · ") || copy.plugins.noPermissions
                }
              />
              <PluginFact
                label={copy.plugins.dependencies}
                value={
                  plugin.dependencies
                    .map(
                      (dependency) =>
                        `${dependency.id} ${dependency.versionRange}`,
                    )
                    .join(" · ") || copy.plugins.noDependencies
                }
              />
              <PluginFact
                label={copy.plugins.host}
                value={plugin.hostEntry}
                code
              />
              {plugin.clientEntry ? (
                <PluginFact
                  label={copy.plugins.client}
                  value={plugin.clientEntry}
                  code
                />
              ) : null}
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function PluginFact({
  label,
  value,
  code = false,
}: {
  label: string;
  value: string;
  code?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{code ? <code>{value}</code> : value}</dd>
    </div>
  );
}

function pluginContributions(plugin: KernelPluginInspection): string[] {
  return [
    ...plugin.contributions.tools.map((item) => `tool:${item}`),
    ...plugin.contributions.providers.map((item) => `provider:${item}`),
    ...plugin.contributions.prompts.map((item) => `prompt:${item}`),
    ...plugin.contributions.projections.map((item) => `projection:${item}`),
    ...plugin.contributions.uiSlots.map((item) => `ui:${item}`),
  ];
}
