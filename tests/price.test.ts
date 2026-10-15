import { describe, expect, it } from 'vitest';
import { formatProductPrice } from '../src/lib/price';

describe('surface price presentation', () => {
  it.each([1234, 1234.5, 1234.56])('preserves original precision and currency spacing for %s', (price) => {
    const product = { price, priceBasis: 'fixed' as const };
    expect(formatProductPrice(product)).toBe(new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(price));
    expect(formatProductPrice(product, 'editor')).toBe(new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(price));
    expect(formatProductPrice(product, 'public')).toBe(`RM ${new Intl.NumberFormat('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(price)}`);
  });
  it.each(['admin', 'editor', 'public'] as const)('only prefixes a starting price on %s', (surface) => {
    expect(formatProductPrice({ price: 1000, priceBasis: 'starting-from' }, surface)).toBe(`Starting from ${formatProductPrice({ price: 1000, priceBasis: 'fixed' }, surface)}`);
  });
  it('keeps public literal spacing and editor trailing zeros', () => {
    expect(formatProductPrice({ price: 1000 }, 'public')).toBe('RM 1,000');
    expect(formatProductPrice({ price: 1000 }, 'editor')).toMatch(/1,000\.00$/);
    expect(formatProductPrice({ price: 1000 })).toMatch(/1,000$/);
  });
});
