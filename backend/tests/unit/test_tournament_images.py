"""Unit tests for tournament image uploads."""

from unittest.mock import MagicMock

import pytest

from tournament.images import (
    MediaError,
    media_object_key,
    merge_media_fields,
    presign_tournament_image,
    public_media_fields,
    public_media_url,
)


def test_media_object_key_builds_slot_paths():
    assert media_object_key("cup-1", "image_1", "webp") == "media/tournaments/cup-1/image_1.webp"
    assert media_object_key("cup-1", "image_2", "png") == "media/tournaments/cup-1/image_2.png"


def test_public_media_url_uses_site_origin():
    assert (
        public_media_url("https://d1balcacprl09z.cloudfront.net", "media/tournaments/x/image_1.webp")
        == "https://d1balcacprl09z.cloudfront.net/media/tournaments/x/image_1.webp"
    )


def test_merge_media_fields_preserves_existing_urls():
    row = {"tournament_id": "cup-1", "name": "Cup"}
    existing = {"image_1_url": "https://site/media/tournaments/cup-1/image_1.webp"}
    merge_media_fields(row, {"name": "Cup"}, existing=existing)
    assert row["image_1_url"] == existing["image_1_url"]


def test_merge_media_fields_clears_url_when_null_sent():
    row = {"image_1_url": "https://site/old.webp"}
    merge_media_fields(row, {"image_1_url": None})
    assert row["image_1_url"] is None


def test_public_media_fields_only_includes_set_urls():
    payload = public_media_fields(
        {"image_1_url": "https://site/a.webp", "image_2_url": "", "name": "Cup"}
    )
    assert payload == {"image_1_url": "https://site/a.webp"}


def test_presign_tournament_image_returns_upload_and_public_urls():
    s3 = MagicMock()
    s3.generate_presigned_url.return_value = "https://upload.example/put"
    payload = presign_tournament_image(
        bucket="pj007-dev-digging-tournament",
        tournament_id="cup-1",
        body={"slot": "image_2", "content_type": "image/png"},
        site_origin="https://d1balcacprl09z.cloudfront.net",
        s3_client=s3,
    )
    assert payload["slot"] == "image_2"
    assert payload["upload_url"] == "https://upload.example/put"
    assert payload["public_url"].endswith("/media/tournaments/cup-1/image_2.png")
    s3.generate_presigned_url.assert_called_once()


def test_presign_rejects_unknown_slot():
    s3 = MagicMock()
    with pytest.raises(MediaError):
        presign_tournament_image(
            bucket="bucket",
            tournament_id="cup-1",
            body={"slot": "banner", "content_type": "image/png"},
            site_origin="https://site.example",
            s3_client=s3,
        )
