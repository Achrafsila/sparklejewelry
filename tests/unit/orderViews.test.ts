import { describe, expect, test } from 'vitest';
import { ORDER_VIEWS } from '../../src/features/orders/orderViews';

describe('order list filters', () => {
  test('each status sits under the filter that names it', () => {
    expect(ORDER_VIEWS.shipping.statuses).toEqual(['en_livraison']);
    expect(ORDER_VIEWS.delivered.label).toBe('Livrées');
    expect(ORDER_VIEWS.delivered.statuses).toEqual(['livree']);
    expect(ORDER_VIEWS.done.statuses).toEqual(['payee']);
  });

  test('every status appears in exactly one filter besides "Toutes"', () => {
    const all = Object.entries(ORDER_VIEWS)
      .filter(([key]) => key !== 'all')
      .flatMap(([, v]) => v.statuses ?? []);
    expect(all.sort()).toEqual(
      ['annulee', 'brouillon', 'confirmee', 'en_livraison', 'livree', 'payee', 'preparee', 'retour_attendu', 'retour_recu'].sort(),
    );
  });
});
