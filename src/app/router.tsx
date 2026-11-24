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

export const router = createBrowserRouter([
  { path: '/connexion', element: <LoginPage /> },
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/stock" replace /> },
      { path: 'stock', ...page(() => import('../features/stock/StockPage'), 'StockPage') },
      { path: 'stock/arrivage', ...page(() => import('../features/arrivals/ArrivalPage'), 'ArrivalPage') },
      { path: 'stock/:variantId', ...page(() => import('../features/stock/StockPage'), 'StockPage') },
      { path: 'offres', ...page(() => import('../features/offers/OffersPage'), 'OffersPage') },
      { path: 'offres/nouvelle', ...page(() => import('../features/offers/OffersPage'), 'OffersPage') },
      { path: 'offres/:offerId', ...page(() => import('../features/offers/OffersPage'), 'OffersPage') },
      { path: 'commandes', ...page(() => import('../features/orders/OrdersPage'), 'OrdersPage') },
      { path: 'commandes/nouvelle', ...page(() => import('../features/orders/NewOrderPage'), 'NewOrderPage') },
      { path: 'commandes/:orderId', ...page(() => import('../features/orders/OrdersPage'), 'OrdersPage') },
      { path: 'preparation', ...page(() => import('../features/preparation/PreparationPage'), 'PreparationPage') },
      { path: 'suivi', ...page(() => import('../features/tracking/TrackingPage'), 'TrackingPage') },
      { path: 'suivi/versements/nouveau', ...page(() => import('../features/tracking/PayoutPage'), 'PayoutPage') },
      { path: 'suivi/versements/:payoutId', ...page(() => import('../features/tracking/TrackingPage'), 'TrackingPage') },
      { path: 'pilotage', ...page(() => import('../features/dashboard/DashboardPage'), 'DashboardPage') },
      { path: 'reglages', ...page(() => import('../features/settings/SettingsPage'), 'SettingsPage') },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
