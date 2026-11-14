import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import ProductModelEditor from '../src/components/ProductModelEditor';
import ProductPhotoViewer from '../src/components/ProductPhotoViewer';
import type { ProductImage } from '../src/lib/types';

const photos: ProductImage[] = [
  { id: 'first', url: 'https://example.test/chair-front.webp', alt: 'Chair front' },
  { id: 'second', url: 'https://example.test/chair-side.png', alt: 'Chair side' },
];

it('shows existing product photo angles without requiring a 3D upload', () => {
  const html = renderToStaticMarkup(createElement(ProductPhotoViewer, {
    images: photos,
    productName: 'Test chair',
  }));
  expect(html).toContain('Chair front');
  expect(html).toContain('chair-front.webp');
  expect(html).toContain('1 / 2');
  expect(html).toContain('Previous product photo');
  expect(html).toContain('not a reconstructed 3D model');
});

it('keeps image-based view available even when native model uploads are disabled', () => {
  const html = renderToStaticMarkup(createElement(ProductModelEditor, {
    productName: 'Test chair',
    status: 'draft',
    photos,
    modelEnabled: false,
    disabled: false,
    onChange: () => {},
    onPending: () => {},
  }));
  expect(html).toContain('Interactive product view');
  expect(html).toContain('chair-front.webp');
  expect(html).not.toContain('Choose model files');
});

it('retains true 3D upload as an optional advanced control', () => {
  const html = renderToStaticMarkup(createElement(ProductModelEditor, {
    productName: 'Test chair',
    status: 'published',
    photos,
    modelEnabled: true,
    disabled: false,
    onChange: () => {},
    onPending: () => {},
  }));
  expect(html).toContain('chair-front.webp');
  expect(html).toContain('Add a true 3D model (optional)');
  expect(html).toContain('Choose model files');
});
