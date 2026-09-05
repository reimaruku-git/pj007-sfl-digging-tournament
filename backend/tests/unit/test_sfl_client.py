import json
import logging

import boto3
import pytest
import requests
import responses

from tournament.sfl_client import (
    IDENTIFY_MAX_RETRIES,
    IDENTIFY_TIMEOUT_SECONDS,
    RateLimitedSFLClient,
    SFLApiError,
    build_identify_sfl_client,
    build_sfl_client,
    envelope_community_farm,
    identity_from_community_payload,
    key_fingerprint,
    load_sfl_keys,
    parse_sfl_keys_payload,
)


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


KEY_A = "sfl.aaaabbbbcccc1111"
KEY_B = "sfl.ddddffffeeee2222"
KEY_C = "sfl.gggghhhhiiii3333"


def _client(clock: FakeClock, keys: list[str] | None = None, **kwargs):
    return build_sfl_client(
        keys if keys is not None else [KEY_A],
        min_interval_seconds=10,
        success_interval_seconds=5.5,
        max_retries=3,
        retry_delay=1,
        sleeper=clock.sleep,
        monotonic=clock.monotonic,
        **kwargs,
    )


@responses.activate
def test_fetch_farm_success_and_rate_limit_gap():
    clock = FakeClock()
    client = _client(clock)
    responses.add(
        responses.GET,
        "https://api.sunflower-land.com/community/farms/111",
        json={"farm": {"desert": {"digging": {"grid": []}}}},
        status=200,
    )
    responses.add(
        responses.GET,
        "https://api.sunflower-land.com/community/farms/222",
        json={"farm": {}},
        status=200,
    )
    first = client.fetch_farm("111")
    second = client.fetch_farm("222")
    assert first["farm"]["desert"]["digging"]["grid"] == []
    assert second["farm"] == {}
    assert clock.sleeps == [5.5]
    assert responses.calls[0].request.headers["X-Api-Key"] == KEY_A


@responses.activate
def test_retries_429_then_succeeds():
    clock = FakeClock()
    client = _client(clock)
    responses.add(
        responses.GET,
        "https://api.sunflower-land.com/community/farms/111",
        status=429,
        headers={"Retry-After": "2"},
    )
    responses.add(
        responses.GET,
        "https://api.sunflower-land.com/community/farms/111",
        json={"farm": {}},
        status=200,
    )
    payload = client.fetch_farm("111")
    assert payload["farm"] == {}
    assert clock.sleeps[0] >= 10
    assert 5.5 not in clock.sleeps


@responses.activate
def test_403_exhausts_retries():
    clock = FakeClock()
    client = _client(clock)
    responses.add(
        responses.GET,
        "https://api.sunflower-land.com/community/farms/111",
        status=403,
    )
    with pytest.raises(SFLApiError) as exc:
        client.fetch_farm("111")
    assert exc.value.status_code == 403
    assert len(responses.calls) == 3
    assert all(sleep >= 10 for sleep in clock.sleeps)


def test_rejects_interval_under_ten_seconds():
    with pytest.raises(ValueError):
        RateLimitedSFLClient("key", min_interval_seconds=9)


def test_rejects_success_interval_under_five_seconds():
    with pytest.raises(ValueError):
        RateLimitedSFLClient("key", success_interval_seconds=4)


@responses.activate
def test_extra_keys_are_ignored_and_share_the_success_gap():
    clock = FakeClock()
    client = _client(clock, [KEY_A, KEY_B])
    assert isinstance(client, RateLimitedSFLClient)
    responses.add(
        responses.GET,
        "https://api.sunflower-land.com/community/farms/111",
        json={"farm": {"id": 111}},
        status=200,
    )
    responses.add(
        responses.GET,
        "https://api.sunflower-land.com/community/farms/222",
        json={"farm": {"id": 222}},
        status=200,
    )
    client.fetch_farm("111")
    client.fetch_farm("222")
    assert clock.sleeps == [5.5]
    assert [call.request.headers["X-Api-Key"] for call in responses.calls] == [KEY_A, KEY_A]


@responses.activate
def test_blank_second_key_rate_limits_like_one_key():
    clock = FakeClock()
    client = _client(clock, [KEY_A, "", "  "])
    assert isinstance(client, RateLimitedSFLClient)
    responses.add(
        responses.GET,
        "https://api.sunflower-land.com/community/farms/111",
        json={"farm": {}},
        status=200,
    )
    responses.add(
        responses.GET,
        "https://api.sunflower-land.com/community/farms/222",
        json={"farm": {}},
        status=200,
    )
    client.fetch_farm("111")
    client.fetch_farm("222")
    assert clock.sleeps == [5.5]
    assert [call.request.headers["X-Api-Key"] for call in responses.calls] == [KEY_A, KEY_A]


