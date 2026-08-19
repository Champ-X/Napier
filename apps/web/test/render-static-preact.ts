import { parseHTML } from "linkedom";
import { render, type ComponentChildren } from "preact";

export function renderToStaticMarkup(value: ComponentChildren): string {
  const { document } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  const container = document.getElementById("app") as unknown as HTMLElement;
  const priorDocument = globalThis.document;
  Object.assign(globalThis, { document });
  try {
    render(value, container);
    const markup = container.innerHTML;
    render(null, container);
    return markup;
  } finally {
    if (priorDocument) Object.assign(globalThis, { document: priorDocument });
    else Reflect.deleteProperty(globalThis, "document");
  }
}
