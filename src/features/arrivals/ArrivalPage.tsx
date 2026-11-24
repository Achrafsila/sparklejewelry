import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useSWRConfig } from 'swr';
import { ActionBar } from '../../app/ActionBar';
import { messageFor } from '../../lib/errors';
import { formatMoney, parseMoney } from '../../lib/money';
import { useRequest } from '../../lib/useRequest';
import { Button } from '../../ui/Button';
import { InlineStatus, Notice } from '../../ui/Feedback';
import { IconBack } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';
import { Skeleton } from '../../ui/Controls';
import { RECEIPTS_KEY, STOCK_KEY, useReceipts, useStock } from '../stock/useStock';
import { ArrivalSummary, lineTotal } from './ArrivalSummary';
import { emptyArrival, useArrivalDraft, type ArrivalLine } from './arrivalDraft';
import { ExistingModelForm } from './ExistingModelForm';
import { NewModelForm } from './NewModelForm';
import './arrivals.css';

interface ValidateArgs extends Record<string, unknown> {
  p_supplier: string;
  p_received_on: string;
  p_lines: object[];
}

export function ArrivalPage() {
  const stock = useStock();
  const receipts = useReceipts();
  const { mutate } = useSWRConfig();
  const [draft, setDraft] = useArrivalDraft();
  const [newKeys, setNewKeys] = useState<Set<string>>(new Set());
  const [supplierError, setSupplierError] = useState<string | null>(null);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const validate = useRequest<ValidateArgs, { receipt_id: string }>('validate_receipt');

  const suppliers = useMemo(() => [...new Set((receipts.data ?? []).map((r) => r.supplier))].sort(), [receipts.data]);
  const total = draft.lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const pieces = draft.lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);

  function add(line: ArrivalLine) {
    setDone(null);
    setDraft((d) => ({ ...d, lines: [...d.lines, line] }));
    setNewKeys(new Set([line.key]));
  }

  async function onValidate() {
    setLocalError(null);
    setLineErrors({});
    const errs: Record<string, string> = {};
    for (const l of draft.lines) {
      if (!/^\d+$/.test(l.qty) || Number(l.qty) < 1) errs[l.key] = 'Quantité invalide : un nombre entier, au moins 1.';
      else if (parseMoney(l.unitCost) === null) errs[l.key] = 'Coût invalide. Exemple : 30 ou 30,50.';
    }
    const noSupplier = !draft.supplier.trim();
    setSupplierError(noSupplier ? 'Indiquez le fournisseur de cet arrivage.' : null);
    setLineErrors(errs);
    if (noSupplier || Object.keys(errs).length) {
      setLocalError('Corrigez le récapitulatif avant de valider.');
      return;
    }
    const result = await validate.run({
      p_supplier: draft.supplier.trim(),
      p_received_on: draft.receivedOn,
      p_lines: draft.lines.map((l) => ({
        variant_id: l.variantId ?? null,
        sku: l.sku,
        product_name: l.productName,
        label: l.label,
        qty: Number(l.qty),
        unit_cost_cents: parseMoney(l.unitCost),
        photo_path: l.photoPath ?? null,
      })),
    });
    if (!result) return;
    const count = draft.lines.length;
    setDraft(emptyArrival());
    setNewKeys(new Set());
    setDone(`${count} ligne${count > 1 ? 's' : ''}, ${pieces} pièce${pieces > 1 ? 's' : ''}.`);
    void mutate(STOCK_KEY);
    void mutate(RECEIPTS_KEY);
    requestAnimationFrame(() => doneRef.current?.focus());
  }

  // Server errors that point to a line are shown on that line.
  const serverLine = (() => {
    const d = validate.error?.details as { line?: number } | null | undefined;
    return d && typeof d.line === 'number' ? draft.lines[d.line] : undefined;
  })();
  const allLineErrors = serverLine && validate.error ? { ...lineErrors, [serverLine.key]: messageFor(validate.error) } : lineErrors;
  const errorText = localError ?? (validate.error ? messageFor(validate.error) : null);

  return (
    <>
      <Link to="/stock" className="back-link">
        <IconBack size={18} aria-hidden="true" />
        Stock
      </Link>
      <PageHeader title="Nouvel arrivage" />
      {!stock.data ? (
        <Skeleton rows={4} label="Chargement du stock" />
      ) : (
        <div className="arrival">
          <div className="arrival__forms">
            <NewModelForm stock={stock.data} lines={draft.lines} onAdd={add} />
            <ExistingModelForm stock={stock.data} receipts={receipts.data ?? []} lines={draft.lines} onAdd={add} />
          </div>
          {done && (
            <div ref={doneRef} tabIndex={-1}>
              <Notice tone="ok" title="Arrivage validé. Le stock est à jour.">
                <p>{done}</p>
                <p>
                  <Link to="/stock">Voir le stock</Link>
                </p>
              </Notice>
            </div>
          )}
          <ArrivalSummary
            draft={draft}
            suppliers={suppliers}
            supplierError={supplierError}
            lineErrors={allLineErrors}
            newKeys={newKeys}
            onChange={(d) => {
              setDraft(d);
              if (d.supplier.trim()) setSupplierError(null);
            }}
          />
        </div>
      )}
      {draft.lines.length > 0 && (
        <ActionBar mobileOnly={false} label="Valider l’arrivage" summary={`${draft.lines.length} ligne${draft.lines.length > 1 ? 's' : ''}, ${formatMoney(total)}`}>
          <div className="action-bar__stack">
            <InlineStatus state={errorText ? 'error' : validate.pending ? 'pending' : 'idle'}>
              {errorText ?? 'Validation…'}
            </InlineStatus>
            <Button variant="primary" pending={validate.pending} onClick={onValidate}>
              Valider l’arrivage
            </Button>
          </div>
        </ActionBar>
      )}
    </>
  );
}
