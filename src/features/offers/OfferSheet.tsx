import { useId, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { centsToInput, formatMoney, parseMoney } from '../../lib/money';
import { messageFor, invalidField, toAppError } from '../../lib/errors';
import { preparePhoto, uploadPhoto } from '../../lib/photo';
import { useRequest } from '../../lib/useRequest';
import { Button } from '../../ui/Button';
import { Switch } from '../../ui/Controls';
import { InlineStatus, Notice } from '../../ui/Feedback';
import { Field } from '../../ui/Field';
import { MoneyField } from '../../ui/MoneyField';
import { PhotoInput } from '../../ui/PhotoInput';
import { pendingArrivalLines } from '../arrivals/arrivalDraft';
import type { StockRow } from '../stock/useStock';
import { ReferencePicker } from './ReferencePicker';
import { TrioPicker } from './TrioPicker';
import { KIND_LABELS, availabilityLabel, buildableTrios, composition, minUnitPrices, type OfferKind, type OfferRow } from './useOffers';

interface Props {
  offer: OfferRow | null;
  offers: OfferRow[];
  stock: StockRow[];
  onSaved(name: string): void;
}

type Errors = Partial<Record<'name' | 'price' | 'items' | 'photo' | string, string>>;

/** Shown instead of the composition when no reference is in stock yet. */
function NoStockNotice() {
  const [pending] = useState(pendingArrivalLines);
  return (
    <Notice tone="info" title="Aucune référence en stock pour composer cette offre.">
      {pending > 0 ? (
        <p>
          Votre arrivage en cours compte {pending} ligne{pending > 1 ? 's' : ''} pas encore validée{pending > 1 ? 's' : ''} : validez-le pour que ses
          pièces apparaissent ici.
        </p>
      ) : (
        <p>Les pièces d’une offre viennent du stock : validez d’abord un arrivage.</p>
      )}
      <Link to="/stock/arrivage" className="btn btn--secondary btn--small notice__action">
        {pending > 0 ? 'Reprendre l’arrivage' : 'Nouvel arrivage'}
      </Link>
    </Notice>
  );
}

function initialFixed(offer: OfferRow | null): string[] {
  if (!offer || offer.kind !== 'fixed_trio') return [];
  return offer.items.flatMap((i) => Array.from({ length: i.qty }, () => i.variant_id));
}

/** Create or edit an offer: name, format, price, photo, channels and composition. */
export function OfferForm({ offer, offers, stock, onSaved }: Props) {
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(offer?.name ?? '');
  const [kind, setKind] = useState<OfferKind>(offer?.kind ?? 'unit');
  const [price, setPrice] = useState(offer ? centsToInput(offer.price_cents) : '');
  const [unitIds, setUnitIds] = useState<string[]>(offer?.kind === 'unit' ? offer.items.map((i) => i.variant_id) : []);
  const [perVariant, setPerVariant] = useState(offer?.kind === 'unit' && offer.items.some((i) => i.price_cents != null));
  const [variantPrices, setVariantPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries((offer?.items ?? []).map((i) => [i.variant_id, i.price_cents != null ? centsToInput(i.price_cents) : centsToInput(offer!.price_cents)])),
  );
  const [fixedIds, setFixedIds] = useState<string[]>(() => initialFixed(offer));
  const [eligibleIds, setEligibleIds] = useState<string[]>(offer?.kind === 'custom_trio' ? offer.items.map((i) => i.variant_id) : []);
  const [allowRepeat, setAllowRepeat] = useState(offer?.allow_repeat ?? false);
  const [onInstagram, setOnInstagram] = useState(offer?.on_instagram ?? true);
  const [onSite, setOnSite] = useState(offer?.on_site ?? false);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [uploading, setUploading] = useState(false);
  const save = useRequest<{ p_offer: object }, { offer_id: string }>('save_offer');

  const hasReferences = stock.some((s) => !s.archived);
  const available = (id: string) => stock.find((s) => s.variant_id === id)?.available_qty ?? 0;
  const unitPrices = minUnitPrices(offers.filter((o) => o.id !== offer?.id));
  const fixedComposition = [...composition(fixedIds)];
  const unitSum = fixedComposition.every(([id]) => unitPrices.has(id))
    ? fixedComposition.reduce((sum, [id, qty]) => sum + qty * unitPrices.get(id)!, 0)
    : null;
  const priceCents = parseMoney(price);
  const notCheaper = kind === 'fixed_trio' && fixedIds.length === 3 && unitSum != null && priceCents != null && priceCents >= unitSum;
  const usesVariantPrices = kind === 'unit' && perVariant && unitIds.length > 1;

  function validate(): Errors {
    const e: Errors = {};
    if (!name.trim()) e.name = 'Indiquez le nom de l’offre.';
    if (usesVariantPrices) {
      for (const id of unitIds) if (parseMoney(variantPrices[id] ?? '') === null) e[`price-${id}`] = 'Indiquez un prix valide.';
    } else if (priceCents === null) e.price = 'Indiquez un prix valide, par exemple 240 ou 239,90.';
    if (kind === 'unit' && unitIds.length === 0) e.items = 'Choisissez au moins une référence vendue.';
    if (kind === 'fixed_trio' && fixedIds.length !== 3) e.items = 'Choisissez exactement trois pièces.';
    if (kind === 'custom_trio' && eligibleIds.length < (allowRepeat ? 1 : 3))
      e.items = allowRepeat ? 'Choisissez au moins une pièce éligible.' : 'Choisissez au moins trois pièces éligibles.';
    return e;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (save.pending || uploading) return;
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], .field__error')?.scrollIntoView({ block: 'center' }));
      return;
    }
    let photoPath: string | null = null;
    if (file) {
      setUploading(true);
      try {
        const blob = await preparePhoto(file);
        setProgress(0);
        photoPath = await uploadPhoto(blob, 'offers', setProgress);
      } catch (err) {
        setErrors({ photo: messageFor(toAppError(err)) });
        return;
      } finally {
        setUploading(false);
        setProgress(null);
      }
    }
    const items =
      kind === 'unit'
        ? unitIds.map((id) => ({ variant_id: id, qty: 1, price_cents: usesVariantPrices ? parseMoney(variantPrices[id] ?? '') : null }))
        : kind === 'fixed_trio'
          ? fixedComposition.map(([id, qty]) => ({ variant_id: id, qty }))
          : eligibleIds.map((id) => ({ variant_id: id, qty: 1 }));
    const finalPrice = usesVariantPrices ? Math.min(...unitIds.map((id) => parseMoney(variantPrices[id] ?? '') ?? 0)) : priceCents!;
    const result = await save.run({
      p_offer: {
        id: offer?.id ?? null,
        name: name.trim(),
        kind,
        price_cents: finalPrice,
        photo_path: photoPath,
        on_instagram: onInstagram,
        on_site: onSite,
        allow_repeat: allowRepeat,
        items,
      },
    });
    if (result) onSaved(name.trim());
  }

  const serverField = invalidField(save.error);
  return (
    <form ref={formRef} id={formId} className="form-grid offer-form" onSubmit={onSubmit} noValidate>
      <Field label="Nom de l’offre" error={errors.name ?? (serverField === 'name' ? 'Indiquez le nom de l’offre.' : null)}>
        {(p) => <input {...p} className="input" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>

      <fieldset className="kind-choice">
        <legend>Format</legend>
        {offer && <p className="field__hint">Le format d’une offre existante ne change pas : créez une nouvelle offre si besoin.</p>}
        <div className="kind-choice__options">
          {(Object.keys(KIND_LABELS) as OfferKind[]).map((k) => (
            <label key={k} className="check kind-choice__option">
              <input type="radio" name={`${formId}-kind`} checked={kind === k} disabled={!!offer && offer.kind !== k} onChange={() => setKind(k)} />
              <span>{KIND_LABELS[k]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {kind === 'unit' && (
        <>
          {hasReferences ? (
            <ReferencePicker legend="Références vendues" stock={stock} selected={unitIds} onChange={setUnitIds} error={errors.items} />
          ) : (
            <NoStockNotice />
          )}
          {unitIds.length > 1 && (
            <fieldset className="kind-choice">
              <legend>Prix</legend>
              <div className="kind-choice__options">
                <label className="check">
                  <input type="radio" name={`${formId}-price`} checked={!perVariant} onChange={() => setPerVariant(false)} />
                  <span>Prix commun</span>
                </label>
                <label className="check">
                  <input type="radio" name={`${formId}-price`} checked={perVariant} onChange={() => setPerVariant(true)} />
                  <span>Prix par variante</span>
                </label>
              </div>
            </fieldset>
          )}
          {usesVariantPrices ? (
            <div className="form-grid form-grid--2">
              {unitIds.map((id) => {
                const s = stock.find((x) => x.variant_id === id);
                return (
                  <MoneyField
                    key={id}
                    label={`Prix pour ${s?.sku ?? id}`}
                    value={variantPrices[id] ?? ''}
                    onChange={(v) => setVariantPrices((p) => ({ ...p, [id]: v }))}
                    error={errors[`price-${id}`]}
                    hint={s?.name}
                  />
                );
              })}
            </div>
          ) : (
            <MoneyField label="Prix de vente" value={price} onChange={setPrice} error={errors.price} />
          )}
        </>
      )}

      {kind === 'fixed_trio' && (
        <>
          {hasReferences ? (
            <TrioPicker mode="fixed" label="Composition du trio" candidates={stock.filter((s) => !s.archived)} value={fixedIds} allowRepeat onChange={setFixedIds} />
          ) : (
            <NoStockNotice />
          )}
          {errors.items && (
            <p className="field__error" role="alert">
              {errors.items}
            </p>
          )}
          <MoneyField label="Prix de vente" value={price} onChange={setPrice} error={errors.price} />
          {fixedIds.length === 3 && (
            <div className="trio-facts">
              <p className="num">
                {unitSum != null ? `Mêmes pièces à l’unité : ${formatMoney(unitSum)}` : 'Pas de prix à l’unité pour toutes ces pièces.'}
              </p>
              <p className="num">{availabilityLabel('fixed_trio', buildableTrios(fixedIds, available))}</p>
            </div>
          )}
          {notCheaper && (
            <Notice tone="warn">
              <p>Ce trio n’est pas moins cher que les mêmes pièces à l’unité.</p>
            </Notice>
          )}
        </>
      )}

      {kind === 'custom_trio' && (
        <>
          {hasReferences ? (
            <ReferencePicker legend="Pièces éligibles" stock={stock} selected={eligibleIds} onChange={setEligibleIds} error={errors.items} />
          ) : (
            <NoStockNotice />
          )}
          <Switch label="Autoriser la même pièce plusieurs fois" checked={allowRepeat} onChange={setAllowRepeat} onText="Autorisé" offText="Non autorisé" />
          <MoneyField label="Prix de vente" value={price} onChange={setPrice} error={errors.price} hint="Prix fixe, affiché avant le choix des pièces." />
          <p className="num muted">{availabilityLabel('custom_trio', eligibleIds.filter((id) => available(id) > 0).length)}</p>
        </>
      )}

      <PhotoInput legend="Photo de l’offre" file={file} currentPath={offer?.photo_path} onChange={setFile} error={errors.photo} progress={progress} />

      <fieldset className="channels">
        <legend>Canaux</legend>
        <div className="channels__row">
          <span>Instagram</span>
          <Switch label="Canal Instagram" checked={onInstagram} onChange={setOnInstagram} />
        </div>
        <div className="channels__row">
          <span>Site</span>
          <Switch label="Canal Site" checked={onSite} onChange={setOnSite} />
        </div>
      </fieldset>

      <div className="offer-form__submit">
        <Button type="submit" variant="primary" pending={save.pending || uploading}>
          Enregistrer l’offre
        </Button>
        <InlineStatus state={save.error ? 'error' : Object.keys(errors).length ? 'error' : 'idle'}>
          {save.error ? messageFor(save.error) : 'Corrigez les champs signalés.'}
        </InlineStatus>
      </div>
    </form>
  );
}
