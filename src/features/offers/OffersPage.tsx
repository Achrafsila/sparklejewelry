import { useState } from 'react';
import { Link, useMatch, useNavigate } from 'react-router';
import { useSWRConfig } from 'swr';
import { ActionBar } from '../../app/ActionBar';
import { messageFor, toAppError } from '../../lib/errors';
import { formatMoney } from '../../lib/money';
import { read } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { Button } from '../../ui/Button';
import { Segmented, Skeleton, Switch } from '../../ui/Controls';
import { DataList, type Column } from '../../ui/DataList';
import { EmptyState } from '../../ui/EmptyState';
import { InlineStatus } from '../../ui/Feedback';
import { IconPlus } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';
import { PhotoSlot } from '../../ui/PhotoSlot';
import { ConfirmDialog, Sheet } from '../../ui/Sheet';
import { Badge } from '../../ui/StatusBadge';
import { STOCK_KEY, useStock } from '../stock/useStock';
import { OfferForm } from './OfferSheet';
import { KIND_LABELS, OFFERS_KEY, availabilityLabel, useOffers, type OfferRow } from './useOffers';
import './offers.css';

type Channel = 'on_instagram' | 'on_site';

function priceLabel(o: OfferRow) {
  if (o.kind === 'unit' && o.items.some((i) => i.price_cents != null)) {
    const prices = o.items.map((i) => i.price_cents ?? o.price_cents);
    const min = Math.min(...prices);
    return prices.every((p) => p === min) ? formatMoney(min) : `À partir de ${formatMoney(min)}`;
  }
  return formatMoney(o.price_cents);
}

