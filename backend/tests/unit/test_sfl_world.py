import responses

from tournament.sfl_world import SflWorldError, land_info_url, lookup_farm_name
import pytest


def test_land_info_url_is_the_sfl_world_farm_id_lookup():
    assert land_info_url("3666918801844311") == (
        "https://sfl.world/api/v1/land/info/farm_id/3666918801844311"
    )


@responses.activate
def test_lookup_returns_username_as_farm_name():
    responses.add(
        responses.GET,
        "https://sfl.world/api/v1/land/info/farm_id/3666918801844311",
        json={"username": "rmr", "farm_id": 3666918801844311, "nft_id": 220411},
        status=200,
    )
    payload = lookup_farm_name("3666918801844311")
    assert payload == {
        "farm_id": "3666918801844311",
        "name": "rmr",
        "nft_id": 220411,
    }
    assert responses.calls[0].request.url.endswith("/land/info/farm_id/3666918801844311")


@responses.activate
def test_lookup_fails_when_username_is_missing():
    responses.add(
        responses.GET,
        "https://sfl.world/api/v1/land/info/farm_id/111111111111",
        json={"username": "", "farm_id": 111111111111, "nft_id": None},
        status=200,
    )
    with pytest.raises(SflWorldError) as exc:
        lookup_farm_name("111111111111")
    assert exc.value.status_code == 404
    assert exc.value.code == "NOT_FOUND"


@responses.activate
def test_lookup_404_is_not_found():
    responses.add(
        responses.GET,
        "https://sfl.world/api/v1/land/info/farm_id/999999",
        status=404,
    )
    with pytest.raises(SflWorldError) as exc:
        lookup_farm_name("999999")
    assert exc.value.status_code == 404
    assert exc.value.code == "NOT_FOUND"
