import type { ModelSummary, RunRecord } from "@napier/contracts";

export interface ModelSelectOption {
  key: string;
  label: string;
  configured: boolean;
  provider: string;
}

export interface ModelProviderGroup {
  provider: string;
  label: string;
  configuredCount: number;
  totalCount: number;
  options: ModelSelectOption[];
}

export interface ModelPickerOption extends ModelSelectOption {
  id: string;
  name: string;
  providerName: string;
  contextWindow: number;
  reasoning: boolean;
  vision: boolean;
}

export interface ModelPickerGroup {
  id: "recommended" | "recent" | `provider:${string}`;
  provider?: string;
  label: string;
  options: ModelPickerOption[];
}

export interface ModelPickerQuery {
  query?: string;
  showUnavailable?: boolean;
  recommendedModelKeys?: readonly string[];
  recentModelKeys?: readonly string[];
}

export interface SelectedModelAvailability {
  key: string;
  provider: string;
  id: string;
  label: string;
  configured: boolean;
  vision?: boolean;
  known: boolean;
}

export type ReviewerModelUnavailableReason =
  | "same_as_primary"
  | "demo_not_allowed"
  | "unconfigured";

export type ReviewerModelAvailability =
  | { available: true; model?: SelectedModelAvailability }
  | {
      available: false;
      model: SelectedModelAvailability;
      reason: ReviewerModelUnavailableReason;
    };

export function modelProviderGroups(
  models: readonly ModelSummary[],
): ModelProviderGroup[] {
  const groups = new Map<string, ModelSelectOption[]>();
  for (const model of models) {
    const option = modelSelectOption(model);
    groups.set(model.provider, [...(groups.get(model.provider) ?? []), option]);
  }
  return [...groups.entries()]
    .map(([provider, options]) => {
      const sortedOptions = options.sort((left, right) =>
        left.label.localeCompare(right.label),
      );
      const configuredCount = sortedOptions.filter(
        (option) => option.configured,
      ).length;
      return {
        provider,
        label: providerGroupLabel(provider, configuredCount, options.length),
        configuredCount,
        totalCount: options.length,
        options: sortedOptions,
      };
    })
    .sort(compareModelProviderGroups);
}

export function configuredModelProviderGroups(
  models: readonly ModelSummary[],
): ModelProviderGroup[] {
  return modelProviderGroups(models).flatMap((group) => {
    const options = group.options.filter((option) => option.configured);
    return options.length > 0 ? [{ ...group, options }] : [];
  });
}

export function modelPickerGroups(
  models: readonly ModelSummary[],
  {
    query = "",
    showUnavailable = false,
    recommendedModelKeys = [],
    recentModelKeys = [],
  }: ModelPickerQuery = {},
): ModelPickerGroup[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const options = models
    .filter((model) => showUnavailable || model.configured)
    .map(modelPickerOption)
    .filter((option) => matchesModelQuery(option, normalizedQuery));
  const byKey = new Map(options.map((option) => [option.key, option]));
  const claimed = new Set<string>();
  const priorityGroup = (
    id: "recommended" | "recent",
    label: string,
    keys: readonly string[],
  ): ModelPickerGroup | undefined => {
    const groupOptions = uniqueKeys(keys).flatMap((key) => {
      const option = byKey.get(key);
      if (!option || claimed.has(key)) return [];
      claimed.add(key);
      return [option];
    });
    return groupOptions.length > 0
      ? { id, label, options: groupOptions }
      : undefined;
  };
  const recommended = priorityGroup(
    "recommended",
    "Recommended",
    recommendedModelKeys,
  );
  const recent = priorityGroup("recent", "Recent", recentModelKeys);
  const providers = new Map<string, ModelPickerOption[]>();
  for (const option of options) {
    if (claimed.has(option.key)) continue;
    providers.set(option.provider, [
      ...(providers.get(option.provider) ?? []),
      option,
    ]);
  }
  const providerGroups = [...providers.entries()]
    .map(
      ([provider, providerOptions]): ModelPickerGroup => ({
        id: `provider:${provider}`,
        provider,
        label: providerOptions[0]?.providerName ?? provider,
        options: providerOptions.sort(comparePickerOptions),
      }),
    )
    .sort((left, right) => left.label.localeCompare(right.label));
  return [recommended, recent, ...providerGroups].filter(
    (group): group is ModelPickerGroup => group !== undefined,
  );
}

