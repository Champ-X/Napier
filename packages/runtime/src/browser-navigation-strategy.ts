import { BROWSER_NAVIGATION_TIMEOUT_MS } from "./browser-session-limits.js";

const DIRECT_MEDIA_NAVIGATION_TIMEOUT_MS = 12_000;
const DIRECT_RASTER_PATH = /\.(?:avif|gif|jpe?g|png|webp)$/iu;

export interface BrowserNavigationStrategy {
  directMedia: boolean;
  timeout: number;
  waitUntil: "commit" | "domcontentloaded";
}

export function browserNavigationStrategy(
  url: Pick<URL, "pathname">,
): BrowserNavigationStrategy {
  const directMedia = DIRECT_RASTER_PATH.test(decodedPath(url.pathname));
  return directMedia
    ? {
        directMedia,
        timeout: DIRECT_MEDIA_NAVIGATION_TIMEOUT_MS,
        waitUntil: "commit",
      }
    : {
        directMedia,
        timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
        waitUntil: "domcontentloaded",
      };
}

function decodedPath(value: string): string {
  try {
    return decodeURIComponent(value).replace(/\/+$/u, "");
  } catch {
    return value.replace(/\/+$/u, "");
  }
}
