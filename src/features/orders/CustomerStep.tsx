import { useId } from 'react';
import { formatPhone, normalizePhone } from '../../lib/phone';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Notice } from '../../ui/Feedback';
import { MoneyField } from '../../ui/MoneyField';
import type { CustomerInput } from './cart';
import { useKnownCustomer } from './useOrders';

interface Props {
  customer: CustomerInput;
  shippingFee: string;
  errors: Partial<Record<keyof CustomerInput | 'shippingFee', string>>;
  onChange(customer: CustomerInput): void;
  onShippingFee(value: string): void;
}

export function CustomerStep({ customer, shippingFee, errors, onChange, onShippingFee }: Props) {
  const titleId = useId();
  const phone = normalizePhone(customer.phone);
  const known = useKnownCustomer(phone);
  const k = known.data;
  const set = (patch: Partial<CustomerInput>) => onChange({ ...customer, ...patch });
  const alreadyApplied = k && customer.name === k.name && customer.address === k.address;

  return (
    <section className="panel order-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="panel__title">
        Cliente
      </h2>
      <div className="form-grid">
        <Field
          label="Téléphone"
          error={errors.phone}
          hint={phone ? `Numéro reconnu : ${formatPhone(phone)}` : 'Numéro marocain, par exemple 06 12 34 56 78.'}
        >
          {(p) => (
            <input
              {...p}
              className="input num"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={customer.phone}
              onChange={(e) => set({ phone: e.target.value })}
            />
          )}
        </Field>
        {k && !alreadyApplied && (
          <Notice tone="info" title={`Cliente connue : ${k.name}`}>
            <p>
              {k.orders} commande{k.orders > 1 ? 's' : ''}
              {k.returns > 0 ? `, ${k.returns} retour${k.returns > 1 ? 's' : ''}` : ''}. {[k.city, k.address].filter(Boolean).join(', ')}
            </p>
            <p>
              <Button
                size="small"
                onClick={() =>
                  set({ name: k.name, instagram: k.instagram ?? customer.instagram, city: k.city || customer.city, address: k.address || customer.address })
                }
              >
                Utiliser ses coordonnées
              </Button>
            </p>
          </Notice>
        )}
        <div className="form-grid form-grid--2">
          <Field label="Nom de la cliente" error={errors.name}>
            {(p) => <input {...p} className="input" autoComplete="off" value={customer.name} onChange={(e) => set({ name: e.target.value })} />}
          </Field>
          <Field label="Pseudo Instagram" optional>
            {(p) => (
              <input
                {...p}
                className="input"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="@pseudo"
                value={customer.instagram}
                onChange={(e) => set({ instagram: e.target.value })}
              />
            )}
          </Field>
        </div>
        <Field label="Ville" error={errors.city}>
          {(p) => <input {...p} className="input" autoComplete="off" value={customer.city} onChange={(e) => set({ city: e.target.value })} />}
        </Field>
        <Field label="Adresse" error={errors.address}>
          {(p) => <textarea {...p} className="textarea" rows={2} value={customer.address} onChange={(e) => set({ address: e.target.value })} />}
        </Field>
        <div className="form-grid form-grid--2">
          <MoneyField label="Frais de livraison facturés" value={shippingFee} onChange={onShippingFee} error={errors.shippingFee} />
          <div className="field">
            <span className="field__label">Paiement</span>
            <p className="payment-mode">À la livraison</p>
          </div>
        </div>
      </div>
    </section>
  );
}
