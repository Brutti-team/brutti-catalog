import type { Product } from './types';

export function formatProductPrice(product: Pick<Product, 'price' | 'priceBasis'>, surface: 'admin' | 'editor' | 'public' = 'admin'): string {
  if (product.price === null) return 'On enquiry';
  const formatted = surface === 'public'
    ? `RM ${new Intl.NumberFormat('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(product.price)}`
    : new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR', minimumFractionDigits: surface === 'editor' ? 2 : 0, maximumFractionDigits: 2 }).format(product.price);
  return product.priceBasis === 'starting-from' ? `Starting from ${formatted}` : formatted;
}
