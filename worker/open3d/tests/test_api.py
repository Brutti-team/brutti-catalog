"""Smoke and security tests; no GPU or model downloads needed."""
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

os.environ.setdefault("BRUTTI_3D_WORKER_TOKEN", "test-token-longer-than-twenty-four-chars")
os.environ.setdefault("BRUTTI_3D_IMAGE_PREFIX", "https://catalog.example.invalid/storage/v1/object/public/product-images/")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as worker  # noqa: E402
from fastapi.testclient import TestClient

TOKEN = {"Authorization": "Bearer test-token-longer-than-twenty-four-chars"}
GOOD_IMAGE = "https://catalog.example.invalid/storage/v1/object/public/product-images/some-product/front.png"
JOB_ID = "123e4567-e89b-42d3-a456-426614174000"


class WorkerAPITest(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.original_dir = worker.APP_DIR
        worker.APP_DIR = Path(self.directory.name)
        self.client = TestClient(worker.app)

    def tearDown(self):
        self.client.close()
        worker.APP_DIR = self.original_dir
        self.directory.cleanup()

    def test_private_routes_require_token(self):
        for path in ("/health", f"/jobs/{JOB_ID}", f"/jobs/{JOB_ID}/model"):
            self.assertEqual(self.client.get(path).status_code, 401)

    def test_blocks_untrusted_photo_source(self):
        for image_url in (
            "https://127.0.0.1/private.png",
            "https://evil.example.invalid/photo.png",
            "https://catalog.example.invalid/storage/v1/object/public/other-bucket/a.png",
            GOOD_IMAGE + "?token=secret",
        ):
            reply = self.client.post("/jobs", headers=TOKEN,
                json={"job_id": JOB_ID, "image_url": image_url})
            self.assertEqual(reply.status_code, 422, reply.text)

    def test_job_submission_is_idempotent(self):
        with patch.object(worker.EXECUTOR, "submit") as task:
            payload = {"job_id": JOB_ID, "image_url": GOOD_IMAGE}
            first = self.client.post("/jobs", headers=TOKEN, json=payload)
            second = self.client.post("/jobs", headers=TOKEN, json=payload)
            self.assertEqual(first.status_code, 200, first.text)
            self.assertEqual(second.status_code, 200, second.text)
            self.assertEqual(first.json()["job_id"], JOB_ID)
            self.assertEqual(task.call_count, 1)
            self.assertEqual(self.client.get(f"/jobs/{JOB_ID}", headers=TOKEN).json()["status"], "queued")
            self.assertEqual(self.client.get(f"/jobs/{JOB_ID}/model", headers=TOKEN).status_code, 409)

    def test_invalid_job_id_is_rejected(self):
        reply = self.client.post("/jobs", headers=TOKEN,
            json={"job_id": "../../etc/passwd", "image_url": GOOD_IMAGE})
        self.assertEqual(reply.status_code, 422)


if __name__ == "__main__":
    unittest.main()
