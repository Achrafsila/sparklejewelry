import { Suspense, useEffect, useRef, useState, type MouseEvent } from 'react';
import { Outlet, useLocation } from 'react-router';
import { ActionBarSlot } from './ActionBar';
import { BottomNav } from './BottomNav';
import { ErrorBoundary } from './ErrorBoundary';
import { Sidebar } from './Sidebar';
import { Wordmark } from './Wordmark';

export function AppLayout() {
  const mainRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const previousPath = useRef(location.pathname);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  // Move focus to the content after a page change, for keyboard and screen reader users.
  useEffect(() => {
    if (previousPath.current === location.pathname) return;
    previousPath.current = location.pathname;
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  function skipToContent(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    mainRef.current?.focus();
  }

  return (
    <ActionBarSlot.Provider value={slot}>
    <div className="app">
      <a className="skip-link" href="#contenu" onClick={skipToContent}>
        Aller au contenu
      </a>
      <Sidebar />
      <header className="topbar glass">
        <Wordmark />
      </header>
      <main id="contenu" ref={mainRef} tabIndex={-1} className="app-main">
        <div className="app-main__inner">
          <ErrorBoundary key={location.pathname}>
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
    </ActionBarSlot.Provider>
  );
}
