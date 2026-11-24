import { useState, type FormEvent } from 'react';
import { useSWRConfig } from 'swr';
import { formatDate, formatDateTime } from '../../lib/dates';
import { messageFor, toAppError } from '../../lib/errors';
import { formatMoney } from '../../lib/money';
import { preparePhoto, uploadPhoto } from '../../lib/photo';
import { read } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { useRequest } from '../../lib/useRequest';
import { Button } from '../../ui/Button';
import { InlineStatus, Notice, type InlineState } from '../../ui/Feedback';
import { Field } from '../../ui/Field';
import { PhotoInput } from '../../ui/PhotoInput';
import { PhotoSlot } from '../../ui/PhotoSlot';
import { Sheet } from '../../ui/Sheet';
import { StatusBadge } from '../../ui/StatusBadge';
import { MOVEMENT_LABELS, STOCK_KEY, useMovements, useReceipts, type StockRow } from './useStock';

interface Alert {
  sku: string;
  name: string;
  after: number;
  offers: { id: string; name: string }[];
}

export function VariantSheet({ row, onClose }: { row: StockRow | null; onClose(): void }) {
  return (
    <Sheet open={row != null} title={row?.name ?? ''} onClose={onClose}>
      {row && <VariantDetails key={row.variant_id} row={row} />}
    </Sheet>
  );
}

