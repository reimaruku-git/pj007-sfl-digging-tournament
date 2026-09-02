import json

import boto3

from tournament.farms import FarmRegistry, is_valid_farm_id


def test_is_valid_farm_id_accepts_short_numeric_ids():
    assert is_valid_farm_id("7916")
    assert is_valid_farm_id("1")
    assert is_valid_farm_id("3666918801844311")
    assert not is_valid_farm_id("")
    assert not is_valid_farm_id("not-a-farm")
    assert not is_valid_farm_id("12abc")


def test_upsert_and_remove_round_trip(aws_env):
    registry = FarmRegistry(aws_env["bucket"])
    empty = registry.load()
    assert empty["farms"] == []

    registry.upsert("3666918801844311", name="rmr", active=True)
    registry.upsert("2791164672544774", name="", active=True)
    loaded = registry.load()
    assert len(loaded["farms"]) == 2
    assert loaded["farms"][0] == {
        "farm_id": "3666918801844311",
        "name": "rmr",
        "active": True,
    }

    registry.upsert("3666918801844311", name="rmr-2", active=False)
    assert registry.get("3666918801844311")["name"] == "rmr-2"
    assert registry.list_farms(active_only=True) == [
        {"farm_id": "2791164672544774", "name": "", "active": True}
    ]

    registry.remove("2791164672544774")
    assert [farm["farm_id"] for farm in registry.list_farms()] == ["3666918801844311"]


def test_accepts_camel_case_on_read(aws_env):
    boto3.client("s3", region_name="ap-southeast-1").put_object(
        Bucket=aws_env["bucket"],
        Key="config/tracked-farms.json",
        Body=json.dumps(
            {
                "updatedAt": "2026-08-14T13:00:00Z",
                "farms": [{"farmId": "111", "name": "x", "active": True}],
            }
        ),
    )
    registry = FarmRegistry(aws_env["bucket"])
    farms = registry.list_farms()
    assert farms == [{"farm_id": "111", "name": "x", "active": True}]
