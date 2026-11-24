import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useSWRConfig } from 'swr';
import { ActionBar } from '../../app/ActionBar';
import { messageFor, type AppError } from '../../lib/errors';
import { centsToInput, formatMoney, parseMoney } from '../../lib/money';
import { read } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { useMediaQuery, WIDE } from '../../lib/useMediaQuery';
import { useRequest } from '../../lib/useRequest';
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/Controls';
import { InlineStatus, Notice } from '../../ui/Feedback';
import { IconBack } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';
import { OFFERS_KEY, useOffers } from '../offers/useOffers';
import { STOCK_KEY, useSettings, useStock } from '../stock/useStock';
import { emptyCart, useCart, type Cart, type CartLine, type CustomerInput } from './cart';
import { CartStep } from './CartStep';
import { CustomerStep } from './CustomerStep';
import { cartTotals, ReviewStep } from './ReviewStep';
import { ORDERS_KEY, type OrderRow } from './useOrders';
import './orders.css';

interface Alert {
  sku: string;
  name: string;
  after: number;
  offers: { id: string; name: string }[];
}

type Done =
  | { kind: 'draft'; number: string; orderId: string }
  | { kind: 'confirmed'; number: string; orderId: string; alerts: Alert[] };

const STEPS = ['Panier', 'Cliente', 'Récapitulatif'] as const;

const FIELD_OF: Record<string, keyof CustomerInput> = {
  customer_name: 'name',
  customer_phone: 'phone',
  customer_city: 'city',
  customer_address: 'address',
};
const FIELD_MESSAGES: Record<keyof CustomerInput, string> = {
  name: 'Indiquez le nom de la cliente.',
  phone: 'Numéro marocain attendu, par exemple 06 12 34 56 78.',
  city: 'Indiquez la ville de livraison.',
  address: 'Indiquez l’adresse de livraison.',
  instagram: '',
};

function cartFromOrder(order: OrderRow): Cart {
  const lines: CartLine[] = order.lines.map((l) => {
    const items = order.items.filter((i) => i.line_id === l.id);
    return {
      key: crypto.randomUUID(),
      offerId: l.offer_id ?? '',
      qty: l.qty,
      variantId: l.offer_kind === 'unit' ? items[0]?.variant_id : undefined,
      picks: l.offer_kind === 'custom_trio' ? items.flatMap((i) => Array.from({ length: i.qty }, () => i.variant_id)) : undefined,
    };
  });
  return {
    orderId: order.id,
    lines,
    customer: {
      phone: order.customer_phone,
      name: order.customer_name,
      instagram: order.customer_instagram ?? '',
      city: order.customer_city,
      address: order.customer_address,
    },
    shippingFee: centsToInput(order.shipping_fee_cents),
    step: 0,
  };
}

