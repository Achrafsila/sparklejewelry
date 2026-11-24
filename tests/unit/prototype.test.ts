import { describe, expect, test } from 'vitest';
import { summarizePrototype } from '../../src/features/settings/importPrototype';

const sample = {
  variants: [
    { sku: 'A', model: 'A', variant: '', photo: 'data:image/jpeg;base64,xx', physical: 3 },
    { sku: 'B', model: 'B', variant: 'Or', photo: '', physical: 0 },
  ],
  offers: [{ id: '1', type: 'unit', skus: ['A'], title: 'A', price: 100, site: true, instagram: true, repeat: false }],
  orders: [{ id: 'o' }],
  receipts: [{ supplier: 'S', received: '2026-11-01', lines: [{ sku: 'A', qty: 3, cost: 50 }] }],
};

describe('summarizePrototype', () => {
  test('counts what will be imported and what will be skipped', () => {
    expect(summarizePrototype(JSON.stringify(sample))).toEqual({
      data: sample,
      variants: 2,
      receipts: 1,
      offers: 1,
      photos: 1,
      orders: 1,
    });
  });

  test('rejects a file that is not a prototype export', () => {
    expect(() => summarizePrototype('{"hello":1}')).toThrow('Ce fichier n’est pas un export du prototype Sparkle.');
    expect(() => summarizePrototype('not json')).toThrow('Ce fichier n’est pas un export du prototype Sparkle.');
  });
});
