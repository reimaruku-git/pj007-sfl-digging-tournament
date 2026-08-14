# Setup — SFL Digging Tournament (pj007)

One AWS account (`917147260700`, `ap-southeast-1`). This stack only:
`sfl-pj007-dev-digging-tournament`.

Live (dev):

| | |
|---|---|
| Site | https://d1balcacprl09z.cloudfront.net |
| API | https://oacun88q99.execute-api.ap-southeast-1.amazonaws.com/dev |
| Admin | https://d1balcacprl09z.cloudfront.net/admin |
| OIDC role | `arn:aws:iam::917147260700:role/pj007-dev-digging-tournament-github-deploy-role` |

The plaintext master-admin password is in the local gitignored file `backend/.admin-password`.

Do **not** recreate the GitHub OIDC provider. It already exists:

`arn:aws:iam::917147260700:oidc-provider/token.actions.githubusercontent.com`

## 1. Secrets (local, gitignored)

```bash
cd backend
python3 - <<'PY'
import secrets, sys
from pathlib import Path
sys.path.insert(0, "lib")
from tournament.admin_auth import hash_password
password = secrets.token_urlsafe(18)
print("ADMIN_PASSWORD=" + password)
print("ADMIN_PASSWORD_HASH=" + hash_password(password))
print("ADMIN_SESSION_SECRET=" + secrets.token_hex(32))
PY
```

Write `backend/.env` (never commit):

```
SFL_API_KEY=<community API key from in-game Developer Options>
ADMIN_PASSWORD_HASH=<from the script>
ADMIN_SESSION_SECRET=<from the script>
ALLOWED_ORIGIN=*
```

Save the plaintext admin password somewhere private.

## 2. First deploy (SSO, this stack only)

```bash
aws sso login --profile rm-dev   # if the session expired
cd backend
poetry install
make test
make deploy-dev
```

Outputs you need:

| Output | Used as |
|---|---|
| `ApiUrl` | GitHub var `DEV_VITE_API_BASE` |
| `AppBucketName` | GitHub var `DEV_S3_BUCKET` |
| `CloudFrontDomainName` | GitHub var `DEV_ALLOWED_ORIGIN` + `AllowedOrigin` redeploy |
| `CloudFrontDistributionId` | GitHub var `DEV_CF_DISTRIBUTION_ID` |
| `GitHubActionsDeployRoleArn` | GitHub var `DEV_AWS_DEPLOY_ROLE_ARN` |

Seed the Farm ID file:

```bash
aws s3 cp - s3://pj007-dev-digging-tournament/config/tracked-farms.json <<'JSON'
{"updated_at":"2026-08-14T13:00:00+00:00","farms":[{"farm_id":"3666918801844311","name":"rmr","active":true},{"farm_id":"2791164672544774","name":"","active":true}]}
JSON
```

Then set `ALLOWED_ORIGIN` to the CloudFront URL and run `make deploy-dev` again.

## 3. GitHub (push to `dev` deploys FE + BE)

Repo variables:

| Variable | Value |
|---|---|
| `AWS_REGION` | `ap-southeast-1` |
| `DEV_VITE_API_BASE` | stack `ApiUrl` (include `/dev`) |
| `DEV_AWS_DEPLOY_ROLE_ARN` | stack `GitHubActionsDeployRoleArn` |
| `DEV_S3_BUCKET` | `pj007-dev-digging-tournament` |
| `DEV_CF_DISTRIBUTION_ID` | stack `CloudFrontDistributionId` |
| `DEV_ALLOWED_ORIGIN` | `https://<dist>.cloudfront.net` |

Repo secrets:

| Secret | Value |
|---|---|
| `SFL_API_KEY` | Community API key |
| `ADMIN_PASSWORD_HASH` | pbkdf2 hash |
| `ADMIN_SESSION_SECRET` | HMAC secret |
| `DISCORD_WEBHOOK_URL` | optional |

The OIDC role trusts this repo only. New GitHub repos emit an immutable
`sub` (`repo:owner@id/name@id:…`). This stack allows both that form and the
classic `repo:reimaruku-git/pj007-sfl-digging-tournament:*` form.

## 4. Environment variables (Lambda)

| Name | Purpose |
|---|---|
| `SFL_API_KEY` | Community API `X-Api-Key` |
| `ADMIN_PASSWORD_HASH` | Master-admin password hash |
| `ADMIN_SESSION_SECRET` | Session HMAC secret |
| `DATA_BUCKET` | App bucket |
| `CONFIG_TABLE` / `SCORES_TABLE` / `SUBMISSIONS_TABLE` | DynamoDB |
| `ALLOWED_ORIGIN` / `ALLOWED_ORIGINS` | CORS |
| `SFL_MIN_INTERVAL_SECONDS` | `12` (must be ≥ 10) |
| `DISCORD_WEBHOOK_URL` | Optional 1st-place ping |
| `FARM_SYNC_FUNCTION` | Main Lambda invokes this for full sync |

Frontend:

| Name | Purpose |
|---|---|
| `VITE_API_BASE` | Our API Gateway URL. Required. No hardcoded fallback. |

## 5. S3 layout

```
pj007-dev-digging-tournament/
├── frontend/                 ← CloudFront origin path
├── config/tracked-farms.json ← source of truth for Farm IDs
└── snapshots/                ← raw grids + daily leaderboard
```
