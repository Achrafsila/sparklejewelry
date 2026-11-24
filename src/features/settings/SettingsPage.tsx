import { useId, useState, type FormEvent } from 'react';
import { useSWRConfig } from 'swr';
import { useAuth } from '../../app/auth';
import { todayIso } from '../../lib/dates';
import { messageFor, toAppError, type AppError } from '../../lib/errors';
import { centsToInput, parseMoney } from '../../lib/money';
import { callRpc, read } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { useRequest } from '../../lib/useRequest';
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/Controls';
import { InlineStatus, Notice, type InlineState } from '../../ui/Feedback';
import { Field } from '../../ui/Field';
import { IconClose } from '../../ui/icons';
import { MoneyField } from '../../ui/MoneyField';
import { PageHeader } from '../../ui/PageHeader';
import { OFFERS_KEY } from '../offers/useOffers';
import { RECEIPTS_KEY, SETTINGS_KEY, STOCK_KEY, useSettings, type Settings } from '../stock/useStock';
import { summarizePrototype, type PrototypeSummary } from './importPrototype';
import './settings.css';

function SettingsForm({ settings }: { settings: Settings }) {
  const { mutate } = useSWRConfig();
  const [threshold, setThreshold] = useState(String(settings.low_stock_threshold));
  const [packaging, setPackaging] = useState(centsToInput(settings.packaging_cost_cents));
  const [fee, setFee] = useState(centsToInput(settings.default_shipping_fee_cents));
  const [carriers, setCarriers] = useState<string[]>(settings.carriers);
  const [newCarrier, setNewCarrier] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ state: InlineState; text: string }>({ state: 'idle', text: '' });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!/^\d+$/.test(threshold.trim())) errs.threshold = 'Un nombre entier de pièces, par exemple 5.';
    const packagingCents = packaging.trim() === '' ? null : parseMoney(packaging);
    if (packaging.trim() !== '' && packagingCents === null) errs.packaging = 'Montant invalide. Exemple : 8 ou 8,50.';
    const feeCents = fee.trim() === '' ? null : parseMoney(fee);
    if (fee.trim() !== '' && feeCents === null) errs.fee = 'Montant invalide. Exemple : 35.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setStatus({ state: 'pending', text: 'Enregistrement…' });
    try {
      const extra = newCarrier.trim() && !carriers.some((c) => c.toLowerCase() === newCarrier.trim().toLowerCase()) ? [newCarrier.trim()] : [];
      await read(
        supabase
          .from('settings')
          .update({
            low_stock_threshold: Number(threshold),
            packaging_cost_cents: packagingCents,
            default_shipping_fee_cents: feeCents,
            carriers: [...carriers, ...extra],
            updated_at: new Date().toISOString(),
          })
          .eq('id', true)
          .select('id'),
      );
      setCarriers((c) => [...c, ...extra]);
      setNewCarrier('');
      setStatus({ state: 'success', text: 'Réglages enregistrés.' });
      await Promise.all([mutate(SETTINGS_KEY), mutate(STOCK_KEY)]);
    } catch (err) {
      setStatus({ state: 'error', text: messageFor(toAppError(err)) });
    }
  }

  return (
    <form className="panel form-grid" onSubmit={onSubmit} noValidate aria-labelledby="settings-title">
      <h2 id="settings-title" className="panel__title">
        Règles de gestion
      </h2>
      <div className="form-grid form-grid--2">
        <Field label="Seuil d’alerte de stock bas" hint="Alerte quand le disponible passe à ce nombre ou moins." error={errors.threshold}>
          {(p) => <input {...p} className="input num" inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} />}
        </Field>
        <MoneyField label="Coût d’emballage par colis" value={packaging} onChange={setPackaging} error={errors.packaging} hint="Pochette, boîte, carte : appliqué à chaque colis expédié." />
        <MoneyField label="Frais de livraison facturés par défaut" value={fee} onChange={setFee} error={errors.fee} hint="Prérempli sur chaque nouvelle commande, modifiable." />
      </div>
      <fieldset className="carriers">
        <legend>Transporteurs</legend>
        {carriers.length === 0 ? (
          <p className="muted">Ajoutés automatiquement à la première expédition, ou ici.</p>
        ) : (
          <ul className="carriers__list">
            {carriers.map((c) => (
              <li key={c} className="carriers__chip">
                {c}
                <button type="button" className="icon-btn" aria-label={`Retirer ${c}`} onClick={() => setCarriers((list) => list.filter((x) => x !== c))}>
                  <IconClose size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Field label="Ajouter un transporteur" optional>
          {(p) => <input {...p} className="input" value={newCarrier} onChange={(e) => setNewCarrier(e.target.value)} />}
        </Field>
      </fieldset>
      <div>
        <Button type="submit" variant="primary" pending={status.state === 'pending'}>
          Enregistrer les réglages
        </Button>
        <InlineStatus state={status.state}>{status.text}</InlineStatus>
      </div>
    </form>
  );
}

function DataTools() {
  const { mutate } = useSWRConfig();
  const fileId = useId();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PrototypeSummary | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [imported, setImported] = useState<string | null>(null);
  const run = useRequest<{ p_data: object }, { variants: number; receipts: number; offers: number }>('import_prototype');

  async function onExport() {
    setExporting(true);
    setExportError(null);
    try {
      const data = await callRpc<object>('export_all');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `sparkle-export-${todayIso()}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    } catch (e) {
      setExportError(messageFor(toAppError(e)));
    } finally {
      setExporting(false);
    }
  }

  async function onFile(file: File | undefined) {
    setSummary(null);
    setFileError(null);
    setImported(null);
    run.reset();
    if (!file) return;
    try {
      setSummary(summarizePrototype(await file.text()));
    } catch (e) {
      setFileError((e as Error).message);
    }
  }

  async function onImport() {
    if (!summary) return;
    const r = await run.run({ p_data: summary.data });
    if (!r) return;
    setImported(`Import terminé : ${r.variants} référence${r.variants > 1 ? 's' : ''}, ${r.receipts} arrivage${r.receipts > 1 ? 's' : ''}, ${r.offers} offre${r.offers > 1 ? 's' : ''}.`);
    setSummary(null);
    await Promise.all([mutate(STOCK_KEY), mutate(OFFERS_KEY), mutate(RECEIPTS_KEY)]);
  }

  const skipped = summary ? [summary.photos && `${summary.photos} photo${summary.photos > 1 ? 's' : ''}`, summary.orders && `${summary.orders} commande${summary.orders > 1 ? 's' : ''}`].filter(Boolean) : [];
  const conflict = run.error?.code === 'IMPORT_CONFLIT' ? ((run.error.details as { skus?: string[] })?.skus ?? []) : [];

  return (
    <section className="panel form-grid" aria-labelledby="data-title">
      <h2 id="data-title" className="panel__title">
        Données
      </h2>
      <div>
        <p className="muted">Une copie complète au format JSON : références, mouvements, offres, commandes, versements.</p>
        <Button onClick={onExport} pending={exporting}>
          Exporter toutes les données
        </Button>
        <InlineStatus state={exportError ? 'error' : 'idle'}>{exportError}</InlineStatus>
      </div>
      <div className="form-grid">
        <h3 className="section-title">Importer un export du prototype</h3>
        <p className="muted">Fichier obtenu avec le bouton « Exporter (JSON) » de l’ancien prototype. Les commandes de test et les photos ne sont pas reprises.</p>
        <div className="field">
          <label className="field__label" htmlFor={fileId}>
            Fichier exporté du prototype
          </label>
          <input id={fileId} type="file" accept="application/json,.json" className="file-input" onChange={(e) => onFile(e.target.files?.[0])} />
          {fileError && (
            <p className="field__error" role="alert">
              {fileError}
            </p>
          )}
        </div>
        {summary && (
          <Notice tone="info" title="Aperçu">
            <p>
              {summary.variants} référence{summary.variants > 1 ? 's' : ''}, {summary.receipts} arrivage{summary.receipts > 1 ? 's' : ''}, {summary.offers} offre
              {summary.offers > 1 ? 's' : ''}.
              {skipped.length > 0 && ` ${skipped.join(' et ')} ne seront pas importée${summary.photos + summary.orders > 1 ? 's' : ''}.`}
            </p>
            <p>
              <Button variant="primary" pending={run.pending} onClick={onImport}>
                Importer
              </Button>
            </p>
          </Notice>
        )}
        <InlineStatus state={imported ? 'success' : run.error ? 'error' : 'idle'}>
          {imported ?? (conflict.length ? `Ces références existent déjà : ${conflict.join(', ')}. Rien n’a été importé.` : run.error && messageFor(run.error))}
        </InlineStatus>
      </div>
    </section>
  );
}

export function SettingsPage() {
  const settings = useSettings();
  const { session } = useAuth();
  const error = settings.error as AppError | undefined;
  return (
    <>
      <PageHeader title="Réglages" />
      <div className="settings">
        {error ? (
          <Notice tone="err" title={messageFor(error)} />
        ) : !settings.data ? (
          <Skeleton rows={3} />
        ) : (
          <SettingsForm settings={settings.data} />
        )}
        <DataTools />
        <section className="panel" aria-labelledby="account-title">
          <h2 id="account-title" className="panel__title">
            Compte
          </h2>
          <p className="muted">Compte connecté : {session?.user.email}</p>
          <p>
            <Button variant="danger" onClick={() => supabase.auth.signOut()}>
              Se déconnecter
            </Button>
          </p>
        </section>
      </div>
    </>
  );
}
