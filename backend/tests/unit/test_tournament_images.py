"""Unit tests for tournament image uploads."""

from unittest.mock import MagicMock

import pytest

from tournament.images import (
    MediaError,
    media_object_key,
    merge_media_fields,
    public_api_base_from_event,
    public_media_fields,
    public_media_url,
    store_tournament_image,
)


def test_media_object_key_builds_slot_paths():
    assert media_object_key("cup-1", "image_1", "webp") == "media/tournaments/cup-1/image_1.webp"
    assert media_object_key("cup-1", "image_2", "png") == "media/tournaments/cup-1/image_2.png"


def test_public_api_base_from_event_includes_stage_on_execute_api():
    assert (
        public_api_base_from_event(
            {
                "requestContext": {
                    "domainName": "oacun88q99.execute-api.ap-southeast-1.amazonaws.com",
                    "stage": "dev",
                }
            }
        )
        == "https://oacun88q99.execute-api.ap-southeast-1.amazonaws.com/dev"
    )


def test_public_api_base_from_event_omits_stage_on_custom_domain():
    assert (
        public_api_base_from_event(
            {"requestContext": {"domainName": "api.bumpkinclash.com", "stage": "prd"}}
        )
        == "https://api.bumpkinclash.com"
    )


def test_public_media_url_uses_api_base():
    assert (
        public_media_url(
            "https://oacun88q99.execute-api.ap-southeast-1.amazonaws.com/dev",
            "media/tournaments/x/image_1.webp",
        )
        == "https://oacun88q99.execute-api.ap-southeast-1.amazonaws.com/dev/media/tournaments/x/image_1.webp"
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


def test_store_tournament_image_puts_object_and_returns_public_url():
    s3 = MagicMock()
    payload = store_tournament_image(
        bucket="pj007-dev-digging-tournament",
        tournament_id="cup-1",
        body={"slot": "image_2", "content_type": "image/png", "data": "aGVsbG8="},
        api_base="https://oacun88q99.execute-api.ap-southeast-1.amazonaws.com/dev",
        s3_client=s3,
    )
    assert payload["slot"] == "image_2"
    assert payload["public_url"].endswith("/media/tournaments/cup-1/image_2.png")
    s3.put_object.assert_called_once()
    kwargs = s3.put_object.call_args.kwargs
    assert kwargs["Key"] == "media/tournaments/cup-1/image_2.png"
    assert kwargs["Body"] == b"hello"


def test_store_rejects_unknown_slot():
    s3 = MagicMock()
    with pytest.raises(MediaError):
        store_tournament_image(
            bucket="bucket",
            tournament_id="cup-1",
            body={"slot": "banner", "content_type": "image/png", "data": "aGVsbG8="},
            api_base="https://site.example",
            s3_client=s3,
        )
