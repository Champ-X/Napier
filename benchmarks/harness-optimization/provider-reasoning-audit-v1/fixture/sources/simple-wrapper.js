export const streamSimple = (model, context, options) => {
    getClientApiKey(model.provider, options?.apiKey, options?.headers);
    const base = buildBaseOptions(model, context, options, options?.apiKey);
    const clampedReasoning = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined;
    const reasoningEffort = clampedReasoning === "off" ? undefined : clampedReasoning;
    const toolChoice = options?.toolChoice;
    return stream(model, context, {
        ...base,
        reasoningEffort,
        toolChoice,
    });
};
