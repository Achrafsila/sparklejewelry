export interface PrototypeExport {
  variants: { sku: string; model: string; variant?: string; photo?: string; physical: number }[];
  offers?: unknown[];
  orders?: unknown[];
  receipts?: { supplier: string; received: string; lines: { sku: string; qty: number; cost: number }[] }[];
}

export interface PrototypeSummary {
  data: PrototypeExport;
  variants: number;
  receipts: number;
  offers: number;
  photos: number;
  orders: number;
}

const INVALID = 'Ce fichier n’est pas un export du prototype Sparkle.';

/** Reads the prototype's JSON export and counts what will be imported or skipped. */
export function summarizePrototype(text: string): PrototypeSummary {
  let data: PrototypeExport;
  try {
    data = JSON.parse(text) as PrototypeExport;
  } catch {
    throw new Error(INVALID);
  }
  if (!data || !Array.isArray(data.variants) || data.variants.some((v) => typeof v?.sku !== 'string' || typeof v?.model !== 'string')) {
    throw new Error(INVALID);
  }
  return {
    data,
    variants: data.variants.length,
    receipts: data.receipts?.length ?? 0,
    offers: data.offers?.length ?? 0,
    photos: data.variants.filter((v) => v.photo).length,
    orders: data.orders?.length ?? 0,
  };
}
