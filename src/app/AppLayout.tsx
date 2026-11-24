import { Suspense, useEffect, useRef, useState, type MouseEvent } from 'react';
import { Outlet, useLocation } from 'react-router';
import { SearchButton, SearchProvider } from '../features/search/GlobalSearch';
import { ActionBarSlot } from './ActionBar';
import { BottomNav } from './BottomNav';
import { ErrorBoundary } from './ErrorBoundary';
import { Sidebar } from './Sidebar';
import { Wordmark } from './Wordmark';

/** The screen behind a URL: a detail panel (/offres/<id>, /offres/nouvelle, /suivi/versements/<id>) belongs to its list. */
function screenOf(path: string): string {
  if (path === '/offres/nouvelle') return '/offres';
  if (/^\/suivi\/versements\/[0-9a-f-]{36}$/.test(path)) return '/suivi';
  return path.replace(/\/[0-9a-f-]{36}$/, '');
}

export function AppLayout() {
  const mainRef = useRef<HTMLElement>(null);
  const location = useLocation();
  // Opening or closing a panel changes the URL inside a section: focus only moves on a new screen.
  const screen = screenOf(location.pathname);
  const previousPath = useRef(screen);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  // Move focus to the content after a page change, for keyboard and screen reader users.
  useEffect(() => {
    if (previousPath.current === screen) return;
    previousPath.current = screen;
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [screen]);

  function skipToContent(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    mainRef.current?.focus();
  }

  return (
    <ActionBarSlot.Provider value={slot}>
    <SearchProvider>
    <div className="app">
      <a className="skip-link" href="#contenu" onClick={skipToContent}>
        Aller au contenu
      </a>
      <Sidebar />
      <header className="topbar glass">
        <Wordmark />
        <SearchButton />
      </header>
      <main id="contenu" ref={mainRef} tabIndex={-1} className="app-main">
        <div className="app-main__inner">
          <ErrorBoundary key={location.pathname.split('/')[1]}>
            <Suspense
              fallback={
                <p className="muted" role="status">
                  Chargement…
                </p>
              }
            >
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>
      <div id="action-bar-slot" ref={setSlot} />
      <BottomNav />
    </div>
    </SearchProvider>
    </ActionBarSlot.Provider>
  );
}