@responses.activate
def test_429_then_next_farm_still_uses_the_same_key():
    clock = FakeClock()
    client = _client(clock, [KEY_A, KEY_B])
    responses.add(
        responses.GET,
        "https://api.sunflower-land.com/community/farms/111",
        status=429,
        headers={"Retry-After": "2"},
    )
    responses.add(
        responses.GET,
        "https://api.sunflower-land.com/community/farms/111",
        json={"farm": {"id": 111}},
        status=200,
    )
    responses.add(
        responses.GET,
        "https://api.sunflower-land.com/community/farms/222",
        json={"farm": {"id": 222}},
        status=200,
    )
    first = client.fetch_farm("111")
    second = client.fetch_farm("222")
    assert first["farm"] == {"id": 111}
    assert second["farm"] == {"id": 222}
    assert clock.sleeps[0] >= 10
    assert responses.calls[0].request.headers["X-Api-Key"] == KEY_A
    assert responses.calls[-1].request.headers["X-Api-Key"] == KEY_A


def test_build_sfl_client_uses_first_key_only():
    client = _client(FakeClock(), [KEY_A, KEY_A, "", KEY_B])
    assert isinstance(client, RateLimitedSFLClient)
    assert client._api_key == KEY_A


def test_envelope_wraps_legacy_farm_object():
    wrapped = envelope_community_farm(
        "111",
        {
            "desert": {"digging": {"grid": []}},
            "isBlacklisted": True,
            "updatedAt": "2026-08-27T00:00:00Z",
        },
    )
    assert wrapped["id"] == 111
    assert wrapped["farm"]["desert"]["digging"]["grid"] == []
    assert wrapped["isBlacklisted"] is True


@responses.activate
def test_fetch_farms_posts_legacy_get_farms_and_envelopes_blobs():
    clock = FakeClock()
    client = _client(clock, batch_size=25)
    responses.add(
        responses.POST,
        "https://api.sunflower-land.com/community/getFarms",
        json={
            "farms": {
                "111": {
                    "desert": {"digging": {"grid": []}},
                    "isBlacklisted": False,
                    "updatedAt": "2026-08-27T21:14:03.221Z",
                },
                "222": {"inventory": {}},
            },
            "skipped": [],
            "warning": "This endpoint is deprecated. Please use pagination",
        },
        status=200,
    )
    found = client.fetch_farms(["111", "222"])
    assert json.loads(responses.calls[0].request.body) == {"ids": [111, 222]}
    assert found["111"]["farm"]["desert"]["digging"]["grid"] == []
    assert found["222"]["farm"]["inventory"] == {}
    assert clock.sleeps == []


@responses.activate
def test_fetch_farms_retries_skipped_then_gets_remaining():
    clock = FakeClock()
    client = _client(clock, batch_size=2)
    responses.add(
        responses.POST,
        "https://api.sunflower-land.com/community/getFarms",
        json={"farms": {"111": {"inventory": {"Sand": 1}}}, "skipped": [222]},
        status=200,
    )
    responses.add(
        responses.POST,
        "https://api.sunflower-land.com/community/getFarms",
        json={"farms": {}, "skipped": [222]},
        status=200,
    )
    responses.add(
        responses.GET,
        "https://api.sunflower-land.com/community/farms/222",
        json={"farm": {"inventory": {"Gold": 1}}, "id": 222},
        status=200,
    )
    found = client.fetch_farms(["111", "222"])
    assert found["111"]["farm"]["inventory"] == {"Sand": 1}
    assert found["222"]["farm"]["inventory"] == {"Gold": 1}
    assert [call.request.method for call in responses.calls] == ["POST", "POST", "GET"]


@responses.activate
def test_fetch_farms_falls_back_to_get_when_post_is_gone():
    clock = FakeClock()
    client = _client(clock, batch_size=25)
    responses.add(
        responses.POST,
        "https://api.sunflower-land.com/community/getFarms",
        status=404,
    )
    responses.add(
        responses.GET,
        "https://api.sunflower-land.com/community/farms/111",
        json={"farm": {"id": 111}},
        status=200,
    )
    responses.add(
        responses.GET,
        "https://api.sunflower-land.com/community/farms/222",
        json={"farm": {"id": 222}},
        status=200,
    )
    found = client.fetch_farms(["111", "222"])
    assert found["111"]["farm"]["id"] == 111
    assert found["222"]["farm"]["id"] == 222
    assert [call.request.method for call in responses.calls] == ["POST", "GET", "GET"]
    assert clock.sleeps == [5.5, 5.5]


@responses.activate
def test_fetch_farms_omits_a_farm_that_get_404s():
    clock = FakeClock()
    client = _client(clock, batch_size=1)
    responses.add(
        responses.POST,
        "https://api.sunflower-land.com/community/getFarms",
        json={"farms": {}, "skipped": [111]},
        status=200,
    )
    responses.add(
        responses.GET,
        "https://api.sunflower-land.com/community/farms/111",
        status=404,
    )
    found = client.fetch_farms(["111"])
    assert found == {}


