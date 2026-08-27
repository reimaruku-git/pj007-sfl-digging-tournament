import requests
import responses

from tournament.sfl_client import (
    PooledSFLClient,
    RateLimitedSFLClient,
    SFLApiError,
    build_sfl_client,
)
import pytest


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


def _client(clock: FakeClock) -> RateLimitedSFLClient:
    return RateLimitedSFLClient(
        "sfl.test-key",
        min_interval_seconds=12,
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
    assert clock.sleeps == [12]
    assert responses.calls[0].request.headers["X-Api-Key"] == "sfl.test-key"


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


def test_rejects_interval_under_ten_seconds():
    with pytest.raises(ValueError):
        RateLimitedSFLClient("key", min_interval_seconds=9)


def _pool(clock: FakeClock, keys: list[str], min_interval_seconds: float = 12):
    return build_sfl_client(
        keys,
        min_interval_seconds=min_interval_seconds,
        max_retries=3,
        retry_delay=1,
        sleeper=clock.sleep,
        monotonic=clock.monotonic,
    )


@responses.activate
def test_two_keys_fetch_without_sharing_interval():
    clock = FakeClock()
    client = _pool(clock, ["sfl.test-key-a", "sfl.test-key-b"])
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
    assert [call.request.headers["X-Api-Key"] for call in responses.calls] == [
        "sfl.test-key-a",
        "sfl.test-key-b",
    ]


@responses.activate
def test_same_key_in_a_pool_still_sleeps_min_interval():
    clock = FakeClock()
    client = _pool(clock, ["sfl.test-key-a", "sfl.test-key-b"], min_interval_seconds=10)
    for farm_id in ("111", "222", "333"):
        responses.add(
            responses.GET,
            f"https://api.sunflower-land.com/community/farms/{farm_id}",
            json={"farm": {"id": int(farm_id)}},
            status=200,
        )
    client.fetch_farm("111")
    client.fetch_farm("222")
    client.fetch_farm("333")
    assert clock.sleeps == [10]
    assert clock.sleeps[0] >= 10
    assert [call.request.headers["X-Api-Key"] for call in responses.calls] == [
        "sfl.test-key-a",
        "sfl.test-key-b",
        "sfl.test-key-a",
    ]


@responses.activate
def test_blank_second_key_rate_limits_like_one_key():
    clock = FakeClock()
    client = _pool(clock, ["sfl.test-key", "", "  "])
    assert isinstance(client, RateLimitedSFLClient)
    assert not isinstance(client, PooledSFLClient)
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
    assert clock.sleeps == [12]
    assert [call.request.headers["X-Api-Key"] for call in responses.calls] == [
        "sfl.test-key",
        "sfl.test-key",
    ]


@responses.activate
def test_429_on_one_key_does_not_block_the_other():
    clock = FakeClock()
    client = _pool(clock, ["sfl.test-key-a", "sfl.test-key-b"])
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
    assert responses.calls[0].request.headers["X-Api-Key"] == "sfl.test-key-a"
    assert responses.calls[-1].request.headers["X-Api-Key"] == "sfl.test-key-b"
    # After key A's 429 backoff, key B is still unused so the second farm
    # does not add another interval sleep.
    assert clock.sleeps == [12]


def test_build_sfl_client_skips_duplicate_and_blank_keys():
    clock = FakeClock()
    client = _pool(clock, ["sfl.test-key", "sfl.test-key", ""])
    assert isinstance(client, RateLimitedSFLClient)


def test_sam_and_deploy_wire_optional_second_key_as_noecho():
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    template = (root / "template.yaml").read_text()
    workflow = (root.parent / ".github" / "workflows" / "deploy-dev.yml").read_text()
    assert "SFLApiKey2:" in template
    assert "SFL_API_KEY_2:" in template
    key2_block = template.split("SFLApiKey2:", 1)[1].split("DiscordWebhookUrl:", 1)[0]
    assert "NoEcho: true" in key2_block
    assert 'Default: ""' in key2_block
    assert "SFLApiKey2=${{ secrets.SFL_API_KEY_2 }}" in workflow
    assert "sfl." not in template
    assert "sfl." not in workflow
