import { useEffect, useState } from 'react';

export type Route =
  | { page: 'home' }
  | { page: 'local' }
  | { page: 'game'; gameId: string }
  | { page: 'join'; token: string };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const game = path.match(/^\/game\/([0-9a-f-]{36})$/i);
  if (game) return { page: 'game', gameId: game[1] };
  const join = path.match(/^\/join\/([A-Za-z0-9_-]{43})$/);
  if (join) return { page: 'join', token: join[1] };
  if (path === '/local') return { page: 'local' };
  return { page: 'home' };
}

export function navigate(hash: string, { replace = false } = {}): void {
  if (replace) {
    window.history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = hash;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}
