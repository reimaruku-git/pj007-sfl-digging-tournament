import requests
import responses

from tournament.sfl_client import RateLimitedSFLClient, SFLApiError
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
