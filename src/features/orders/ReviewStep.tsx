import { useId } from 'react';
import { formatMoney, parseMoney } from '../../lib/money';
import { formatPhone, normalizePhone } from '../../lib/phone';
import { PhotoSlot } from '../../ui/PhotoSlot';
import type { OfferRow } from '../offers/useOffers';
import type { StockRow } from '../stock/useStock';
import { lineTotalOf, needsOf, type Cart } from './cart';

interface Props {
  cart: Cart;
  offers: Map<string, OfferRow>;
  stock: Map<string, StockRow>;
}

export function cartTotals(cart: Cart, offers: Map<string, OfferRow>) {
  const items = cart.lines.reduce((sum, l) => sum + lineTotalOf(l, offers.get(l.offerId)), 0);
  const shipping = parseMoney(cart.shippingFee) ?? 0;
  return { items, shipping, total: items + shipping };
}

/** What will be sold and which pieces will be reserved, before saving. */
export function ReviewStep({ cart, offers, stock }: Props) {
  const titleId = useId();
  const needs = [...needsOf(cart.lines, offers)];
  const totals = cartTotals(cart, offers);
  const phone = normalizePhone(cart.customer.phone);

  return (
    <section className="panel order-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="panel__title">
        Récapitulatif
      </h2>
      <div className="review">
        <div>
          <h3 className="section-title">Composition</h3>
          {cart.lines.length === 0 ? (
            <p className="muted">Aucune offre dans le panier.</p>
          ) : (
            <ul className="plain-list">
              {cart.lines.map((l) => {
                const offer = offers.get(l.offerId);
                return (
                  <li key={l.key} className="plain-list__row">
                    <span>
                      {offer?.name ?? 'Offre retirée'}
                      {offer?.kind !== 'custom_trio' && ` × ${l.qty}`}
                    </span>
                    <span className="num">{formatMoney(lineTotalOf(l, offer))}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div>
          <h3 className="section-title">Pièces à réserver</h3>
          <ul className="pieces">
            {needs.map(([variantId, qty]) => {
              const s = stock.get(variantId);
              const short = s ? qty > s.available_qty : false;
              return (
                <li key={variantId} className="pieces__row">
                  <PhotoSlot size={40} path={s?.photo_path} />
                  <span className="item-line__text">
                    <span className="item-line__name">
                      {s?.name ?? 'Référence'} × {qty}
                    </span>
                    <span className={short ? 'item-line__meta pieces__short' : 'item-line__meta'}>
                      {s?.sku}
                      {s && `, ${s.available_qty} disponible${s.available_qty > 1 ? 's' : ''}`}
                      {short && ' : stock insuffisant'}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <h3 className="section-title">Livraison</h3>
          <p>{cart.customer.name || <span className="muted">Nom à compléter</span>}</p>
          <p className="muted">
            {[phone ? formatPhone(phone) : cart.customer.phone, cart.customer.instagram].filter(Boolean).join(', ') || 'Téléphone à compléter'}
          </p>
          <p className="muted">{[cart.customer.address, cart.customer.city].filter(Boolean).join(', ') || 'Adresse à compléter'}</p>
          <p className="muted">Paiement à la livraison</p>
        </div>
        <dl className="kv review__totals">
          <dt>Bijoux</dt>
          <dd>{formatMoney(totals.items)}</dd>
          <dt>Livraison facturée</dt>
          <dd>{formatMoney(totals.shipping)}</dd>
          <dt>
            <b>Total à encaisser</b>
          </dt>
          <dd>
            <b>{formatMoney(totals.total)}</b>
          </dd>
        </dl>
      </div>
    </section>
  );
}
