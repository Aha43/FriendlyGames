// Where a launch starts (#112): only a Home Screen icon's cold start at a game or invitation
// address is sent to Your games. Everything else keeps its address.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyLaunchRoute, readLaunchEnvironment, startsAtYourGames, type LaunchEnvironment } from './launch';

const GAME = '#/game/3f2b8c1e-5d47-4a6b-9c0d-1e2f3a4b5c6d';
const TOKEN = 'T'.repeat(43);
const icon = (over: Partial<LaunchEnvironment> = {}): LaunchEnvironment => ({ hash: GAME, homeScreenWebApp: true, navigationType: 'navigate', alreadyRunning: false, ...over });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  window.location.hash = '';
});

describe('a launch', () => {
  it('from a Home Screen icon made on a game or an invitation starts on Your games', () => {
    for (const hash of [GAME, `#/join/${TOKEN}`, `#/friend/${TOKEN}`]) expect(startsAtYourGames(icon({ hash })), hash).toBe(true);
  });

  it('keeps an icon made on Your games or on one-device play where it is', () => {
    for (const hash of ['', '#', '#/', '#/local', '#/local/chess960']) expect(startsAtYourGames(icon({ hash })), hash).toBe(false);
  });

  it('never moves a link opened in a browser, on a phone or a computer', () => {
    for (const hash of [GAME, `#/join/${TOKEN}`, `#/friend/${TOKEN}`]) {
      expect(startsAtYourGames(icon({ hash, homeScreenWebApp: false })), hash).toBe(false);
    }
  });

  it('keeps a reload, a return through history, and a restored page on the game, also in the Home Screen app', () => {
    for (const navigationType of ['reload', 'back_forward', 'prerender', 'unknown']) {
      expect(startsAtYourGames(icon({ navigationType })), navigationType).toBe(false);
    }
    // A page load in a session that has already run the app is not a cold start either.
    expect(startsAtYourGames(icon({ alreadyRunning: true }))).toBe(false);
  });
});

describe('reading the browser', () => {
  const navigation = (type: string | undefined) =>
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue(type === undefined ? [] : ([{ type }] as unknown as PerformanceEntryList));
  const homeScreen = (standalone: unknown) => vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { standalone }));

  it('marks the session on the first read, so the next page load in it is known as not a cold start', () => {
    navigation('navigate');
    homeScreen(true);
    window.location.hash = GAME;
    expect(readLaunchEnvironment()).toEqual({ hash: GAME, homeScreenWebApp: true, navigationType: 'navigate', alreadyRunning: false });
    expect(readLaunchEnvironment()).toMatchObject({ alreadyRunning: true });
  });

  it('treats anything but iOS saying "standalone: true" as a browser, and a missing navigation entry as unknown', () => {
    navigation(undefined);
    for (const value of [undefined, false, 'true', 1]) {
      homeScreen(value);
      expect(readLaunchEnvironment()).toMatchObject({ homeScreenWebApp: false, navigationType: 'unknown' });
    }
  });

  it('still works when session storage is blocked', () => {
    navigation('navigate');
    homeScreen(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    window.location.hash = GAME;
    expect(readLaunchEnvironment()).toMatchObject({ alreadyRunning: false, navigationType: 'navigate' });
  });
});

describe('applying it before the app renders', () => {
  it('replaces the address with Your games, leaving nothing to go Back to, and says it did', () => {
    window.location.hash = GAME;
    const before = window.history.length;
    expect(applyLaunchRoute(icon())).toBe(true);
    expect(window.location.hash).toBe('#/');
    expect(window.history.length).toBe(before);
  });

  it('touches nothing otherwise', () => {
    window.location.hash = GAME;
    const replace = vi.spyOn(window.history, 'replaceState');
    expect(applyLaunchRoute(icon({ homeScreenWebApp: false }))).toBe(false);
    expect(applyLaunchRoute(icon({ navigationType: 'reload' }))).toBe(false);
    expect(window.location.hash).toBe(GAME);
    expect(replace).not.toHaveBeenCalled();
  });
});
