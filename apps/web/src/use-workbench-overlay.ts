import { useEffect } from "react";

/** Isolate custom overlays after their opener has been captured for restoration. */
export function useWorkbenchOverlay(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
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
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);
}
