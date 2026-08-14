import os

import boto3
import pytest
from moto import mock_aws

os.environ.setdefault("AWS_DEFAULT_REGION", "ap-southeast-1")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
os.environ.setdefault("AWS_SECURITY_TOKEN", "testing")
os.environ.setdefault("AWS_SESSION_TOKEN", "testing")

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
