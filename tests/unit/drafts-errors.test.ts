import { beforeEach, describe, expect, test } from 'vitest';
import { clearDraft, loadDraft, saveDraft } from '../../src/lib/drafts';
import { AppError, messageFor, toAppError } from '../../src/lib/errors';
import { formatDate } from '../../src/lib/dates';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

describe('drafts', () => {
  beforeEach(() => {
    (globalThis as any).localStorage = new MemoryStorage();
  });

  test('round-trips a draft under a prefixed key', () => {
    saveDraft('cart', 1, { lines: [1, 2] });
    expect(loadDraft('cart', 1)).toEqual({ lines: [1, 2] });
    expect((globalThis as any).localStorage.getItem('sparkle:cart')).toContain('"v":1');
  });

  test('a draft saved with another version is ignored', () => {
    saveDraft('cart', 1, { lines: [] });
    expect(loadDraft('cart', 2)).toBeNull();
  });

  test('a corrupted draft is ignored', () => {
    (globalThis as any).localStorage.setItem('sparkle:cart', '{oops');
    expect(loadDraft('cart', 1)).toBeNull();
  });

  test('clearDraft removes it', () => {
    saveDraft('cart', 1, { a: 1 });
    clearDraft('cart');
    expect(loadDraft('cart', 1)).toBeNull();
  });

  test('works when storage is unavailable', () => {
    (globalThis as any).localStorage = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
    };
    expect(() => saveDraft('cart', 1, {})).not.toThrow();
    expect(loadDraft('cart', 1)).toBeNull();
  });
});

describe('errors', () => {
  test('reads a PostgREST business error and its JSON details', () => {
    const e = toAppError({
      code: 'P0001',
      message: 'STOCK_INSUFFISANT',
      details: '[{"sku":"BRONZE","need":2,"available":1}]',
    });
    expect(e).toBeInstanceOf(AppError);
    expect(e.code).toBe('STOCK_INSUFFISANT');
    expect(e.details).toEqual([{ sku: 'BRONZE', need: 2, available: 1 }]);
    expect(messageFor(e)).toBe('Stock insuffisant pour 1 référence.');
  });

  test('plural for several missing references', () => {
    expect(messageFor(new AppError('STOCK_INSUFFISANT', [{}, {}]))).toBe('Stock insuffisant pour 2 références.');
  });

  test('a network failure becomes RESEAU', () => {
    const e = toAppError(new TypeError('Failed to fetch'));
    expect(e.code).toBe('RESEAU');
    expect(messageFor(e)).toMatch(/Connexion impossible/);
  });

  test.each(['TypeError: Load failed', 'TypeError: Failed to fetch', 'NetworkError when attempting to fetch resource.'])(
    'a network failure reported by supabase-js as %j becomes RESEAU (Safari, Chrome, Firefox)',
    (message) => {
      expect(toAppError({ message, details: '', hint: '', code: '' }).code).toBe('RESEAU');
    },
  );

  test('trio reasons have their own message', () => {
    expect(messageFor(new AppError('TRIO_INVALIDE', { reason: 'repeat' }))).toMatch(/même pièce/);
    expect(messageFor(new AppError('TRIO_INVALIDE', { reason: 'count' }))).toMatch(/trois pièces/);
  });

  test('unknown codes get a generic message', () => {
    expect(messageFor(new AppError('XYZ'))).toBe('Une erreur est survenue. Réessayez.');
  });
});

describe('formatDate', () => {
  test('short French date in Casablanca time', () => {
    expect(formatDate('2026-11-24T10:00:00Z')).toBe('24 nov. 2026');
  });
});
