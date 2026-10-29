import { useEffect, useRef, type RefObject } from "react";

import { restoreWorkbenchOverlayFocus } from "./workbench-overlay-focus";

/** Isolate custom overlays after their opener has been captured for restoration. */
export function useWorkbenchOverlay(
  open: boolean,
  returnFocusRef: RefObject<HTMLElement | null>,
): void {
  const currentOpen = useRef(open);
  const overlayGeneration = useRef(0);
  currentOpen.current = open;
  useEffect(() => {
    if (!open) return;
    const generation = ++overlayGeneration.current;
    const opener = returnFocusRef.current;
    const surfaces = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".workspace-navigation-shell, #main-workspace",
      ),
    );
    const previous = surfaces.map((surface) => surface.inert);
    for (const surface of surfaces) surface.inert = true;
    return () => {
      surfaces.forEach((surface, index) => {
        surface.inert = previous[index] ?? false;
      });
      // Rail layout effects may run while the old main is still inert. Restore
      // only after the entire overlay transition has released its isolation.
      requestAnimationFrame(() => {
        if (!currentOpen.current && generation === overlayGeneration.current)
          restoreWorkbenchOverlayFocus(opener);
      });
    };
  }, [open, returnFocusRef]);
}