def test_key_fingerprint_uses_first_four_and_last_four():
    assert key_fingerprint(KEY_A) == "sfl.aaaa...1111"
    assert key_fingerprint("sfl.short") == "sfl.****"
    assert key_fingerprint("") == "sfl.****"


@responses.activate
def test_logs_fingerprint_not_raw_key(caplog):
    clock = FakeClock()
    client = _client(clock, [KEY_A])
    responses.add(
        responses.GET,
        "https://api.sunflower-land.com/community/farms/111",
        json={"farm": {}},
        status=200,
    )
    with caplog.at_level(logging.INFO, logger="tournament.sfl_client"):
        client.fetch_farm("111")
    joined = "\n".join(record.getMessage() for record in caplog.records)
    assert "sfl.aaaa...1111" in joined
    assert KEY_A not in joined


def test_parse_accepts_list_or_keys_object():
    assert parse_sfl_keys_payload([KEY_A, KEY_B, KEY_A, ""]) == [KEY_A, KEY_B]
    assert parse_sfl_keys_payload({"keys": [KEY_A, KEY_C]}) == [KEY_A, KEY_C]


def test_load_sfl_keys_from_s3_json_array_and_object(aws_env):
    s3 = boto3.client("s3", region_name="ap-southeast-1")
    s3.put_object(
        Bucket=aws_env["bucket"],
        Key="sfl-api-keys.json",
        Body=json.dumps([KEY_A]).encode("utf-8"),
    )
    one = load_sfl_keys(aws_env["bucket"], s3_client=s3)
    assert one == [KEY_A]
    s3.put_object(
        Bucket=aws_env["bucket"],
        Key="sfl-api-keys.json",
        Body=json.dumps({"keys": [KEY_A, KEY_B, KEY_C]}).encode("utf-8"),
    )
    three = load_sfl_keys(aws_env["bucket"], s3_client=s3)
    assert three == [KEY_A, KEY_B, KEY_C]
    missing = load_sfl_keys(aws_env["bucket"], "no-such.json", s3_client=s3)
    assert missing == []


def test_env_keys_are_not_required_to_build_a_client():
    client = build_sfl_client([])
    assert isinstance(client, RateLimitedSFLClient)
    with pytest.raises(SFLApiError):
        client.fetch_farm("1")


def test_identity_from_community_payload_reads_username_and_nft_id():
    payload = {"farm": {"username": "rmr", "nft_id": 220411}, "nftId": None}
    assert identity_from_community_payload(payload, "3666918801844311") == {
        "farm_id": "3666918801844311",
        "name": "rmr",
        "nft_id": 220411,
    }


def test_identity_from_community_payload_uses_farm_id_when_username_missing():
    payload = {"farm": {"island": {"type": "desert"}}}
    looked_up = identity_from_community_payload(payload, "3666918801844311")
    assert looked_up == {
        "farm_id": "3666918801844311",
        "name": "3666918801844311",
        "nft_id": None,
    }


def test_identity_from_community_payload_none_without_farm():
    assert identity_from_community_payload({"error": "missing"}, "1") is None
    assert identity_from_community_payload(None, "1") is None


def test_build_identify_sfl_client_is_one_timed_request():
    assert build_identify_sfl_client([]) is None
    assert build_identify_sfl_client(None) is None
    client = build_identify_sfl_client([KEY_A, KEY_B])
    assert isinstance(client, RateLimitedSFLClient)
    assert client._timeout == IDENTIFY_TIMEOUT_SECONDS
    assert client._max_retries == IDENTIFY_MAX_RETRIES
    assert IDENTIFY_TIMEOUT_SECONDS <= 12
    assert IDENTIFY_MAX_RETRIES == 1


def test_sam_and_deploy_wire_keys_from_secrets_bucket():
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    template = (root / "template.yaml").read_text()
    workflow = (root.parent / ".github" / "workflows" / "deploy-dev.yml").read_text()
    farm_sync = (root / "lambda_functions" / "farm_sync" / "app.py").read_text()
    main = (root / "lambda_functions" / "main_function" / "app.py").read_text()
    main_block = template.split("MainFunction:", 1)[1].split("FarmSyncFunction:", 1)[0]
    assert "SecretsBucket:" in template
    assert "sfl-api-keys.json" in template
    assert "SECRETS_BUCKET:" in template
    assert "SECRETS_BUCKET:" in main_block
    assert "SFLApiKey:" not in template
    assert "SFL_API_KEY:" not in template
    assert "SFLApiKey=" not in workflow
    assert "SFL_API_KEY" not in farm_sync
    assert "SFL_API_KEY" not in main
    assert "load_sfl_keys" in farm_sync
    assert "load_sfl_keys" in main
    assert "build_identify_sfl_client" in main
    assert "identity_from_community_payload" in main
    assert "sfl." not in template
    assert "sfl." not in workflow
