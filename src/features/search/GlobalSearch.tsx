import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { formatDate } from '../../lib/dates';
import { messageFor, toAppError } from '../../lib/errors';
import { formatMoney } from '../../lib/money';
import { callRpc } from '../../lib/rpc';
import { IconClose, IconSearch } from '../../ui/icons';
import { PhotoSlot } from '../../ui/PhotoSlot';
import { STATUS_LABELS, type OrderStatus } from '../../ui/StatusBadge';
import './search.css';

interface Results {
  orders: { id: string; number: string; customer_name: string; status: OrderStatus; created_at: string }[];
  variants: { variant_id: string; sku: string; name: string; photo_path: string | null; available_qty: number }[];
  payouts: { id: string; reference: string; carrier: string; received_on: string; amount_received_cents: number }[];
}

const empty: Results = { orders: [], variants: [], payouts: [] };

const SearchContext = createContext<() => void>(() => {});

/** The visible "Rechercher" button (sidebar on wide screens, top bar on phones). */
export function SearchButton() {
  const open = useContext(SearchContext);
  return (
    <button type="button" className="search-trigger" onClick={open} aria-label="Rechercher" aria-keyshortcuts="/">
      <IconSearch size={18} aria-hidden="true" />
      <span className="search-trigger__text">Rechercher</span>
      <kbd className="search-trigger__key" aria-hidden="true">
        /
      </kbd>
    </button>
  );
}

/** Search everything by reference: order number, phone, @handle, name, tracking, SKU, payout reference. */
export function SearchProvider({ children }: { children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Results>(empty);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const open = useCallback(() => {
    if (dialogRef.current?.open) return;
    dialogRef.current?.showModal();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  function close() {
    dialogRef.current?.close();
    setQuery('');
    setResults(empty);
  }

  // "/" opens the search anywhere, except while typing in a field.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (target.closest('input, textarea, select, [contenteditable="true"]') || dialogRef.current?.open) return;
      e.preventDefault();
      open();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(empty);
      return;
    }
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      callRpc<Results>('search_all', { p_query: q })
        .then((r) => {
          if (active) {
            setResults(r);
            setError(null);
          }
        })
        .catch((e) => active && setError(messageFor(toAppError(e))))
        .finally(() => active && setLoading(false));
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const links = [
    ...results.orders.map((o) => `/commandes/${o.id}`),
    ...results.variants.map((v) => `/stock/${v.variant_id}`),
    ...results.payouts.map((p) => `/suivi/versements/${p.id}`),
  ];

  const firstLink = (r: Results) =>
    r.orders[0] ? `/commandes/${r.orders[0].id}` : r.variants[0] ? `/stock/${r.variants[0].variant_id}` : r.payouts[0] ? `/suivi/versements/${r.payouts[0].id}` : null;

  // Enter opens the first result, searching right away if the results are not shown yet.
  async function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = query.trim();
    let to = links[0] ?? null;
    if (!to && q.length >= 2) {
      try {
        to = firstLink(await callRpc<Results>('search_all', { p_query: q }));
      } catch (err) {
        setError(messageFor(toAppError(err)));
        return;
      }
    }
    if (to) {
      close();
      navigate(to);
    }
  }

  const go = () => close();
  const total = links.length;

  return (
    <SearchContext.Provider value={open}>
      {children}
      <dialog ref={dialogRef} className="search-dialog" aria-labelledby={titleId} onClick={(e) => e.target === dialogRef.current && close()} onClose={() => setQuery('')}>
        <div className="search-dialog__frame">
          <h2 id={titleId} className="visually-hidden">
            Recherche
          </h2>
          <div className="search-dialog__field">
            <IconSearch size={20} aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              className="search-dialog__input"
              aria-label="Rechercher"
              placeholder="SPK-0001, 06…, @pseudo, référence, versement…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button type="button" className="icon-btn" aria-label="Fermer la recherche" onClick={close}>
              <IconClose size={20} aria-hidden="true" />
            </button>
          </div>
          <div className="search-dialog__results" aria-live="polite">
            {error && <p className="field__error">{error}</p>}
            {query.trim().length >= 2 && !loading && total === 0 && !error && <p className="muted">Aucun résultat pour « {query.trim()} ».</p>}
            {results.orders.length > 0 && (
              <section>
                <h3 className="section-title">Commandes</h3>
                <ul className="search-results">
                  {results.orders.map((o) => (
                    <li key={o.id}>
                      <Link to={`/commandes/${o.id}`} onClick={go} className="search-result">
                        <span className="item-line__name">{o.number}</span>
                        <span className="item-line__meta">
                          {o.customer_name || 'Sans nom'}, {STATUS_LABELS[o.status]}, {formatDate(o.created_at)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {results.variants.length > 0 && (
              <section>
                <h3 className="section-title">Bijoux</h3>
                <ul className="search-results">
                  {results.variants.map((v) => (
                    <li key={v.variant_id}>
                      <Link to={`/stock/${v.variant_id}`} onClick={go} className="search-result search-result--photo">
                        <PhotoSlot size={40} path={v.photo_path} />
                        <span className="item-line__text">
                          <span className="item-line__name">{v.name}</span>
                          <span className="item-line__meta">
                            {v.sku}, {v.available_qty} disponible{v.available_qty > 1 ? 's' : ''}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {results.payouts.length > 0 && (
              <section>
                <h3 className="section-title">Versements</h3>
                <ul className="search-results">
                  {results.payouts.map((p) => (
                    <li key={p.id}>
                      <Link to={`/suivi/versements/${p.id}`} onClick={go} className="search-result">
                        <span className="item-line__name">{p.reference || 'Sans référence'}</span>
                        <span className="item-line__meta">
                          {p.carrier}, {formatDate(p.received_on)}, {formatMoney(p.amount_received_cents)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </dialog>
    </SearchContext.Provider>
  );
}