export function NewOrderPage() {
  const wide = useMediaQuery(WIDE);
  const [params, setParams] = useSearchParams();
  const offers = useOffers();
  const stock = useStock();
  const settings = useSettings();
  const { mutate } = useSWRConfig();
  const [cart, setCart, forgetCart] = useCart();
  const [done, setDone] = useState<Done | null>(null);
  const [customerErrors, setCustomerErrors] = useState<Partial<Record<keyof CustomerInput | 'shippingFee', string>>>({});
  const [localError, setLocalError] = useState<string | null>(null);
  const busy = useRef(false);
  // Payload of a confirmation whose answer was lost on the network (the server may have applied it).
  const unanswered = useRef<string | null>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const saveDraft = useRequest<{ p_order: object }, { order_id: string; number: string }>('save_order_draft');
  const confirmOrder = useRequest<{ p_order_id: string }, { order_id: string; number: string; alerts: Alert[] }>('confirm_order');

  const offerMap = useMemo(() => new Map((offers.data ?? []).map((o) => [o.id, o])), [offers.data]);
  const stockMap = useMemo(() => new Map((stock.data ?? []).map((s) => [s.variant_id, s])), [stock.data]);

  // Resume a saved draft: /commandes/nouvelle?brouillon=<id>
  const draftId = params.get('brouillon');
  useEffect(() => {
    if (!draftId) return;
    let active = true;
    read<OrderRow | null>(supabase.from('v_orders').select('*').eq('id', draftId).maybeSingle()).then((order) => {
      if (!active) return;
      if (order?.status === 'brouillon') setCart(cartFromOrder(order));
      setParams({}, { replace: true });
    });
    return () => {
      active = false;
    };
  }, [draftId, setCart, setParams]);

  // Default shipping fee from the settings, once.
  useEffect(() => {
    const fee = settings.data?.default_shipping_fee_cents;
    if (fee != null && cart.shippingFee === '' && !cart.orderId) setCart((c) => ({ ...c, shippingFee: centsToInput(fee) }));
  }, [settings.data, cart.shippingFee, cart.orderId, setCart]);

  const setStep = useCallback((step: Cart['step']) => setCart((c) => ({ ...c, step })), [setCart]);
  const totals = cartTotals(cart, offerMap);

  async function submit(confirm: boolean) {
    if (busy.current) return;
    const payload = {
      id: cart.orderId ?? null,
      customer: cart.customer,
      shipping_fee_cents: parseMoney(cart.shippingFee) ?? 0,
      payment_method: 'cod',
      lines: cart.lines.map((l) => ({ offer_id: l.offerId, qty: l.qty, variant_id: l.variantId ?? null, picks: l.picks ?? null })),
    };
    // Same order, unchanged, after a network failure: retry the confirmation itself (same request key),
    // so a confirmation already applied by the server is returned instead of being refused.
    if (confirm && cart.orderId && unanswered.current === JSON.stringify(payload)) {
      busy.current = true;
      try {
        setLocalError(null);
        const result = await confirmOrder.run({ p_order_id: cart.orderId });
        if (!result) return;
        unanswered.current = null;
        finish({ kind: 'confirmed', number: result.number, orderId: cart.orderId, alerts: result.alerts });
      } finally {
        busy.current = false;
      }
      return;
    }
    unanswered.current = null;
    setLocalError(null);
    saveDraft.reset();
    confirmOrder.reset();
    if (cart.lines.length === 0) {
      setLocalError('Ajoutez au moins une offre.');
      return;
    }
    if (cart.shippingFee.trim() !== '' && parseMoney(cart.shippingFee) === null) {
      setCustomerErrors({ shippingFee: 'Montant invalide. Exemple : 35 ou 35,50' });
      if (!wide) setStep(1);
      return;
    }
    busy.current = true;
    try {
      const saved = await saveDraft.run({ p_order: payload });
      if (!saved) return;
      setCart((c) => ({ ...c, orderId: saved.order_id }));
      if (!confirm) {
        finish({ kind: 'draft', number: saved.number, orderId: saved.order_id });
        return;
      }
      const result = await confirmOrder.run({ p_order_id: saved.order_id });
      if (!result) {
        unanswered.current = JSON.stringify({ ...payload, id: saved.order_id });
        return;
      }
      finish({ kind: 'confirmed', number: result.number, orderId: saved.order_id, alerts: result.alerts });
    } finally {
      busy.current = false;
    }
  }

  function finish(result: Done) {
    forgetCart();
    setCart(emptyCart());
    setCustomerErrors({});
    setDone(result);
    void mutate(ORDERS_KEY);
    void mutate(STOCK_KEY);
    void mutate(OFFERS_KEY);
    requestAnimationFrame(() => doneRef.current?.focus());
  }

  // Server errors that point to a customer field go under that field.
  const serverError: AppError | null = saveDraft.error ?? confirmOrder.error;
  useEffect(() => {
    const field = (serverError?.details as { field?: string } | null)?.field;
    if (serverError?.code === 'VALEUR_INVALIDE' && field && FIELD_OF[field]) {
      const key = FIELD_OF[field];
      setCustomerErrors({ [key]: FIELD_MESSAGES[key] });
      if (!wide) setStep(1);
    }
  }, [serverError, wide, setStep]);

  const lineError = (() => {
    const d = serverError?.details as { line?: number } | null;
    if (!serverError || !d || typeof d.line !== 'number') return {};
    const line = cart.lines[d.line];
    return line ? { [line.key]: messageFor(serverError) } : {};
  })();

  const shortages = serverError?.code === 'STOCK_INSUFFISANT' ? (serverError.details as { sku: string; need: number; available: number }[]) : [];
  const pending = saveDraft.pending || confirmOrder.pending;

  if (done) {
    return (
      <>
        <PageHeader title="Nouvelle commande" />
        <div ref={doneRef} tabIndex={-1} className="order-done">
          {done.kind === 'confirmed' ? (
            <Notice tone="ok" title={`Commande ${done.number} confirmée. Les pièces sont réservées.`}>
              <p>Elle apparaît dans « À préparer ».</p>
            </Notice>
          ) : (
            <Notice tone="info" title={`Brouillon ${done.number} enregistré. Aucune pièce réservée.`}>
              <p>Reprenez-le depuis la liste des commandes pour le confirmer.</p>
            </Notice>
          )}
          {done.kind === 'confirmed' &&
            done.alerts.map((a) => (
              <Notice key={a.sku} tone="warn" title={`Stock bas : ${a.name}, ${a.after} disponible${a.after > 1 ? 's' : ''}`}>
                {a.offers.length > 0 && <p>Offres concernées : {a.offers.map((o) => o.name).join(', ')}. Leur pause reste manuelle.</p>}
              </Notice>
            ))}
          <div className="order-done__actions">
            <Button variant="primary" onClick={() => setDone(null)}>
              Nouvelle commande
            </Button>
            <Link className="btn btn--secondary" to={`/commandes/${done.orderId}`}>
              Voir la commande
            </Link>
          </div>
        </div>
      </>
    );
  }

  const actions = (
    <div className="order-actions">
      <InlineStatus state={localError || serverError ? 'error' : 'idle'}>
        {localError ?? (serverError && messageFor(serverError))}
        {shortages.length > 0 && (
          <ul>
            {shortages.map((s) => (
              <li key={s.sku}>
                {s.sku} : besoin {s.need}, disponible {s.available}
              </li>
            ))}
          </ul>
        )}
      </InlineStatus>
      {!wide && shortages.length > 0 && (
        <Button variant="ghost" size="small" onClick={() => setStep(0)}>
          Retour au panier
        </Button>
      )}
      <div className="order-actions__buttons">
        <Button variant="secondary" onClick={() => submit(false)} disabled={pending}>
          Enregistrer en brouillon
        </Button>
        <Button variant="primary" pending={pending} onClick={() => submit(true)}>
          Confirmer la commande
        </Button>
      </div>
    </div>
  );

  if (!offers.data || !stock.data) {
    return (
      <>
        <PageHeader title="Nouvelle commande" />
        <Skeleton rows={4} />
      </>
    );
  }

  const cartStep = (
    <CartStep
      cart={cart}
      offers={offers.data}
      stock={stockMap}
      lineErrors={lineError}
      onChange={(lines) => setCart((c) => ({ ...c, lines }))}
    />
  );
  const customerStep = (
    <CustomerStep
      customer={cart.customer}
      shippingFee={cart.shippingFee}
      errors={customerErrors}
      onChange={(customer) => {
        setCart((c) => ({ ...c, customer }));
        setCustomerErrors({});
      }}
      onShippingFee={(shippingFee) => setCart((c) => ({ ...c, shippingFee }))}
    />
  );
  const review = <ReviewStep cart={cart} offers={offerMap} stock={stockMap} />;

  return (
    <>
      <Link to="/commandes" className="back-link">
        <IconBack size={18} aria-hidden="true" />
        Commandes
      </Link>
      <PageHeader title="Nouvelle commande" count={cart.orderId ? 'Brouillon repris' : 'Instagram'} />
      {wide ? (
        <div className="new-order">
          <div className="new-order__top">
            {cartStep}
            {customerStep}
          </div>
          {review}
          <div className="panel new-order__actions">{actions}</div>
        </div>
      ) : (
        <>
          <ol className="steps" aria-label="Étapes de la commande">
            {STEPS.map((label, i) => (
              <li key={label}>
                <button type="button" className="steps__item" aria-current={cart.step === i ? 'step' : undefined} onClick={() => setStep(i as Cart['step'])}>
                  <span className="steps__number num">{i + 1}</span>
                  {label}
                </button>
              </li>
            ))}
          </ol>
          {cart.step === 0 && cartStep}
          {cart.step === 1 && customerStep}
          {cart.step === 2 && review}
          <ActionBar summary={cart.step < 2 ? (cart.lines.length ? `${cart.lines.length} article${cart.lines.length > 1 ? 's' : ''}, ${formatMoney(totals.total)}` : 'Panier vide') : undefined}>
            {cart.step < 2 ? (
              <div className="order-actions__buttons">
                {cart.step === 1 && (
                  <Button variant="ghost" onClick={() => setStep(0)}>
                    Retour au panier
                  </Button>
                )}
                <Button variant="primary" onClick={() => setStep((cart.step + 1) as Cart['step'])}>
                  Continuer
                </Button>
              </div>
            ) : (
              actions
            )}
          </ActionBar>
        </>
      )}
    </>
  );
}
