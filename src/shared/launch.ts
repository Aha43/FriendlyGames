// Where a normal launch of the app starts (#112).
//
// The app keeps no "last page": the address decides what opens, and the root opens Your games.
// So a launch lands on an old game only when the thing that launched it carries that game's
// address. The one such thing this app can recognise is an icon on an iPhone or iPad Home Screen
// that was added while a game was open. iOS opens such an icon as a web app (since iOS 26 every
// Home Screen icon, by default), each cold start at the address the icon was made with.
//
// Nothing else is treated as a launch. A link someone opened, a reload, coming back from the
// background, a restored browser tab and every in-app navigation keep their address.

export interface LaunchEnvironment {
  /** `location.hash` as the page loaded. */
  hash: string;
  /** iOS only: true when running as a web app from a Home Screen icon (`navigator.standalone`). */
  homeScreenWebApp: boolean;
  /** How this page load came about (Navigation Timing): only `navigate` is a fresh start. */
  navigationType: string;
  /** Whether this browsing session has already loaded the app once (survives reloads, not cold starts). */
  alreadyRunning: boolean;
}

/** Addresses that only make sense as a destination someone chose: a game or an invitation. */
const DESTINATION = /^#\/(game|join|friend)\//;

/**
 * True when this page load is the Home Screen icon starting the app at a game or invitation
 * address the icon happened to be made with: then Your games is the right place to start.
 *
 * Why this cannot be someone's explicit link: on iOS a link (from Messages, Mail, another site)
 * opens in the browser, never inside a Home Screen web app, and the web app has no address bar
 * to type or paste one into. A reload inside the web app is not a `navigate`, and the session
 * mark is still there, so it stays on the game.
 */
export function startsAtYourGames(env: LaunchEnvironment): boolean {
  return env.homeScreenWebApp && env.navigationType === 'navigate' && !env.alreadyRunning && DESTINATION.test(env.hash);
}

const SESSION_MARK = 'friendlygames.running';

/** Read the real environment, and mark this session as running. Storage that is blocked counts as not running. */
export function readLaunchEnvironment(): LaunchEnvironment {
  let alreadyRunning = false;
  try {
    alreadyRunning = window.sessionStorage.getItem(SESSION_MARK) === '1';
    window.sessionStorage.setItem(SESSION_MARK, '1');
  } catch {
    // Without session storage a reload cannot be told from a cold start by this mark; the
    // navigation type below still tells them apart.
  }
  const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
  return {
    hash: window.location.hash,
    homeScreenWebApp: (navigator as Navigator & { standalone?: boolean }).standalone === true,
    // Unknown is treated as "not a fresh start": when in doubt, keep the address.
    navigationType: entry?.type ?? 'unknown',
    alreadyRunning,
  };
}

/** Before the app renders: start a Home Screen launch on Your games (see `startsAtYourGames`). */
export function applyLaunchRoute(env: LaunchEnvironment = readLaunchEnvironment()): boolean {
  if (!startsAtYourGames(env)) return false;
  // Replace, so Back does not lead to the old game; the game itself is untouched and still listed.
  window.history.replaceState(null, '', '#/');
  return true;
}