export function recentModelKeysFromRuns(
  runs: readonly RunRecord[],
  limit = 4,
): string[] {
  return uniqueKeys(
    runs
      .slice()
      .reverse()
      .flatMap((run) => {
        const model = run.configuration?.model;
        return model ? [`${model.provider}/${model.id}`] : [];
      }),
  ).slice(0, limit);
}

export function modelSelectOption(model: ModelSummary): ModelSelectOption {
  return {
    key: `${model.provider}/${model.id}`,
    label: `${model.provider} / ${model.name}${
      model.configured ? "" : " · unavailable"
    }`,
    configured: model.configured,
    provider: model.provider,
  };
}

export function modelPickerOption(model: ModelSummary): ModelPickerOption {
  return {
    ...modelSelectOption(model),
    id: model.id,
    name: model.name,
    providerName: model.providerName,
    contextWindow: model.contextWindow,
    reasoning: model.reasoning,
    vision: model.vision,
  };
}

export function selectedModelAvailability(
  models: readonly ModelSummary[],
  selectedKey: string,
): SelectedModelAvailability {
  const model = models.find(
    (candidate) => `${candidate.provider}/${candidate.id}` === selectedKey,
  );
  if (model) {
    return {
      key: selectedKey,
      provider: model.provider,
      id: model.id,
      label: `${model.provider} / ${model.name}`,
      configured: model.configured,
      vision: model.vision,
      known: true,
    };
  }
  const parsed = parseModelKeyParts(selectedKey);
  return {
    key: selectedKey,
    provider: parsed.provider,
    id: parsed.id,
    label: selectedKey,
    configured: false,
    vision: false,
    known: false,
  };
}

export function reviewerModelAvailability(
  models: readonly ModelSummary[],
  reviewerKey: string,
  primaryKey: string,
): ReviewerModelAvailability {
  if (!reviewerKey) return { available: true };
  const model = selectedModelAvailability(models, reviewerKey);
  if (reviewerKey === primaryKey) {
    return { available: false, model, reason: "same_as_primary" };
  }
  if (model.provider === "napier") {
    return { available: false, model, reason: "demo_not_allowed" };
  }
  if (!model.configured) {
    return { available: false, model, reason: "unconfigured" };
  }
  return { available: true, model };
}

function providerGroupLabel(
  provider: string,
  configuredCount: number,
  totalCount: number,
): string {
  return provider === "napier"
    ? "napier · built in"
    : `${provider} · ${configuredCount}/${totalCount} configured`;
}

function compareModelProviderGroups(
  left: ModelProviderGroup,
  right: ModelProviderGroup,
): number {
  const leftRank =
    left.provider === "napier" ? 0 : left.configuredCount > 0 ? 1 : 2;
  const rightRank =
    right.provider === "napier" ? 0 : right.configuredCount > 0 ? 1 : 2;
  return leftRank - rightRank || left.provider.localeCompare(right.provider);
}

function comparePickerOptions(
  left: ModelPickerOption,
  right: ModelPickerOption,
): number {
  return (
    Number(right.configured) - Number(left.configured) ||
    left.name.localeCompare(right.name)
  );
}

function matchesModelQuery(option: ModelPickerOption, query: string): boolean {
  if (!query) return true;
  return [option.name, option.id, option.provider, option.providerName]
    .join(" ")
    .toLocaleLowerCase()
    .includes(query);
}

function uniqueKeys(keys: readonly string[]): string[] {
  return [...new Set(keys.filter(Boolean))];
}

function parseModelKeyParts(key: string): { provider: string; id: string } {
  const slash = key.indexOf("/");
  if (slash <= 0 || slash === key.length - 1) {
    return { provider: "napier", id: "demo" };
  }
  return {
    provider: key.slice(0, slash),
    id: key.slice(slash + 1),
  };
}
