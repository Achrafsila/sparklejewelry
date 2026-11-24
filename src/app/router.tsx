import { createBrowserRouter, Navigate, Link } from 'react-router';
import { AppLayout } from './AppLayout';
import { RequireAuth } from './auth';
import { LoginPage } from '../features/auth/LoginPage';

// Each screen is its own chunk, loaded when first visited.
const page = <T extends Record<string, unknown>>(load: () => Promise<T>, name: keyof T) => ({
  lazy: async () => ({ Component: (await load())[name] as React.ComponentType }),
});

function NotFound() {
  return (
    <div className="empty">
      <h1>Page introuvable</h1>
      <p className="empty__text">Cette adresse ne correspond à aucun écran du back-office.</p>
      <Link className="btn btn--primary" to="/stock">
        Aller au stock
      </Link>
    </div>
  );
}

// Component gallery for automated UI checks; compiled out of production builds.
const devRoutes =
  import.meta.env.MODE === 'local-stack'
    ? [{ path: '/dev/ui', ...page(() => import('../dev/UiKitPage'), 'UiKitPage') }]
    : [];

export const router = createBrowserRouter([
  { path: '/connexion', element: <LoginPage /> },
  ...devRoutes,
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/stock" replace /> },
      // Detail panels are child routes: the list page stays mounted while a panel opens and closes.
      {
        path: 'stock',
        ...page(() => import('../features/stock/StockPage'), 'StockPage'),
        children: [{ path: ':variantId', element: null }],
      },
      { path: 'stock/arrivage', ...page(() => import('../features/arrivals/ArrivalPage'), 'ArrivalPage') },
      {
        path: 'offres',
        ...page(() => import('../features/offers/OffersPage'), 'OffersPage'),
        children: [
          { path: 'nouvelle', element: null },
          { path: ':offerId', element: null },
        ],
      },
      {
        path: 'commandes',
        ...page(() => import('../features/orders/OrdersPage'), 'OrdersPage'),
        children: [{ path: ':orderId', element: null }],
      },
      { path: 'commandes/nouvelle', ...page(() => import('../features/orders/NewOrderPage'), 'NewOrderPage') },
      { path: 'preparation', ...page(() => import('../features/preparation/PreparationPage'), 'PreparationPage') },
      {
        path: 'suivi',
        ...page(() => import('../features/tracking/TrackingPage'), 'TrackingPage'),
        children: [{ path: 'versements/:payoutId', element: null }],
      },
      { path: 'suivi/versements/nouveau', ...page(() => import('../features/tracking/PayoutPage'), 'PayoutPage') },
      { path: 'pilotage', ...page(() => import('../features/dashboard/DashboardPage'), 'DashboardPage') },
      { path: 'reglages', ...page(() => import('../features/settings/SettingsPage'), 'SettingsPage') },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
