import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ActionBar } from '../../app/ActionBar';
import { Segmented } from '../../ui/Controls';
import { DataList, type Column } from '../../ui/DataList';
import { EmptyState } from '../../ui/EmptyState';
import { Notice } from '../../ui/Feedback';
import { IconPlus, IconSearch } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';
import { PhotoSlot } from '../../ui/PhotoSlot';
import { StatusBadge } from '../../ui/StatusBadge';
import { useSettings, useStock, type StockRow } from './useStock';
import { VariantSheet } from './VariantSheet';
import './stock.css';

type Filter = 'all' | 'low' | 'out' | 'archived';

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

function stockStatus(row: StockRow) {
  if (row.available_qty <= 0) return <StatusBadge status="out" />;
  if (row.is_low) return <StatusBadge status="low" />;
  return null;
}

export function StockPage() {
  const { variantId } = useParams();
  const navigate = useNavigate();
  const stock = useStock();
  const settings = useSettings();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const deferredQuery = useDeferredValue(query);

  const rows = stock.data;
  const active = useMemo(() => (rows ?? []).filter((r) => !r.archived), [rows]);
  const counts = {
    all: active.length,
    low: active.filter((r) => r.is_low && r.available_qty > 0).length,
    out: active.filter((r) => r.available_qty <= 0).length,
    archived: (rows ?? []).length - active.length,
  };

  const visible = useMemo(() => {
    if (!rows) return undefined;
    const words = fold(deferredQuery).split(/\s+/).filter(Boolean);
    return rows.filter((r) => {
      if (filter === 'archived' ? !r.archived : r.archived) return false;
      if (filter === 'low' && !(r.is_low && r.available_qty > 0)) return false;
      if (filter === 'out' && r.available_qty > 0) return false;
      const hay = fold(`${r.name} ${r.sku}`);
      return words.every((w) => hay.includes(w));
    });
  }, [rows, deferredQuery, filter]);

  const low = active.filter((r) => r.is_low);
  const selected = rows?.find((r) => r.variant_id === variantId) ?? null;

  const columns: Column<StockRow>[] = [
    { key: 'photo', header: <span className="visually-hidden">Photo</span>, render: (r) => <PhotoSlot path={r.photo_path} /> },
    {
      key: 'model',
      header: 'Modèle',
      render: (r) => (
        <Link to={`/stock/${r.variant_id}`} className="row-link" aria-label={r.name}>
          {r.product_name}
        </Link>
      ),
    },
    { key: 'label', header: 'Variante', render: (r) => r.label ?? <span className="muted">Sans variante</span> },
    { key: 'sku', header: 'Référence', render: (r) => <span className="sku">{r.sku}</span> },
    { key: 'physical', header: 'Physique', numeric: true, render: (r) => r.physical_qty },
    { key: 'reserved', header: 'Réservé', numeric: true, render: (r) => r.reserved_qty },
    {
      key: 'available',
      header: 'Disponible',
      numeric: true,
      render: (r) => (
        <span className="available">
          {stockStatus(r)}
          <b>{r.available_qty}</b>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Stock"
        actionsOnPhone={false}
        count={rows ? `${counts.all} référence${counts.all > 1 ? 's' : ''}` : undefined}
        actions={
          <Link to="/stock/arrivage" className="btn btn--primary">
            <IconPlus size={18} aria-hidden="true" />
            Nouvel arrivage
          </Link>
        }
        filters={
          <>
            <label className="search">
              <IconSearch size={18} aria-hidden="true" />
              <span className="visually-hidden">Rechercher dans le stock</span>
              <input
                className="input"
                type="search"
                placeholder="Modèle, variante ou référence"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <Segmented<Filter>
              label="Filtrer le stock"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'Tout', count: counts.all },
                { value: 'low', label: 'Stock bas', count: counts.low },
                { value: 'out', label: 'Rupture', count: counts.out },
                ...(counts.archived ? [{ value: 'archived' as const, label: 'Archivées', count: counts.archived }] : []),
              ]}
            />
          </>
        }
      />

      {low.length > 0 && filter === 'all' && !deferredQuery && (
        <div className="stock-alert">
          <Notice tone="warn" title={`Stock bas : ${low.length} référence${low.length > 1 ? 's' : ''} à ${settings.data?.low_stock_threshold ?? 5} pièces ou moins`}>
            <ul className="stock-alert__list">
              {low.slice(0, 5).map((r) => (
                <li key={r.variant_id}>
                  <Link to={`/stock/${r.variant_id}`}>{r.name}</Link>
                  <span className="num"> : {r.available_qty} disponible{r.available_qty > 1 ? 's' : ''}</span>
                  {r.offers.length > 0 && <span className="muted">. Offres concernées : {r.offers.map((o) => o.name).join(', ')}</span>}
                </li>
              ))}
            </ul>
            {low.length > 5 && (
              <button type="button" className="link-button" onClick={() => setFilter('low')}>
                Voir les {low.length} références
              </button>
            )}
          </Notice>
        </div>
      )}

      <DataList
        label="Références en stock"
        columns={columns}
        rows={visible}
        rowKey={(r) => r.variant_id}
        loading={stock.isLoading}
        error={stock.error}
        onRetry={() => stock.mutate()}
        empty={
          rows && rows.length === 0 ? (
            <EmptyState
              title="Aucune référence pour l’instant."
              text="Commencez par un arrivage : chaque modèle et chaque variante reçus deviennent une référence."
              action={
                <Link to="/stock/arrivage" className="btn btn--primary">
                  Nouvel arrivage
                </Link>
              }
            />
          ) : (
            <EmptyState title="Aucune référence ne correspond." text="Modifiez la recherche ou le filtre." />
          )
        }
        renderCard={(r) => (
          <Link to={`/stock/${r.variant_id}`} className="stock-card">
            <PhotoSlot size={56} path={r.photo_path} />
            <span className="stock-card__text">
              <span className="item-line__name">{r.name}</span>
              <span className="item-line__meta">{r.sku}</span>
              {stockStatus(r) && <span className="stock-card__status">{stockStatus(r)}</span>}
              <span className="figures">
                <span className="figures__cell">
                  <span className="figures__label">Physique</span>
                  <b>{r.physical_qty}</b>
                </span>
                <span className="figures__cell">
                  <span className="figures__label">Réservé</span>
                  <b>{r.reserved_qty}</b>
                </span>
                <span className="figures__cell">
                  <span className="figures__label">Disponible</span>
                  <b>{r.available_qty}</b>
                </span>
              </span>
            </span>
          </Link>
        )}
      />

      <ActionBar>
        <Link to="/stock/arrivage" className="btn btn--primary">
          <IconPlus size={18} aria-hidden="true" />
          Nouvel arrivage
        </Link>
      </ActionBar>

      <VariantSheet row={selected} onClose={() => navigate('/stock')} />
    </>
  );
}