function VariantDetails({ row }: { row: StockRow }) {
  const receipts = useReceipts();
  const movements = useMovements(row.variant_id);
  const { mutate } = useSWRConfig();
  const costs = (receipts.data ?? []).flatMap((r) =>
    r.lines.filter((l) => l.variant_id === row.variant_id).map((l) => ({ ...l, supplier: r.supplier, received_on: r.received_on, id: r.id })),
  );

  return (
    <>
      <div className="variant-head">
        <PhotoSlot size={96} path={row.photo_path} alt={row.name} />
        <div>
          <p className="sku">{row.sku}</p>
          {row.available_qty <= 0 ? <StatusBadge status="out" /> : row.is_low ? <StatusBadge status="low" /> : null}
        </div>
      </div>

      <dl className="kv">
        <dt>Physique</dt>
        <dd data-testid="qty-physical">{row.physical_qty}</dd>
        <dt>Réservé</dt>
        <dd>{row.reserved_qty}</dd>
        <dt>Disponible</dt>
        <dd>
          <b>{row.available_qty}</b>
        </dd>
        <dt>Coût moyen pondéré</dt>
        <dd>{row.cost_known ? formatMoney(Math.round(Number(row.avg_cost))) : 'Inconnu'}</dd>
      </dl>

      {row.offers.length > 0 && (
        <section>
          <h3 className="section-title">Offres qui utilisent cette référence</h3>
          <p>{row.offers.map((o) => o.name).join(', ')}</p>
        </section>
      )}

      <section>
        <h3 className="section-title">Coûts par arrivage</h3>
        {costs.length === 0 ? (
          <p className="muted">Aucun arrivage enregistré.</p>
        ) : (
          <ul className="plain-list">
            {costs.map((c) => (
              <li key={`${c.id}-${c.sku}`} className="plain-list__row">
                <span>
                  {formatDate(c.received_on)}, {c.supplier}
                </span>
                <span className="num">
                  {c.qty} × {formatMoney(c.unit_cost_cents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PhotoChange row={row} onDone={() => mutate(STOCK_KEY)} />
      <StockCorrection row={row} onDone={() => Promise.all([mutate(STOCK_KEY), movements.mutate()])} />

      <section>
        <h3 className="section-title">Derniers mouvements</h3>
        {!movements.data ? (
          <p className="muted">Chargement…</p>
        ) : movements.data.length === 0 ? (
          <p className="muted">Aucun mouvement.</p>
        ) : (
          <ul className="plain-list">
            {movements.data.map((m) => (
              <li key={m.id} className="plain-list__row">
                <span>
                  {MOVEMENT_LABELS[m.kind] ?? m.kind}
                  {m.note && <span className="muted"> ({m.note})</span>}
                  <br />
                  <span className="muted">{formatDateTime(m.created_at)}</span>
                </span>
                <span className="num">
                  {m.physical_delta !== 0 && `${m.physical_delta > 0 ? '+' : ''}${m.physical_delta} phys.`}
                  {m.physical_delta !== 0 && m.reserved_delta !== 0 && ' '}
                  {m.reserved_delta !== 0 && `${m.reserved_delta > 0 ? '+' : ''}${m.reserved_delta} rés.`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function PhotoChange({ row, onDone }: { row: StockRow; onDone(): void }) {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ state: InlineState; text: string }>({ state: 'idle', text: '' });

  async function save() {
    if (!file || status.state === 'pending') return;
    setError(null);
    setStatus({ state: 'pending', text: 'Envoi de la photo…' });
    try {
      const blob = await preparePhoto(file);
      setProgress(0);
      const path = await uploadPhoto(blob, 'variants', setProgress);
      await read(supabase.from('variants').update({ photo_path: path }).eq('id', row.variant_id).select('id'));
      setFile(null);
      setStatus({ state: 'success', text: 'Photo enregistrée.' });
      onDone();
    } catch (e) {
      setError(messageFor(toAppError(e)));
      setStatus({ state: 'idle', text: '' });
    } finally {
      setProgress(null);
    }
  }

  return (
    <section className="sheet-section">
      <PhotoInput legend="Changer la photo" file={file} currentPath={row.photo_path} onChange={setFile} error={error} progress={progress} />
      {file && (
        <Button variant="primary" size="small" pending={status.state === 'pending'} onClick={save}>
          Enregistrer la photo
        </Button>
      )}
      <InlineStatus state={status.state}>{status.text}</InlineStatus>
    </section>
  );
}

function StockCorrection({ row, onDone }: { row: StockRow; onDone(): void }) {
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ delta?: string; reason?: string }>({});
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const adjust = useRequest<{ p_variant_id: string; p_delta: number; p_reason: string }, { physical_qty: number; alerts: Alert[] }>(
    'adjust_stock',
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const n = Number(delta.replace(/\s/g, '').replace('−', '-'));
    const errs: typeof fieldErrors = {};
    if (!/^[+-]?\d+$/.test(delta.replace(/\s/g, '').replace('−', '-')) || n === 0) errs.delta = 'Indiquez un nombre entier non nul, par exemple -2 ou 3.';
    else if (row.physical_qty + n < row.reserved_qty) errs.delta = `Impossible : ${row.reserved_qty} pièce(s) sont réservées.`;
    if (!reason.trim()) errs.reason = 'Indiquez le motif de la correction.';
    setFieldErrors(errs);
    setDone(null);
    if (Object.keys(errs).length) return;
    const result = await adjust.run({ p_variant_id: row.variant_id, p_delta: n, p_reason: reason.trim() });
    if (!result) return;
    setDone(`Stock corrigé : ${result.physical_qty} pièce${result.physical_qty > 1 ? 's' : ''} en stock physique.`);
    setAlerts(result.alerts);
    setDelta('');
    setReason('');
    onDone();
  }

  return (
    <form className="sheet-section form-grid" onSubmit={onSubmit} noValidate aria-label="Corriger le stock">
      <h3 className="section-title">Corriger le stock</h3>
      <div className="form-grid form-grid--2">
        <Field label="Écart de quantité" hint="Négatif pour retirer, positif pour ajouter." error={fieldErrors.delta}>
          {(p) => <input {...p} className="input num" inputMode="text" value={delta} onChange={(e) => setDelta(e.target.value)} />}
        </Field>
        <Field label="Motif" error={fieldErrors.reason}>
          {(p) => <input {...p} className="input" placeholder="Inventaire, casse…" value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
      <div>
        <Button type="submit" pending={adjust.pending}>
          Corriger le stock
        </Button>
        <InlineStatus state={adjust.error ? 'error' : done ? 'success' : 'idle'}>
          {adjust.error ? messageFor(adjust.error) : done}
        </InlineStatus>
        {alerts.map((a) => (
          <Notice key={a.sku} tone="warn" title={`Stock bas : ${a.name}, ${a.after} disponible${a.after > 1 ? 's' : ''}`}>
            {a.offers.length > 0 && <p>Offres concernées : {a.offers.map((o) => o.name).join(', ')}. Leur pause reste manuelle.</p>}
          </Notice>
        ))}
      </div>
    </form>
  );
}
