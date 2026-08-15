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

Admin login is **Amazon Cognito** (this stack’s user pool). Create the `Admin`
user in the console after the pool exists — there is no shared website password.

Do **not** recreate the GitHub OIDC provider. It already exists:

`arn:aws:iam::917147260700:oidc-provider/token.actions.githubusercontent.com`

## 1. Secrets (local, gitignored)

Write `backend/.env` (never commit):

```
SFL_API_KEY=<community API key from in-game Developer Options>
ALLOWED_ORIGIN=*
```

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
| `CognitoUserPoolId` | GitHub var `DEV_VITE_COGNITO_USER_POOL_ID` |
| `CognitoUserPoolClientId` | GitHub var `DEV_VITE_COGNITO_USER_POOL_CLIENT_ID` |

### Create the Admin user (console)

1. Cognito → User pools → `pj007-dev-digging-tournament-users`
2. Create user
3. Username: `Admin` (case-insensitive)
4. Set email + password yourself
5. Mark email verified
6. Uncheck “User must change password” if you want to use that password immediately
7. Do **not** enable self-registration

Sign in at `/admin` with username `Admin` and that password.

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
| `DEV_VITE_COGNITO_USER_POOL_ID` | stack `CognitoUserPoolId` |
| `DEV_VITE_COGNITO_USER_POOL_CLIENT_ID` | stack `CognitoUserPoolClientId` |

Repo secrets:

| Secret | Value |
|---|---|
| `SFL_API_KEY` | Community API key |
| `DISCORD_WEBHOOK_URL` | optional |

The OIDC role trusts this repo only. New GitHub repos emit an immutable
`sub` (`repo:owner@id/name@id:…`). This stack allows both that form and the
classic `repo:reimaruku-git/pj007-sfl-digging-tournament:*` form.

## 4. Environment variables (Lambda)

| Name | Purpose |
|---|---|
| `SFL_API_KEY` | Community API `X-Api-Key` |
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
| `VITE_COGNITO_USER_POOL_ID` | Stack output `CognitoUserPoolId` |
| `VITE_COGNITO_USER_POOL_CLIENT_ID` | Stack output `CognitoUserPoolClientId` |

## 5. S3 layout

```
pj007-dev-digging-tournament/
├── frontend/                 ← CloudFront origin path
├── config/tracked-farms.json ← source of truth for Farm IDs
└── snapshots/                ← raw grids + daily leaderboard
```
