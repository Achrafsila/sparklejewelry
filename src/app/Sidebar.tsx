import { Link, NavLink } from 'react-router';
import { SearchButton } from '../features/search/GlobalSearch';
import { supabase } from '../lib/supabase';
import { IconLogout, IconPlus } from '../ui/icons';
import { NAV_ITEMS, NEW_ORDER_PATH, SETTINGS_ITEM } from './nav';
import { Wordmark } from './Wordmark';

/** Desktop sidebar (≥1024px) that becomes an icon rail with labels on tablets. */
export function Sidebar() {
  return (
    <nav className="sidebar glass" aria-label="Navigation principale">
      <div className="sidebar__brand">
        <Wordmark />
      </div>
      <SearchButton />
      <Link to={NEW_ORDER_PATH} className="btn btn--primary sidebar__new" aria-label="Nouvelle commande Instagram">
        <IconPlus size={18} aria-hidden="true" />
        <span className="btn__long">Nouvelle commande Instagram</span>
        <span className="btn__short" aria-hidden="true">
          Commande
        </span>
      </Link>
      <ul className="nav-list">
        {NAV_ITEMS.map(({ label, to, icon: Icon }) => (
          <li key={to}>
            <NavLink to={to} className="nav-link" end={false}>
              <Icon size={20} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
      <ul className="nav-list sidebar__footer">
        <li>
          <NavLink to={SETTINGS_ITEM.to} className="nav-link">
            <SETTINGS_ITEM.icon size={20} aria-hidden="true" />
            <span>{SETTINGS_ITEM.label}</span>
          </NavLink>
        </li>
        <li>
          <button type="button" className="nav-link nav-link--quiet" onClick={() => supabase.auth.signOut()}>
            <IconLogout size={20} aria-hidden="true" />
            <span>Se déconnecter</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
