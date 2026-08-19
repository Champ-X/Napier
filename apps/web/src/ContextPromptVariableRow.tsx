import { X } from "lucide-react";

import type { PromptVariableDefinition } from "@napier/contracts";

import { contextCopy } from "./context-copy";
import {
  validPromptVariableDefinition,
  validPromptVariableLiteral,
  validPromptVariableName,
} from "./context-panel-helpers";

export interface ContextPromptVariableRowProps {
  definition: PromptVariableDefinition;
  definitions: readonly PromptVariableDefinition[];
  index: number;
  onInsert: (name: string) => void;
  onRemove: (index: number) => void;
  onReplace: (index: number, value: PromptVariableDefinition) => void;
}

function promptVariableForType(
  definition: PromptVariableDefinition,
  type: PromptVariableDefinition["type"],
): PromptVariableDefinition {
  if (type === "literal") {
    return {
      name: definition.name,
      type,
      value: contextCopy.promptVariableLiteralDefault,
    };
  }
  if (type === "current_date") {
    return { name: definition.name, type, format: "readable-date" };
  }
  return { name: definition.name, type };
}

export function ContextPromptVariableRow({
  definition,
  definitions,
  index,
  onInsert,
  onRemove,
  onReplace,
}: ContextPromptVariableRowProps) {
  const duplicateName =
    definitions.filter((candidate) => candidate.name === definition.name)
      .length > 1;
  return (
    <article
      className={`prompt-variable-row type-${definition.type}`}
      role="listitem"
      aria-invalid={!validPromptVariableDefinition(definition, definitions)}
    >
      <header>
        <span>
          {contextCopy.promptVariableIndex} {String(index + 1).padStart(2, "0")}
        </span>
        <button
          type="button"
          className="prompt-variable-token"
          disabled={!validPromptVariableName(definition.name)}
          title={contextCopy.promptVariableInsert}
          onClick={() => onInsert(definition.name)}
        >
          <code>{`{{${definition.name || contextCopy.promptVariableFallbackName}}}`}</code>
        </button>
        <button
          type="button"
          className="prompt-variable-remove"
          aria-label={`${contextCopy.promptVariableRemove}: ${definition.name}`}
          title={contextCopy.promptVariableRemove}
          onClick={() => onRemove(index)}
        >
          <X size={11} aria-hidden="true" />
        </button>
      </header>
      <div className="prompt-variable-grid">
        <label className="context-field">
          <span>{contextCopy.promptVariableName}</span>
          <input
            maxLength={64}
            value={definition.name}
            aria-invalid={
              !validPromptVariableName(definition.name) || duplicateName
            }
            placeholder={contextCopy.promptVariableNamePlaceholder}
            onChange={(event) =>
              onReplace(index, { ...definition, name: event.target.value })
            }
          />
        </label>
        <label className="context-field">
          <span>{contextCopy.promptVariableType}</span>
          <select
            value={definition.type}
            onChange={(event) =>
              onReplace(
                index,
                promptVariableForType(
                  definition,
                  event.target.value as PromptVariableDefinition["type"],
                ),
              )
            }
          >
            <option value="literal">
              {contextCopy.promptVariableTypes.literal}
            </option>
            <option value="current_date">
              {contextCopy.promptVariableTypes.current_date}
            </option>
            <option value="skill_catalog">
              {contextCopy.promptVariableTypes.skill_catalog}
            </option>
          </select>
        </label>
        <ContextPromptVariableValue
          definition={definition}
          index={index}
          onReplace={onReplace}
        />
      </div>
    </article>
  );
}

interface ContextPromptVariableValueProps {
  definition: PromptVariableDefinition;
  index: number;
  onReplace: (index: number, value: PromptVariableDefinition) => void;
}

function ContextPromptVariableValue({
  definition,
  index,
  onReplace,
}: ContextPromptVariableValueProps) {
  if (definition.type === "literal") {
    return (
      <label className="context-field prompt-variable-value">
        <span>{contextCopy.promptVariableValue}</span>
        <textarea
          rows={2}
          maxLength={2_000}
          value={definition.value}
          aria-invalid={!validPromptVariableLiteral(definition.value)}
          onChange={(event) =>
            onReplace(index, { ...definition, value: event.target.value })
          }
        />
      </label>
    );
  }
  if (definition.type === "current_date") {
    return (
      <label className="context-field prompt-variable-value">
        <span>{contextCopy.promptVariableDateFormat}</span>
        <select
          value={definition.format}
          onChange={(event) =>
            onReplace(index, {
              ...definition,
              format: event.target.value as typeof definition.format,
            })
          }
        >
          <option value="readable-date">
            {contextCopy.promptVariableDateFormats["readable-date"]}
          </option>
          <option value="iso-date">
            {contextCopy.promptVariableDateFormats["iso-date"]}
          </option>
          <option value="local-date-time">
            {contextCopy.promptVariableDateFormats["local-date-time"]}
          </option>
        </select>
      </label>
    );
  }
  return (
    <p className="prompt-variable-skill-note">
      {contextCopy.promptVariableSkillCatalogBody}
    </p>
  );
}
