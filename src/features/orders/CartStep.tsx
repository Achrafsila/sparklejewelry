import { useId, useState } from 'react';
import { formatMoney } from '../../lib/money';
import { Button } from '../../ui/Button';
import { Combobox } from '../../ui/Combobox';
import { EmptyState } from '../../ui/EmptyState';
import { IconMinus, IconPlus, IconTrash } from '../../ui/icons';
import { PhotoSlot } from '../../ui/PhotoSlot';
import '../offers/pickers.css';
import { TrioPicker } from '../offers/TrioPicker';
import { KIND_LABELS, availabilityLabel, type OfferRow } from '../offers/useOffers';
import type { StockRow } from '../stock/useStock';
import { lineTotalOf, piecesOf, unitPriceOf, type Cart, type CartLine } from './cart';

interface Props {
  cart: Cart;
  offers: OfferRow[];
  stock: Map<string, StockRow>;
  lineErrors: Record<string, string>;
  onChange(lines: CartLine[]): void;
}

type Pending = { offer: OfferRow; variantId?: string; picks: string[] };

export function CartStep({ cart, offers, stock, lineErrors, onChange }: Props) {
  const titleId = useId();
  const [pending, setPending] = useState<Pending | null>(null);
  const byId = new Map(offers.map((o) => [o.id, o]));
  const searchable = offers.filter((o) => o.on_instagram && !o.archived);

  function add(line: Omit<CartLine, 'key'>) {
    const same = cart.lines.find(
      (l) => l.offerId === line.offerId && l.variantId === line.variantId && !line.picks && byId.get(l.offerId)?.kind !== 'custom_trio',
    );
    onChange(
      same
        ? cart.lines.map((l) => (l === same ? { ...l, qty: l.qty + line.qty } : l))
        : [...cart.lines, { ...line, key: crypto.randomUUID() }],
    );
  }

  function choose(offer: OfferRow) {
    if (offer.kind === 'fixed_trio' || (offer.kind === 'unit' && offer.items.length === 1)) {
      add({ offerId: offer.id, qty: 1, variantId: offer.kind === 'unit' ? offer.items[0]!.variant_id : undefined });
      setPending(null);
    } else {
      setPending({ offer, picks: [] });
    }
  }

  const setQty = (key: string, qty: number) =>
    onChange(cart.lines.map((l) => (l.key === key ? { ...l, qty: Math.max(1, qty) } : l)));

  return (
    <section className="panel order-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="panel__title">
        Panier
      </h2>
      <Combobox
        label="Ajouter une offre"
        items={searchable}
        getKey={(o) => o.id}
        getText={(o) => `${o.name} ${KIND_LABELS[o.kind]}`}
        placeholder="Nom de l’offre"
        emptyText="Aucune offre active sur Instagram ne correspond."
        renderItem={(o) => (
          <span className="item-line">
            <PhotoSlot size={40} path={o.photo_path ?? o.items[0]?.photo_path} />
            <span className="item-line__text">
              <span className="item-line__name">{o.name}</span>
              <span className="item-line__meta">
                {KIND_LABELS[o.kind]}, {formatMoney(o.price_cents)}, {availabilityLabel(o.kind, o.sellable)}
              </span>
            </span>
          </span>
        )}
        onSelect={choose}
      />

      {pending?.offer.kind === 'unit' && (
        <div className="line-editor">
          <fieldset className="kind-choice">
            <legend>Variante de « {pending.offer.name} »</legend>
            <div className="variant-choice">
              {pending.offer.items.map((i) => (
                <label key={i.variant_id} className={pending.variantId === i.variant_id ? 'ref-picker__row is-chosen' : 'ref-picker__row'}>
                  <input
                    type="radio"
                    className="ref-picker__check"
                    name="variant-choice"
                    checked={pending.variantId === i.variant_id}
                    disabled={i.available_qty <= 0}
                    onChange={() => setPending({ ...pending, variantId: i.variant_id })}
                  />
                  <PhotoSlot size={40} path={i.photo_path} />
                  <span className="item-line__text">
                    <span className="item-line__name">{i.name}</span>
                    <span className="item-line__meta">
                      {formatMoney(i.price_cents ?? pending.offer.price_cents)}, {i.available_qty > 0 ? `${i.available_qty} disponible${i.available_qty > 1 ? 's' : ''}` : 'Indisponible'}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="line-editor__actions">
            <Button
              variant="primary"
              disabled={!pending.variantId}
              onClick={() => {
                add({ offerId: pending.offer.id, qty: 1, variantId: pending.variantId });
                setPending(null);
              }}
            >
              Ajouter au panier
            </Button>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Annuler
            </Button>
          </div>
        </div>
      )}

      {pending?.offer.kind === 'custom_trio' && (
        <div className="line-editor">
          <p className="muted">
            {pending.offer.name}, {formatMoney(pending.offer.price_cents)} quelle que soit la composition
            {pending.offer.allow_repeat ? '. La même pièce peut être choisie plusieurs fois.' : '.'}
          </p>
          <TrioPicker
            mode="pick"
            label="Pièces choisies en DM"
            candidates={pending.offer.items.map((i) => ({ ...i, available_qty: stock.get(i.variant_id)?.available_qty ?? i.available_qty }))}
            value={pending.picks}
            allowRepeat={pending.offer.allow_repeat}
            onChange={(picks) => setPending({ ...pending, picks })}
          />
          <div className="line-editor__actions">
            <Button
              variant="primary"
              disabled={pending.picks.length !== 3}
              onClick={() => {
                add({ offerId: pending.offer.id, qty: 1, picks: pending.picks });
                setPending(null);
              }}
            >
              Ajouter ce trio
            </Button>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Annuler ce trio
            </Button>
          </div>
        </div>
      )}

      {cart.lines.length === 0 ? (
        !pending && <EmptyState title="Panier vide." text="Cherchez une offre ci-dessus : nom, trio, pièce à l’unité." />
      ) : (
        <ul className="cart-lines">
          {cart.lines.map((line) => {
            const offer = byId.get(line.offerId);
            const pieces = piecesOf(line, offer);
            const custom = offer?.kind === 'custom_trio';
            const title = offer?.name ?? 'Offre retirée';
            return (
              <li key={line.key} className="cart-line">
                <PhotoSlot size={56} path={offer?.photo_path ?? stock.get(pieces[0]?.variantId ?? '')?.photo_path} />
                <div className="cart-line__main">
                  <p className="item-line__name">{title}</p>
                  <p className="item-line__meta">
                    {pieces.map((p) => stock.get(p.variantId)?.name ?? '?').join(', ')}
                  </p>
                  <p className="item-line__meta num">{formatMoney(unitPriceOf(line, offer))} l’unité</p>
                  {lineErrors[line.key] && (
                    <p className="field__error" role="alert">
                      {lineErrors[line.key]}
                    </p>
                  )}
                </div>
                {custom ? (
                  <span className="cart-line__qty num">1</span>
                ) : (
                  <div className="stepper">
                    <button type="button" className="icon-btn" aria-label={`Diminuer la quantité de ${title}`} disabled={line.qty <= 1} onClick={() => setQty(line.key, line.qty - 1)}>
                      <IconMinus size={18} aria-hidden="true" />
                    </button>
                    <span className="num" aria-live="polite">
                      {line.qty}
                    </span>
                    <button type="button" className="icon-btn" aria-label={`Augmenter la quantité de ${title}`} onClick={() => setQty(line.key, line.qty + 1)}>
                      <IconPlus size={18} aria-hidden="true" />
                    </button>
                  </div>
                )}
                <p className="cart-line__total num">{formatMoney(lineTotalOf(line, offer))}</p>
                <button type="button" className="icon-btn" aria-label={`Retirer ${title}`} onClick={() => onChange(cart.lines.filter((l) => l.key !== line.key))}>
                  <IconTrash size={18} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {cart.lines.length > 0 && (
        <Button variant="ghost" size="small" className="cart-clear" onClick={() => onChange([])}>
          Vider le panier
        </Button>
      )}
    </section>
  );
}
