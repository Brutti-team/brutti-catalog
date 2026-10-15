"""Synthetic PDF fixtures are tests only; never product data or import evidence."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import fitz
from PIL import Image

spec = importlib.util.spec_from_file_location('extract_catalogue', Path(__file__).with_name('extract-catalogue.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ExtractionTests(unittest.TestCase):
    def test_evidence_deduplicates_images_and_stays_unreviewed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image = Image.new('RGB', (24, 18), 'green')
            buffer = io.BytesIO()
            image.save(buffer, 'PNG')
            document = fitz.open()
            for index in range(2):
                page = document.new_page()
                page.insert_text((30, 40), f'Synthetic extraction fixture page {index+1}')
                page.insert_image(fitz.Rect(30, 60, 150, 150), stream=buffer.getvalue())
            pdf = root / 'fixture.pdf'
            document.save(pdf)
            document.close()
            output = root / 'evidence'
            self.assertEqual(module.extract(pdf, output, expected_pages=2), 2)
            evidence = json.loads((output / 'evidence.json').read_text())
            manifest = json.loads((output / 'manifest.json').read_text())
            self.assertEqual(len(list((output / 'images').glob('*.webp'))), 1)
            self.assertEqual(evidence['pages'][0]['imageCandidates'][0]['file'], evidence['pages'][1]['imageCandidates'][0]['file'])
            self.assertFalse(manifest['reviewed'])
            self.assertEqual(manifest['products'], [])
            self.assertTrue((output / 'page-001.png').is_file())
            self.assertIn('fixture', (output / 'page-001.txt').read_text())
            with self.assertRaises(FileExistsError):
                module.extract(pdf, output, expected_pages=2)

    def test_wrong_page_count_refuses_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = root / 'wrong.pdf'
            document = fitz.open()
            document.new_page()
            document.save(pdf)
            document.close()
            with self.assertRaisesRegex(ValueError, '104'):
                module.extract(pdf, root / 'out')

if __name__ == '__main__':
    unittest.main()
