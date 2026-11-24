import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { AppError, messageFor, toAppError } from '../../lib/errors';
import { parseMoney } from '../../lib/money';
import { preparePhoto, uploadPhoto } from '../../lib/photo';
import { SKU_PATTERN, suggestSku } from '../../lib/sku';
import { Button } from '../../ui/Button';
import { InlineStatus, type InlineState } from '../../ui/Feedback';
import { Field } from '../../ui/Field';
import { MoneyField } from '../../ui/MoneyField';
import { PhotoInput } from '../../ui/PhotoInput';
import type { StockRow } from '../stock/useStock';
import type { ArrivalLine } from './arrivalDraft';

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

type Errors = Partial<Record<'sku' | 'model' | 'label' | 'qty' | 'cost' | 'photo', string>>;

interface Props {
  stock: StockRow[];
  lines: ArrivalLine[];
  onAdd(line: ArrivalLine): void;
}

export function NewModelForm({ stock, lines, onAdd }: Props) {
  const titleId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [sku, setSku] = useState('');
  const [skuEdited, setSkuEdited] = useState(false);
  const [model, setModel] = useState('');
  const [label, setLabel] = useState('');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<{ state: InlineState; text: string }>({ state: 'idle', text: '' });
  const pending = status.state === 'pending';

  const taken = useMemo(() => new Set([...stock.map((s) => s.sku), ...lines.map((l) => l.sku)]), [stock, lines]);
  const productNames = useMemo(
    () => [...new Set([...stock.map((s) => s.product_name), ...lines.map((l) => l.productName)])].sort(),
    [stock, lines],
  );
  const knownModel = model.trim() !== '' && productNames.some((n) => fold(n) === fold(model));
  const shownSku = skuEdited ? sku : model.trim() ? suggestSku(model, label || null, taken) : '';

  function validate(): Errors {
    const e: Errors = {};
    const finalSku = shownSku.trim().toUpperCase();
    if (!model.trim()) e.model = 'Indiquez le nom du modèle.';
    if (!finalSku) e.sku = 'Indiquez une référence.';
    else if (!SKU_PATTERN.test(finalSku)) e.sku = 'Lettres sans accents, chiffres et tirets uniquement.';
    else if (taken.has(finalSku)) e.sku = 'Cette référence existe déjà.';
    const sameModelVariant = (name: string, variant: string | null) =>
      fold(name) === fold(model) && fold(variant ?? '') === fold(label);
    if (
      model.trim() &&
      (stock.some((s) => sameModelVariant(s.product_name, s.label)) || lines.some((l) => sameModelVariant(l.productName, l.label)))
    ) {
      e.label = 'Ce modèle existe déjà avec cette variante. Utilisez « Modèle existant » pour un réassort.';
    }
    if (!/^\d+$/.test(qty.trim()) || Number(qty) < 1) e.qty = 'Indiquez une quantité entière, au moins 1.';
    if (parseMoney(cost) === null) e.cost = 'Indiquez un coût valide, par exemple 30 ou 30,50.';
    return e;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      setStatus({ state: 'error', text: 'Corrigez les champs signalés.' });
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    setStatus({ state: 'pending', text: file ? 'Préparation de la photo…' : 'Ajout…' });
    let photoPath: string | null = null;
    if (file) {
      try {
        const blob = await preparePhoto(file);
        setProgress(0);
        setStatus({ state: 'pending', text: 'Envoi de la photo…' });
        photoPath = await uploadPhoto(blob, 'variants', setProgress);
      } catch (err) {
        const appErr = err instanceof AppError ? err : toAppError(err);
        setProgress(null);
        setErrors({ photo: messageFor(appErr) });
        setStatus({ state: 'error', text: 'La ligne n’a pas été ajoutée. Vos informations sont conservées.' });
        return;
      }
    }
    const finalSku = shownSku.trim().toUpperCase();
    const n = Number(qty);
    onAdd({
      key: crypto.randomUUID(),
      sku: finalSku,
      productName: model.trim(),
      label: label.trim() || null,
      qty: String(n),
      unitCost: cost.trim(),
      photoPath,
    });
    setStatus({ state: 'success', text: `Ligne ajoutée à l’arrivage : ${finalSku}, ${n} pièce${n > 1 ? 's' : ''}.` });
    // Keep the model and cost: the next line is often another variant of the same model.
    setSku('');
    setSkuEdited(false);
    setLabel('');
    setQty('');
    setFile(null);
    setProgress(null);
    setErrors({});
  }

  return (
    <form ref={formRef} className="panel arrival-form" aria-labelledby={titleId} onSubmit={onSubmit} noValidate>
      <h2 id={titleId} className="panel__title">
        Nouveau modèle
      </h2>
      <div className="form-grid">
        <Field label="Référence" error={errors.sku} hint={skuEdited ? undefined : 'Proposée automatiquement, modifiable.'}>
          {(p) => (
            <input
              {...p}
              className="input"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={shownSku}
              onChange={(e) => {
                const v = e.target.value.toUpperCase().replace(/\s+/g, '-');
                setSku(v);
                setSkuEdited(v !== '');
              }}
            />
          )}
        </Field>
        <Field label="Modèle" error={errors.model} hint={knownModel ? 'Modèle existant : cette ligne ajoute une variante.' : undefined}>
          {(p) => (
            <>
              <input
                {...p}
                className="input"
                list={`${titleId}-models`}
                autoComplete="off"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
              <datalist id={`${titleId}-models`}>
                {productNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label="Variante" optional error={errors.label} hint="Exemple : Or, Argent, taille 52.">
          {(p) => <input {...p} className="input" autoComplete="off" value={label} onChange={(e) => setLabel(e.target.value)} />}
        </Field>
        <div className="form-grid form-grid--2">
          <Field label="Quantité reçue" error={errors.qty}>
            {(p) => (
              <input
                {...p}
                className="input num"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            )}
          </Field>
          <MoneyField label="Coût d’achat unitaire" value={cost} onChange={setCost} error={errors.cost} />
        </div>
        <PhotoInput
          file={file}
          onChange={(f) => {
            setFile(f);
            setErrors((e) => ({ ...e, photo: undefined }));
          }}
          error={errors.photo}
          progress={progress}
        />
        <div>
          <Button type="submit" variant="primary" pending={pending}>
            Ajouter à l’arrivage
          </Button>
          <InlineStatus state={status.state}>{status.text}</InlineStatus>
        </div>
      </div>
    </form>
  );
}
