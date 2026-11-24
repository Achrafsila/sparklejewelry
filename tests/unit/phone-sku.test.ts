import { describe, expect, test } from 'vitest';
import { normalizePhone } from '../../src/lib/phone';
import { suggestSku } from '../../src/lib/sku';

describe('normalizePhone', () => {
  test.each([
    ['06 12 34 56 78', '+212612345678'],
    ['0612345678', '+212612345678'],
    ['+212 6 12 34 56 78', '+212612345678'],
    ['00212712345678', '+212712345678'],
    ['05.22.33.44.55', '+212522334455'],
  ])('%s becomes %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  test.each(['12', '0812345678', '', 'abc'])('%j is not a Moroccan number', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe('suggestSku', () => {
  test('builds the reference from model and variant', () => {
    expect(suggestSku('Bague Luna', 'Or', new Set())).toBe('BAGUE-LUNA-OR');
  });

  test('removes accents like the server does', () => {
    expect(suggestSku('Créole Étoile', 'Or rose', new Set())).toBe('CREOLE-ETOILE-OR-ROSE');
  });

  test('adds a suffix when taken', () => {
    expect(suggestSku('Bague Luna', 'Or', new Set(['BAGUE-LUNA-OR']))).toBe('BAGUE-LUNA-OR-2');
    expect(suggestSku('Bague Luna', 'Or', new Set(['BAGUE-LUNA-OR', 'BAGUE-LUNA-OR-2']))).toBe('BAGUE-LUNA-OR-3');
  });

  test('uses the model alone without variant', () => {
    expect(suggestSku('Bague Luna', null, new Set())).toBe('BAGUE-LUNA');
  });

  test('falls back to REF', () => {
    expect(suggestSku('  ', '', new Set())).toBe('REF');
  });
});
