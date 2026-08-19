import { browserTaskCopy } from "./browser-task-copy";

export interface BrowserTaskScopeFieldsProps {
  busy: boolean;
}

export function BrowserTaskScopeFields({ busy }: BrowserTaskScopeFieldsProps) {
  const scope = browserTaskCopy.form.scope;
  return (
    <>
      <label className="browser-task-wide">
        <span>{scope.task}</span>
        <textarea
          name="task"
          rows={3}
          required
          disabled={busy}
          placeholder={scope.taskPlaceholder}
        />
      </label>
      <label className="browser-task-wide">
        <span>{scope.startUrl}</span>
        <input
          name="startUrl"
          type="url"
          required
          disabled={busy}
          placeholder="https://example.com/releases"
        />
      </label>
      <label className="browser-task-wide">
        <span>{scope.allowedDomains}</span>
        <input
          name="allowedDomains"
          disabled={busy}
          placeholder={scope.allowedDomainsPlaceholder}
        />
      </label>
    </>
  );
}
