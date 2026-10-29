/** Hidden/inert surfaces must not consume global keyboard events. */
export function inactiveWorkbenchSurface(element: HTMLElement | null): boolean {
  return !element || Boolean(element.closest("[hidden], [inert]"));
}

function available(element: HTMLElement | null): element is HTMLElement {
  return Boolean(
    element?.isConnected &&
    element !== document.body &&
    element !== document.documentElement &&
    !element.matches(":disabled") &&
    !inactiveWorkbenchSurface(element) &&
    element.getClientRects().length,
  );
}

/** Called after inert is released and suspended surfaces have resumed. */
export function restoreWorkbenchOverlayFocus(opener: HTMLElement | null): void {
  const navigation = document.querySelector<HTMLElement>(
    ".ledger-nav.is-mobile-open",
  );
  const evidence = document.querySelector<HTMLElement>(
    ".workspace-primary-surface.has-evidence-overlay",
  );
  const foreground = available(navigation) ? navigation : evidence;
  if (foreground) {
    if (available(opener) && foreground.contains(opener)) {
      opener.focus();
      return;
    }
    const candidates = foreground.querySelectorAll<HTMLElement>(
      ".artifact-inspector button:not([disabled]), .artifact-inspector input:not([disabled]), " +
        ".artifact-inspector textarea:not([disabled]), .workbench-browser-rail button:not([disabled]), " +
        "#workspace-evidence-rail button:not([disabled]), .ledger-nav button:not([disabled]), " +
        ".ledger-nav input:not([disabled])",
    );
    const target = Array.from(candidates).find(available);
    if (target) {
      target.focus();
      return;
    }
  }
  if (available(opener)) {
    opener.focus();
    return;
  }
  const fallback = document.getElementById("workspace-rail-toggle");
  if (available(fallback)) fallback.focus();
  else {
    const main = document.getElementById("main-workspace");
    if (available(main)) main.focus();
  }
}
