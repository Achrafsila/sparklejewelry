import { useEffect, useState } from 'react';
import { loadDraft, saveDraft } from '../../lib/drafts';
import { todayIso } from '../../lib/dates';

export interface ArrivalLine {
  key: string;
  /** Set for a restock of an existing reference. */
  variantId?: string;
  sku: string;
  productName: string;
  label: string | null;
  qty: string;
  unitCost: string;
  photoPath?: string | null;
}

export interface ArrivalDraft {
  supplier: string;
  receivedOn: string;
  lines: ArrivalLine[];
}

const KEY = 'arrival';
const VERSION = 1;

export const emptyArrival = (): ArrivalDraft => ({ supplier: '', receivedOn: todayIso(), lines: [] });

/** Lines of the arrival typed on this device but not validated yet. */
export function pendingArrivalLines(): number {
  return loadDraft<ArrivalDraft>(KEY, VERSION)?.lines.length ?? 0;
}

/** The arrival in progress, kept on this device until it is validated. */
export function useArrivalDraft() {
  const [draft, setDraft] = useState<ArrivalDraft>(() => loadDraft<ArrivalDraft>(KEY, VERSION) ?? emptyArrival());
  useEffect(() => saveDraft(KEY, VERSION, draft), [draft]);
  return [draft, setDraft] as const;
}