export function OffersPage() {
  const creating = useMatch('/offres/nouvelle') != null;
  const detail = useMatch('/offres/:offerId');
  const offerId = creating ? undefined : detail?.params.offerId;
  const navigate = useNavigate();
  const offers = useOffers();
  const stock = useStock();
  const { mutate } = useSWRConfig();
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [saved, setSaved] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [archiving, setArchiving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const editing = offerId ? (offers.data?.find((o) => o.id === offerId) ?? null) : null;
  const rows = offers.data?.filter((o) => (view === 'archived' ? o.archived : !o.archived));
  const archivedCount = offers.data?.filter((o) => o.archived).length ?? 0;

  async function toggle(offer: OfferRow, channel: Channel, value: boolean) {
    setRowErrors((e) => ({ ...e, [offer.id]: '' }));
    await mutate(
      OFFERS_KEY,
      async (current: OfferRow[] | undefined) => {
        await read(supabase.from('offers').update({ [channel]: value, updated_at: new Date().toISOString() }).eq('id', offer.id).select('id'));
        return current?.map((o) => (o.id === offer.id ? { ...o, [channel]: value } : o));
      },
      {
        optimisticData: (current?: OfferRow[]) => current?.map((o) => (o.id === offer.id ? { ...o, [channel]: value } : o)) ?? [],
        rollbackOnError: true,
        revalidate: false,
      },
    ).catch((e) => setRowErrors((errs) => ({ ...errs, [offer.id]: `Changement non enregistré. ${messageFor(toAppError(e))}` })));
  }

  async function archive() {
    if (!editing) return;
    setArchiving(true);
    try {
      await read(supabase.from('offers').update({ archived: true }).eq('id', editing.id).select('id'));
      await mutate(OFFERS_KEY);
      setSaved(`Offre archivée : ${editing.name}.`);
      setConfirmArchive(false);
      navigate('/offres');
    } finally {
      setArchiving(false);
    }
  }

  const switches = (o: OfferRow) => (
    <div className="offer-switches">
      <Switch label={`Instagram : ${o.name}`} checked={o.on_instagram} onChange={(v) => toggle(o, 'on_instagram', v)} />
      <Switch label={`Site : ${o.name}`} checked={o.on_site} onChange={(v) => toggle(o, 'on_site', v)} />
      {rowErrors[o.id] && (
        <p className="field__error" role="alert">
          {rowErrors[o.id]}
        </p>
      )}
    </div>
  );

  const photo = (o: OfferRow) => <PhotoSlot path={o.photo_path ?? o.items[0]?.photo_path} />;

  const columns: Column<OfferRow>[] = [
    { key: 'photo', header: <span className="visually-hidden">Photo</span>, render: photo },
    {
      key: 'name',
      header: 'Offre',
      render: (o) => (
        <Link to={`/offres/${o.id}`} className="row-link">
          {o.name}
        </Link>
      ),
    },
    { key: 'kind', header: 'Format', render: (o) => <Badge tone="neutral">{KIND_LABELS[o.kind]}</Badge> },
    { key: 'price', header: 'Prix', numeric: true, render: priceLabel },
    {
      key: 'available',
      header: 'Disponibilité',
      render: (o) => <span className={o.sellable === 0 ? 'offer-availability is-empty' : 'offer-availability'}>{availabilityLabel(o.kind, o.sellable)}</span>,
    },
    {
      key: 'channels',
      header: (
        <span className="channel-heads">
          <span>Instagram</span>
          <span>Site</span>
        </span>
      ),
      render: switches,
    },
  ];

  return (
    <>
      <PageHeader
        title="Offres"
        count={offers.data ? `${offers.data.filter((o) => !o.archived).length} active${offers.data.filter((o) => !o.archived).length > 1 ? 's' : ''}` : undefined}
        actionsOnPhone={false}
        actions={
          <Link to="/offres/nouvelle" className="btn btn--primary">
            <IconPlus size={18} aria-hidden="true" />
            Nouvelle offre
          </Link>
        }
        filters={
          archivedCount > 0 ? (
            <Segmented<'active' | 'archived'>
              label="Offres affichées"
              value={view}
              onChange={setView}
              options={[
                { value: 'active', label: 'Actives', count: (offers.data?.length ?? 0) - archivedCount },
                { value: 'archived', label: 'Archivées', count: archivedCount },
              ]}
            />
          ) : undefined
        }
      />
      <InlineStatus state={saved ? 'success' : 'idle'}>{saved}</InlineStatus>
      <DataList
        label="Offres"
        columns={columns}
        rows={rows}
        rowKey={(o) => o.id}
        loading={offers.isLoading}
        error={offers.error}
        onRetry={() => offers.mutate()}
        empty={
          <EmptyState
            title={stock.data?.length ? 'Aucune offre pour l’instant.' : 'Réceptionnez un arrivage pour créer votre première offre.'}
            text="Une offre peut être une pièce à l’unité, un trio fixe ou un trio à composer, sur le stock commun."
            action={
              stock.data?.length ? (
                <Link to="/offres/nouvelle" className="btn btn--primary">
                  Nouvelle offre
                </Link>
              ) : (
                <Link to="/stock/arrivage" className="btn btn--primary">
                  Nouvel arrivage
                </Link>
              )
            }
          />
        }
        renderCard={(o) => (
          <div className="offer-card">
            <div className="offer-card__head">
              {photo(o)}
              <div className="item-line__text">
                <Link to={`/offres/${o.id}`} className="row-link">
                  {o.name}
                </Link>
                <span className="item-line__meta">
                  {KIND_LABELS[o.kind]}, {priceLabel(o)}
                </span>
                <span className={o.sellable === 0 ? 'offer-availability is-empty' : 'offer-availability'}>{availabilityLabel(o.kind, o.sellable)}</span>
              </div>
            </div>
            {switches(o)}
          </div>
        )}
      />

      <ActionBar>
        <Link to="/offres/nouvelle" className="btn btn--primary">
          <IconPlus size={18} aria-hidden="true" />
          Nouvelle offre
        </Link>
      </ActionBar>

      <Sheet
        wide
        open={creating || (offerId != null && editing != null)}
        title={creating ? 'Nouvelle offre' : (editing?.name ?? '')}
        onClose={() => navigate('/offres')}
        footer={
          editing && !editing.archived ? (
            <Button variant="danger" onClick={() => setConfirmArchive(true)}>
              Archiver l’offre
            </Button>
          ) : undefined
        }
      >
        {!stock.data || !offers.data ? (
          <Skeleton rows={4} />
        ) : (
          (creating || editing) && (
            <OfferForm
              key={editing?.id ?? 'new'}
              offer={editing}
              offers={offers.data}
              stock={stock.data}
              onSaved={(name) => {
                setSaved(`Offre enregistrée : ${name}.`);
                void mutate(OFFERS_KEY);
                void mutate(STOCK_KEY);
                navigate('/offres');
              }}
            />
          )
        )}
      </Sheet>
      <ConfirmDialog
        open={confirmArchive}
        title="Archiver cette offre ?"
        confirmLabel="Archiver"
        danger
        pending={archiving}
        onConfirm={archive}
        onCancel={() => setConfirmArchive(false)}
      >
        <p>Elle ne sera plus proposée dans les nouvelles commandes. Les commandes passées gardent leur nom, leur prix et leur composition.</p>
      </ConfirmDialog>
    </>
  );
}
