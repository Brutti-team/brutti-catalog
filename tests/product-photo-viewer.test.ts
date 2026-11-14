import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import ProductModelEditor from '../src/components/ProductModelEditor';
import ProductImageTo3D from '../src/components/ProductImageTo3D';
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
    productId: '90000000-0000-4000-8000-000000000001',
    saved: false,
    status: 'draft',
    photos,
    savedPhotoIds: photos.map(photo => photo.id),
    modelEnabled: false,
    disabled: false,
    onChange: () => {},
    onPending: () => {},
  }));
  expect(html).toContain('Real 3D model');
  expect(html).toContain('3D model storage is not enabled');
  expect(html).not.toContain('Choose model files');
});

it('retains true 3D upload as an optional advanced control', () => {
  const html = renderToStaticMarkup(createElement(ProductModelEditor, {
    productName: 'Test chair',
    productId: '90000000-0000-4000-8000-000000000001',
    saved: false,
    status: 'published',
    photos,
    savedPhotoIds: photos.map(photo => photo.id),
    modelEnabled: true,
    disabled: false,
    onChange: () => {},
    onPending: () => {},
  }));
  expect(html).toContain('Real 3D model');
  expect(html).toContain('Save this product as a draft first');
  expect(html).toContain('Or upload an existing 3D model file');
  expect(html).toContain('Choose model files');
});

it('rejects unsaved product photos before AI 3D generation', () => {
  const html = renderToStaticMarkup(createElement(ProductImageTo3D, {
    productId: '90000000-0000-4000-8000-000000000001',
    productName: 'Test chair',
    photos,
    savedPhotoIds: ['first'],
    saved: true,
    disabled: false,
    onGenerated: async () => {},
  }));
  expect(html).toContain('1 newly added photo(s) need Save Product');
  expect(html).toMatch(/aria-label="Use photo 1 for 3D generation" aria-pressed="true"/);
  expect(html).toMatch(/aria-label="Use photo 2 for 3D generation \(save photo first\)" aria-pressed="false" disabled=""/);
});
