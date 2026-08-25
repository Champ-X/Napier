/**
 * Shared reduced-motion helper (design §7 motion, §9.4, WEB-UI-010).
 *
 * Every programmatic `scrollIntoView` must degrade to an instant jump when the
 * reader asked for reduced motion, so no JS-driven smooth scroll runs against
 * their preference. The detection is isolated here (and injectable) so the
 * behavior selection stays unit-testable without a live `matchMedia`.
 */
export type MatchMediaLike = (query: string) => { matches: boolean };

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(matchMedia?: MatchMediaLike): boolean {
  const query = matchMedia ?? resolveMatchMedia();
  if (!query) return false;
  try {
    return query(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * Resolves the scroll behavior to use for a programmatic scroll, honoring the
 * reader's reduced-motion preference.
 */
export function motionScrollBehavior(
  matchMedia?: MatchMediaLike,
): ScrollBehavior {
  return prefersReducedMotion(matchMedia) ? "auto" : "smooth";
}

function resolveMatchMedia(): MatchMediaLike | undefined {
  if (typeof window === "undefined") return undefined;
  if (typeof window.matchMedia !== "function") return undefined;
  return (query) => window.matchMedia(query);
}
