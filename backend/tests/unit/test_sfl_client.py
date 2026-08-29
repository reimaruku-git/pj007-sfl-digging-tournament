import json
import logging

import boto3
import pytest
import requests
import responses

from tournament.sfl_client import (
    PooledSFLClient,
    RateLimitedSFLClient,
    SFLApiError,
    build_sfl_client,
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


def _client(clock: FakeClock, keys: list[str] | None = None):
    return build_sfl_client(
        keys if keys is not None else [KEY_A],
        min_interval_seconds=12,
        success_round_seconds=10,
        max_retries=3,
        retry_delay=1,
        sleeper=clock.sleep,
        monotonic=clock.monotonic,
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
    assert second == {"farm": {}}
    assert clock.sleeps == [10]
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
    assert payload == {"farm": {}}
    assert clock.sleeps[0] >= 12
    assert 10 not in clock.sleeps


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
    assert all(sleep >= 12 for sleep in clock.sleeps)


def test_rejects_interval_under_ten_seconds():
    with pytest.raises(ValueError):
        RateLimitedSFLClient("key", min_interval_seconds=9)


@responses.activate
def test_two_keys_fetch_without_sharing_interval():
    clock = FakeClock()
    client = _client(clock, [KEY_A, KEY_B])
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
    assert first == {"farm": {"id": 111}}
    assert second == {"farm": {"id": 222}}
    assert clock.sleeps == []
    assert [call.request.headers["X-Api-Key"] for call in responses.calls] == [KEY_A, KEY_B]


@responses.activate
def test_two_key_round_waits_ten_seconds_before_next_success():
    clock = FakeClock()
    client = _client(clock, [KEY_A, KEY_B])
    for farm_id in ("111", "222", "333"):
        responses.add(
            responses.GET,
            f"https://api.sunflower-land.com/community/farms/{farm_id}",
            json={"farm": {"id": int(farm_id)}},
            status=200,
        )
    client.fetch_farm("111")
    client.fetch_farm("222")
    assert clock.sleeps == []
    client.fetch_farm("333")
    assert clock.sleeps == [10]
    assert [call.request.headers["X-Api-Key"] for call in responses.calls] == [
        KEY_A,
        KEY_B,
        KEY_A,
    ]


@responses.activate
def test_three_keys_wait_after_full_round_only():
    clock = FakeClock()
    client = _client(clock, [KEY_A, KEY_B, KEY_C])
    for farm_id in ("1", "2", "3", "4"):
        responses.add(
            responses.GET,
            f"https://api.sunflower-land.com/community/farms/{farm_id}",
            json={"farm": {}},
            status=200,
        )
    client.fetch_farm("1")
    client.fetch_farm("2")
    client.fetch_farm("3")
    assert clock.sleeps == []
    client.fetch_farm("4")
    assert clock.sleeps == [10]


@responses.activate
def test_blank_second_key_rate_limits_like_one_key():
    clock = FakeClock()
    client = _client(clock, [KEY_A, "", "  "])
    assert isinstance(client, PooledSFLClient)
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
    assert clock.sleeps == [10]
    assert [call.request.headers["X-Api-Key"] for call in responses.calls] == [KEY_A, KEY_A]


@responses.activate
def test_429_on_one_key_does_not_block_the_other():
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
    assert first == {"farm": {"id": 111}}
    assert second == {"farm": {"id": 222}}
    assert clock.sleeps[0] >= 12
    assert responses.calls[0].request.headers["X-Api-Key"] == KEY_A
    assert responses.calls[-1].request.headers["X-Api-Key"] == KEY_B
    assert clock.sleeps == [12]


def test_build_sfl_client_skips_duplicate_and_blank_keys():
    client = _client(FakeClock(), [KEY_A, KEY_A, ""])
    assert isinstance(client, PooledSFLClient)
    assert len(client._clients) == 1


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


def test_sam_and_deploy_wire_keys_from_secrets_bucket():
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    template = (root / "template.yaml").read_text()
    workflow = (root.parent / ".github" / "workflows" / "deploy-dev.yml").read_text()
    farm_sync = (root / "lambda_functions" / "farm_sync" / "app.py").read_text()
    assert "SecretsBucket:" in template
    assert "sfl-api-keys.json" in template
    assert "SECRETS_BUCKET:" in template
    assert "SFLApiKey:" not in template
    assert "SFL_API_KEY:" not in template
    assert "SFLApiKey=" not in workflow
    assert "SFL_API_KEY" not in farm_sync
    assert "load_sfl_keys" in farm_sync
    assert "sfl." not in template
    assert "sfl." not in workflow
