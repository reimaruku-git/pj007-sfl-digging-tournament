import os
from datetime import datetime, timezone

import boto3
import pytest
from moto import mock_aws
from tournament.window import parse_iso

os.environ.setdefault("AWS_DEFAULT_REGION", "ap-southeast-1")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
os.environ.setdefault("AWS_SECURITY_TOKEN", "testing")
os.environ.setdefault("AWS_SESSION_TOKEN", "testing")


@pytest.fixture
def live_join_open(monkeypatch):
    """Freeze public join clock to 16:00 UTC on an event's first day."""

    def _freeze(start: str = "2026-08-10T00:00:00+00:00") -> datetime:
        start_at = parse_iso(start)
        assert start_at is not None
        clock = start_at.replace(hour=16, minute=0, second=0, microsecond=0)
        monkeypatch.setattr("tournament.membership.utc_clock", lambda now=None: clock)
        return clock

    return _freeze


BUCKET = "pj007-test-digging-tournament"
CONFIG_TABLE = "pj007-test-config"
SCORES_TABLE = "pj007-test-scores"
SUBMISSIONS_TABLE = "pj007-test-submissions"


@pytest.fixture
def aws_env():
    with mock_aws():
        s3 = boto3.client("s3", region_name="ap-southeast-1")
        s3.create_bucket(
            Bucket=BUCKET,
            CreateBucketConfiguration={"LocationConstraint": "ap-southeast-1"},
        )
        dynamodb = boto3.client("dynamodb", region_name="ap-southeast-1")
        dynamodb.create_table(
            TableName=CONFIG_TABLE,
            KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "pk", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        dynamodb.create_table(
            TableName=SCORES_TABLE,
            KeySchema=[{"AttributeName": "farm_id", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "farm_id", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        dynamodb.create_table(
            TableName=SUBMISSIONS_TABLE,
            KeySchema=[{"AttributeName": "farm_id", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "farm_id", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        yield {
            "bucket": BUCKET,
            "config_table": CONFIG_TABLE,
            "scores_table": SCORES_TABLE,
            "submissions_table": SUBMISSIONS_TABLE,
        }
