#!/usr/bin/env python3
"""Extract evidence only. No product inference, database access or automatic import."""
import argparse
import hashlib
import json
from pathlib import Path
import fitz
from PIL import Image, ImageOps
import io

def extract(pdf_path, output, expected_pages=104):
    document_hash = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    output.mkdir(parents=True, exist_ok=False)  # Never overwrite previous reviews.
    (output / 'images').mkdir()
    pages = []
    with fitz.open(pdf_path) as document:
        if document.page_count != expected_pages:
            raise ValueError(f'Expected {expected_pages} pages; found {document.page_count}. Confirm the source before extraction.')
        for index, page in enumerate(document):
            candidates = []
            for entry in page.get_images(full=True):
                xref, mask = entry[:2]
                pixmap = fitz.Pixmap(document, xref)
                if mask:
                    pixmap = fitz.Pixmap(pixmap, fitz.Pixmap(document, mask))
                if pixmap.colorspace and pixmap.colorspace.n not in (1, 3):
                    pixmap = fitz.Pixmap(fitz.csRGB, pixmap)
                image = Image.open(io.BytesIO(pixmap.tobytes('png')))
                image = ImageOps.exif_transpose(image).convert('RGBA' if image.mode == 'RGBA' else 'RGB')
                # Pixel hash deduplicates photographs shared across pages/xrefs.
                image_hash = hashlib.sha256(str(image.size).encode() + image.mode.encode() + image.tobytes()).hexdigest()
                path = output / 'images' / f'{image_hash}.webp'
                width, height = image.size
                image.thumbnail((1800, 1800), Image.Resampling.LANCZOS)
                if not path.exists():
                    image.save(path, 'WEBP', quality=85, method=6)
                candidates.append({'file': f'images/{image_hash}.webp', 'sourceXref': xref, 'sourceWidth': width, 'sourceHeight': height})
            text = page.get_text(sort=True)
            (output / f'page-{index + 1:03}.txt').write_text(text, encoding='utf-8')
            # A page render preserves layouts, prices and vector artwork for human verification.
            page.get_pixmap(matrix=fitz.Matrix(1, 1)).save(str(output / f'page-{index + 1:03}.png'))
            pages.append({'page': index + 1, 'textFile': f'page-{index + 1:03}.txt', 'renderFile': f'page-{index + 1:03}.png', 'imageCandidates': candidates})
    (output / 'evidence.json').write_text(json.dumps({'documentSha256': document_hash, 'pageCount': len(pages), 'pages': pages}, indent=2), encoding='utf-8')
    (output / 'manifest.json').write_text(json.dumps({'version': 1, 'source': 'brutti-catalogue-2025', 'documentSha256': document_hash, 'reviewed': False, 'products': []}, indent=2), encoding='utf-8')
    return len(pages)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--expected-pages', type=int, default=104)
    args = parser.parse_args()
    print(f'Extracted {extract(args.pdf, args.output, args.expected_pages)} evidence pages. Product/photo/category review is required; nothing imported.')
