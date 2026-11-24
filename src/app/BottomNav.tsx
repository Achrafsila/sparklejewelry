import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { supabase } from '../lib/supabase';
import { IconLogout, IconMore, IconPlus } from '../ui/icons';
import { NAV_ITEMS, NEW_ORDER_PATH, SETTINGS_ITEM } from './nav';

/** Phone navigation: Stock, Commandes, new order, Suivi, and a compact "Plus" menu. */
export function BottomNav() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLUListElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const direct = NAV_ITEMS.filter((i) => i.phone);
  const more = [...NAV_ITEMS.filter((i) => !i.phone), SETTINGS_ITEM];
  const moreActive = more.some((i) => location.pathname.startsWith(i.to));

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  function onMenuKey(e: KeyboardEvent<HTMLUListElement>) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    }
  }

  const [stock, orders, tracking] = direct;
  return (
    <>
      <nav className="bottom-nav glass" aria-label="Navigation principale">
        <ul className="bottom-nav__list">
          {[stock, orders].map((item) =>
            item ? (
              <li key={item.to}>
                <NavLink to={item.to} className="bottom-nav__item">
                  <item.icon size={22} aria-hidden="true" />
                  {item.label}
                </NavLink>
              </li>
            ) : null,
          )}
          <li>
            <Link to={NEW_ORDER_PATH} className="bottom-nav__item bottom-nav__new" aria-label="Nouvelle commande Instagram">
              <span className="bottom-nav__bubble" aria-hidden="true">
                <IconPlus size={20} />
              </span>
              <span aria-hidden="true">Nouvelle</span>
            </Link>
          </li>
          {tracking && (
            <li>
              <NavLink to={tracking.to} className="bottom-nav__item">
                <tracking.icon size={22} aria-hidden="true" />
                {tracking.label}
              </NavLink>
            </li>
          )}
          <li>
            <button
              ref={buttonRef}
              type="button"
              className="bottom-nav__item"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-controls="menu-plus"
              aria-current={moreActive ? 'page' : undefined}
              onClick={() => setOpen((v) => !v)}
            >
              <IconMore size={22} aria-hidden="true" />
              Plus
            </button>
          </li>
        </ul>
      </nav>
      {open && (
        <ul id="menu-plus" ref={menuRef} className="menu glass" role="menu" aria-label="Plus" onKeyDown={onMenuKey}>
          {more.map(({ label, to, icon: Icon }) => (
            <li key={to} role="none">
              <Link to={to} role="menuitem" className="menu__item">
                <Icon size={20} aria-hidden="true" />
                {label}
              </Link>
            </li>
          ))}
          <li role="separator" className="menu__separator" />
          <li role="none">
            <button type="button" role="menuitem" className="menu__item menu__item--danger" onClick={() => supabase.auth.signOut()}>
              <IconLogout size={20} aria-hidden="true" />
              Se déconnecter
            </button>
          </li>
        </ul>
      )}
    </>
  );
}
