    }
    else if (compat.thinkingFormat === "deepseek" && model.reasoning) {
        if (options?.reasoningEffort) {
            params.thinking = { type: "enabled" };
        }
        else if (model.thinkingLevelMap?.off !== null) {
            params.thinking = { type: "disabled" };
        }
        if (options?.reasoningEffort && compat.supportsReasoningEffort) {
            params.reasoning_effort =
                model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort;
        }
    }
    else if (compat.thinkingFormat === "openrouter" && model.reasoning) {
