import type { ModelSummary } from "@napier/contracts";

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

export interface SelectedModelAvailability {
  key: string;
  provider: string;
  id: string;
  label: string;
  configured: boolean;
  known: boolean;
}

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
    known: false,
  };
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
