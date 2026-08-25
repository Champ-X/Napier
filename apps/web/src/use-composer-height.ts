import { useLayoutEffect } from "react";

/**
 * Publishes the composer's measured height as a CSS custom property so the
 * shell can reserve real content space beneath the scrolling conversation
 * (design §7.1 "实时高度协调"). Instead of guessing a fixed composer height in
 * CSS, a ResizeObserver mirrors the actual rendered height — rest, editing, and
 * expanded — onto the nearest shell root as `--composer-height`.
 *
 * The property is written on the closest `.app-shell` ancestor when present so
 * it stays scoped to the workspace, falling back to the document root. The
 * effect is layout-synchronous to avoid a first-paint gap and cleans the
 * property up on unmount.
 */

const COMPOSER_HEIGHT_PROPERTY = "--composer-height";

export function useComposerHeight(
  composerRef: React.RefObject<HTMLElement | null>,
): void {
  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    const target = resolveHeightTarget(composer);
    if (!target) return;

    const publishHeight = () => {
      const height = Math.round(composer.getBoundingClientRect().height);
      target.style.setProperty(COMPOSER_HEIGHT_PROPERTY, `${height}px`);
    };
    publishHeight();

    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(publishHeight);
    observer?.observe(composer);
    return () => {
      observer?.disconnect();
      target.style.removeProperty(COMPOSER_HEIGHT_PROPERTY);
    };
  }, [composerRef]);
}

function resolveHeightTarget(composer: HTMLElement): HTMLElement | undefined {
  const shell = composer.closest<HTMLElement>(".app-shell");
  if (shell) return shell;
  return composer.ownerDocument?.documentElement ?? undefined;
}
