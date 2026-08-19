import type { BrowserTaskBackend } from "./browser-task-api";
import { browserTaskCopy } from "./browser-task-copy";

export interface BrowserTaskDisclosureProps {
  backend: BrowserTaskBackend;
}

export function BrowserTaskDisclosure({ backend }: BrowserTaskDisclosureProps) {
  if (backend === "browser_use_cloud") {
    const disclosure = browserTaskCopy.form.cloudDisclosure;
    return (
      <div className="browser-task-cloud-disclosure browser-task-wide">
        <strong>{disclosure.title}</strong>
        <p>{disclosure.data}</p>
        <p>{disclosure.cost}</p>
        <p>{disclosure.stop}</p>
        <label className="browser-task-cloud-consent">
          <input name="cloudConsent" type="checkbox" required />
          <span>{disclosure.consent}</span>
        </label>
      </div>
    );
  }
  const disclosure = browserTaskCopy.form.localDisclosure;
  return (
    <div className="browser-task-local-disclosure browser-task-wide">
      <strong>{disclosure.title}</strong>
      <p>{disclosure.privacy}</p>
      <p>{disclosure.controls}</p>
    </div>
  );
}
