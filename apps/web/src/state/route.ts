import { useEffect, useState } from 'react';

export type Route =
  | { name: 'list' }
  | { name: 'new' }
  | { name: 'payout'; id: string }
  | { name: 'ops' };

export function parsePath(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'list' };
  if (pathname === '/new') return { name: 'new' };
  if (pathname === '/ops') return { name: 'ops' };
  const m = pathname.match(/^\/payouts\/([^/]+)$/);
  if (m?.[1]) return { name: 'payout', id: decodeURIComponent(m[1]) };
  return { name: 'list' };
}

export function pathFor(route: Route): string {
  switch (route.name) {
    case 'list':
      return '/';
    case 'new':
      return '/new';
    case 'ops':
      return '/ops';
    case 'payout':
      return `/payouts/${encodeURIComponent(route.id)}`;
  }
}

export function navigate(path: string): void {
  if (window.location.pathname === path) return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parsePath(window.location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(parsePath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return route;
}
