# AGENTS.md — SFL Digging Tournament (pj007)

**This file is the canonical agent guide for this product.** After `/clear`,
read it first. Do not reinvent architecture from chat history.

House HTTP contract (every product):
`/home/reymark_dev/.grok/skills/fullstack-api/SKILL.md`

This file is the **pj007 overlay**: product rules, live stack, deploy, and
exceptions. If this file and the skill disagree on *this* repo, this file
wins.

Default branch for push/deploy: **`dev`**.

**Auto-push (this repo only):** when a change is finished and the tests
that belong with it pass, commit and `git push origin dev` without
waiting to be asked. House commit rules still apply (message, stage by
path, no secrets). Do not push mid-task, `temp/`, or `.env`. This file
wins over the commit skill’s “do not push unless asked.”

---

## What this is

Sunflower Land players compete to collect **all 3 Otter Pebbles** in the
fewest digs. Public leaderboard + farm pages. Admin panel for farms,
config, scores, and force-refresh.

| Piece | Stack |
|-------|--------|
| Backend `backend/` | Python 3.13 / Lambda / SAM / HTTP API / DynamoDB / S3 / Cognito |
| Frontend `frontend/` | React + TypeScript / Vite / Amplify v6 / CloudFront+S3 |
| CI | One repo. Push `dev` → GitHub Actions OIDC → SAM then S3/CloudFront |

One git remote. Not two-repo like the SFL tracker.

---

## Hard constraints (do not violate)

1. **One AWS account:** `917147260700`, region `ap-southeast-1`.
2. **This stack only:** `sfl-pj007-dev-digging-tournament`. Never touch
   other stacks, buckets, tables, roles, or accounts.
3. **Do not recreate** the account GitHub OIDC provider
   (`token.actions.githubusercontent.com`). It already exists. This stack
   only owns the *role* that trusts this repo.
4. The browser talks **only to our API**. The SFL Community API key stays
   on Lambda (`X-Api-Key`). Never call
   `https://api.sunflower-land.com` from the frontend.
5. SFL farm fetches are **10–15s apart** (`SFL_MIN_INTERVAL_SECONDS=12`,
   hard minimum 10). Back off on 429/403.
6. Explicit IAM: `AWS::IAM::Role` + `Role: !GetAtt …Arn`. No SAM
   `Policies:` shorthand. `CAPABILITY_NAMED_IAM` in every
   `samconfig.toml` env.
7. Secrets are SAM `NoEcho` → Lambda env (and GitHub secrets). **Do not**
   move them to Secrets Manager unless asked.

---

## Live (dev)

| | |
|---|---|
| Site | https://d1balcacprl09z.cloudfront.net |
| Admin | https://d1balcacprl09z.cloudfront.net/admin |
| API | https://oacun88q99.execute-api.ap-southeast-1.amazonaws.com/dev |
| Stack | `sfl-pj007-dev-digging-tournament` |
| Bucket | `pj007-dev-digging-tournament` |
| CF dist | `E1JS5TIONRJY9F` |
| Cognito pool | `ap-southeast-1_PGeUz81zg` (`pj007-dev-digging-tournament-users`) |
| Cognito client | `5uevf5a3v7o054uh3u8trggidf` |
| OIDC role | `arn:aws:iam::917147260700:role/pj007-dev-digging-tournament-github-deploy-role` |
| SSO profile | `rm-dev` |

Console users:
https://ap-southeast-1.console.aws.amazon.com/cognito/v2/idp/user-pools/ap-southeast-1_PGeUz81zg/users?region=ap-southeast-1

---

## Architecture

```
Browser  ──public──►  HTTP API  ──►  Main Lambda (router)
   │                      │
   └──/admin/* JWT──►     ├── DynamoDB: config / scores / submissions
                          ├── S3: config/tracked-farms.json + snapshots/
                          └── SFL Community API (server-side, rate-limited)

EventBridge (14/16/18/20/23 UTC) ──► FarmSync Lambda (full sweep or one farm)
Admin POST /admin/sync and /admin/farms/{id}/refresh ──► async invoke FarmSync
HTTP never calls the SFL Community API.
```

| Resource | Name / key |
|----------|------------|
| Config table | `pj007-dev-digging-tournament-config` (`pk`) |
| Scores table | `pj007-dev-digging-tournament-scores` (`farm_id`) |
| Submissions | `pj007-dev-digging-tournament-submissions` (`farm_id`) |
| Leaderboard cache | config table item `pk=LEADERBOARD` |
| Farm registry | `s3://pj007-dev-digging-tournament/config/tracked-farms.json` |
| Frontend origin | bucket prefix `frontend/` (CloudFront OriginPath) |
| Snapshots | `s3://…/snapshots/` |
| Tournament archives | `s3://…/archives/{tournament_id}/` |

S3 layout:

```
pj007-dev-digging-tournament/
├── frontend/                 ← CloudFront origin
├── config/tracked-farms.json ← Farm ID source of truth
├── snapshots/{farm_id}.json  ← live latest grid (today only)
├── snapshots/daily/{day}.json ← that UTC day's leaderboard dump
├── snapshots/history/{farm_id}/{day}.json ← each tournament day
└── archives/{tournament_id}/ ← meta + standings + farm copies
```

### Lambdas

| Function | Path | Role |
|----------|------|------|
| `pj007-dev-digging-tournament-main-function` | `backend/lambda_functions/main_function/app.py` | HTTP router |
| `pj007-dev-digging-tournament-farm-sync` | `backend/lambda_functions/farm_sync/app.py` | Scheduled sweep or one-farm refresh |

Shared code is a Lambda layer from `backend/lib/`.

---

## Auth (Cognito)

House Cognito mode, with a **product exception** on which routes are public.

| Surface | Auth |
|---------|------|
| `/health`, `/config`, `/leaderboard`, `/farms/{id}`, `/tournaments`, `POST /submissions` | **None** — public tournament |
| `/admin/*` | API Gateway JWT (`CognitoAuthorizer`) |

- Admin-created users only (`AllowAdminCreateUserOnly`). **No self-signup.**
- Username login (not email-as-username). Email is required on the user.
- Case-insensitive usernames.
- Password policy: 8+ chars, upper + lower + number. No symbol required.
- Tokens: ID/Access 1h, refresh 30d. `GenerateSecret: false`.
- Header: `Authorization: <Cognito ID token>` — **raw, no `Bearer ` prefix.**
- Frontend: Amplify v6 SRP (`frontend/src/auth/amplify.ts`).
- 401 on admin → `signOut` + stay/redirect `/admin`.
- `GET /admin/session` returns `{ok: true}` once the JWT has already
  passed API Gateway. Lambda does not re-check the password.
- Pool `DeletionPolicy: Retain`.

**Do not restore HMAC / shared website password.** Deleted on purpose:
`backend/lib/tournament/admin_auth.py`, `POST /admin/login`,
`AdminPasswordHash`, `AdminSessionSecret`. Leftover local
`backend/.admin-password` and unused GitHub secrets
`ADMIN_PASSWORD_HASH` / `ADMIN_SESSION_SECRET` are dead — ignore them.

**Do not add `DefaultAuthorizer: NONE`.** SAM rejects that unless `NONE`
is defined. Public routes stay open by omitting a default; each
`/admin/*` event sets `Auth: Authorizer: CognitoAuthorizer`.

### Creating the Admin user

The agent does **not** create Cognito users unless asked. Operator:

1. Cognito → pool `pj007-dev-digging-tournament-users`
2. Create user, username `Admin`, set email + password
3. Mark email verified
4. Uncheck “User must change password” to use that password immediately
   (frontend also handles `NEW_PASSWORD_REQUIRED`)
5. Sign in at `/admin`

---

## Scoring (do not invent)

Canonical: `backend/lib/tournament/scoring.py` +
`backend/tests/unit/test_scoring.py`.

- Walk `farm.desert.digging.grid` in order.
- Nested list = one Sand Drill: **4** numbered slots. Items (including an
  Otter Pebble) sit on the **last** slot.
- Top-level `tool == "Sand Drill"` is the same: **4** slots, items on last.
- Four sibling `Sand Drill` tiles that share the same `dugAt` are one
  drill the API numbered once (e.g. “5th dig” on all 4 holes → 5–8).
- Every other top-level tile (Sand Shovel / unknown) costs **1**.
- Official displayed score = **sum of each tournament day's 3rd-pebble
  digs ÷ configured duration days**. Digs after that day's 3rd pebble
  do not enter that day. SFL's desert grid resets every UTC day — store
  each day under `snapshots/history/{farm_id}/{day}.json`. Never overwrite
  yesterday's file or score with today's fetch.
- Once a day's 3rd-pebble dig count is set, later tiles that day do not
  change it. A finalized day is not rewritten by a later sync.
- Tie-break: fewer digs to 3rd OP, then 2nd, then 1st; then earlier
  `third_op_at`, `second_op_at`, `first_op_at`.
- Tiles outside the tournament window (by `dugAt`) are ignored.
- Scheduled full syncs: **14:00, 16:00, 18:00, 20:00, 23:00 UTC**.
  23:00 is the day’s final sync. Admin `POST /admin/sync` is on-demand.
- At 23:00 UTC (and later that UTC day): tiles with `dugAt` after 23:00
  are not counted. Completers keep their 3rd-OP score. Incompletes get
  `max(highest completed 3rd-OP, 30) + 5 × (3 − otter_count)`.
  No completers → floor 30. Mid-day syncs do **not** assign that penalty.
- Lower score ranks higher.
- Default prize is `"30"` Flower (JSON **string**). Min period **1 day**.
  Admin creates named tournaments (`POST /admin/tournaments`) with from/to
  or start + `duration_days`. Empty catalog is valid — do not invent a
  default Active window. Admin can create, edit (including live duration),
  and delete scheduled and live events.
  One live event; others are scheduled or ended. Ended events freeze to
  S3 `archives/{id}/` (meta + standings + farm snapshots). Public
  `GET /tournaments` lists upcoming, live, and past. A scheduled or live
  public board lists only farms enrolled in that event that are still
  tracked and **active**. `DELETE /admin/farms/{id}` also deletes that
  farm’s score row and every membership.
- `PUT /admin/config` re-scores farms from S3 snapshots against the new
  window, then kicks FarmSync for farms that have no snapshot. Do not only
  refresh the cached board.

Do not change scoring without updating the unit tests in the same change.

---

## Wire contract

Follow the fullstack-api skill. This product’s examples live in
`backend/docs/API_DOCUMENTATION.md` — update that file in the **same
change** as the handler.

Feature landing order:

1. Backend handler + route + pytest (moto, no real AWS)
2. Request/response example in `docs/API_DOCUMENTATION.md`
3. Typed function in `frontend/src/api/{public,admin}.ts` via `requestJson`
4. Page/hook consumes that function (React Query). Never raw `fetch`.

Rules that bite here:

- Wire JSON is **snake_case**. TS types match 1:1. No camelCase remap.
- `create_response` / `create_error_response` only. No hand-built API GW dicts.
- Errors: `{ "error": "SCREAMING_SNAKE", "message": "…" }`.
- Lists: named collection + `count` (`farms`, `entries`, `submissions`).
- Money (`prize_amount`) is a JSON **string**.
- Time is ISO-8601 UTC.
- `VITE_API_BASE` is required. **No hardcoded production fallback.**
- Paths to `requestJson` have **no** leading slash (`leaderboard`, not `/leaderboard`).
- `VITE_COGNITO_USER_POOL_ID` and `VITE_COGNITO_USER_POOL_CLIENT_ID` are
  required. `amplify.ts` throws if they are missing.

---

## Frontend

| Path | Role |
|------|------|
| `src/auth/amplify.ts` | Amplify config; loaded only with the admin chunk |
| `src/auth/session.ts` | ID token + 401 → signOut → `/admin` |
| `src/api/client.ts` | **Only** HTTP transport |
| `src/api/public.ts` | Leaderboard, farm, config, submit |
| `src/api/admin.ts` | Admin endpoints (no `adminLogin`) |
| `src/components/Layout.tsx` | Public chrome: burger (rules / join / find farm). No Admin link. |
| `src/pages/TournamentsPage.tsx` | Upcoming / live / past events |
| `src/pages/LeaderboardPage.tsx` | Public board (`/` default): podium, pebble marks, next-sync clock |
| `src/pages/FarmPage.tsx` | Shareable personal result |
| `src/pages/AdminPage.tsx` | Amplify signIn + panel. Reachable only by typing `/admin`. |

Theme is **muted dusk**, not neon gold. Tokens in `frontend/src/index.css`:
`--bg #1a1815`, `--gold #b89a56`. Do not revert to `#e8b923` on near-black.

Verify UI in the browser when you change layout, routing, or admin/public
state. Check both `/` and `/admin` (and `/farm/:id` if farm data changed).

---

## Commands

### Backend

```bash
cd backend
poetry install
poetry run pytest tests/unit -v
make local-api          # http://localhost:3001 — Cognito not enforced
make deploy-dev         # needs SFL_API_KEY in backend/.env
```

`sam local start-api --port 3001`. HTTP API local has **no** stage prefix
(`/health`, not `/dev/health`). Deployed URLs keep `/dev`.

`PYTHONPATH` includes `.` and `lib/` (pytest config). Black line length 100.

### Frontend

```bash
cd frontend
cp .env.example .env.local   # VITE_API_BASE + both Cognito IDs
npm install
npm test
npm run dev                  # http://localhost:5173
```

### Deploy

After the first local SAM deploy, **do not deploy from the laptop by
default.** A finished change is pushed to `dev` in the same turn:

```
git push origin dev
```

→ `.github/workflows/deploy-dev.yml`

1. OIDC assume `pj007-dev-digging-tournament-github-deploy-role`
2. `sam deploy` (existing artifact bucket, `resolve_s3=false`)
3. `npm run build` with `VITE_*` from GitHub vars
4. Sync `frontend/dist` → `s3://…/frontend/` + CloudFront `/*`

Never pass both `--resolve-s3` and `--s3-bucket`. Use `--s3-bucket`
`aws-sam-cli-managed-default-samclisourcebucket-mfrfb3arh90t`.

Local `make deploy-dev` defaults `AllowedOrigin` from `backend/.env`. If
that file still has `ALLOWED_ORIGIN=*`, a laptop deploy will reopen CORS.
Prefer Actions, or set `ALLOWED_ORIGIN` to the CloudFront URL.

New GitHub repos emit an **immutable** OIDC `sub`:
`repo:reimaruku-git@248281558/pj007-sfl-digging-tournament@1334189130:ref:refs/heads/dev`.
This stack trusts that form **and** the classic
`repo:reimaruku-git/pj007-sfl-digging-tournament:*`. Do not “fix” the
trust policy down to one form.

---

## GitHub vars / secrets (already set)

Vars: `AWS_REGION`, `DEV_VITE_API_BASE`, `DEV_AWS_DEPLOY_ROLE_ARN`,
`DEV_S3_BUCKET`, `DEV_CF_DISTRIBUTION_ID`, `DEV_ALLOWED_ORIGIN`,
`DEV_VITE_COGNITO_USER_POOL_ID`, `DEV_VITE_COGNITO_USER_POOL_CLIENT_ID`.

Secrets: `SFL_API_KEY`. Optional `DISCORD_WEBHOOK_URL` (unset = no
1st-place ping).

Do not print tokens. Do not recreate vars that already exist.

---

## Tests

- Backend: pytest + moto. **No real AWS** in unit tests.
- Admin handler tests invoke Lambda directly — the JWT authorizer is API
  Gateway, so unit tests do not mint Cognito tokens.
- Frontend: vitest. API-module tests `vi.mock("./client")`. No network.

---

## Workflows

Project copies live in `.grok/workflows/`. This workspace’s project folder is
not trusted for named launches, so the same files are also in
`~/.grok/workflows/`. Watch runs in `/workflows`.

| Name | When | Agents (max) |
|------|------|----------------|
| `pj007-review` | Before push / after a feature | 5 reviewers + 1 skeptic per finding (cap 16) |
| `pj007-live-check` | After a deploy | 3 probes (public API, admin 401, frontend bundle) |

```
/workflow pj007-review {"target":"working tree vs AGENTS.md"}
/workflow pj007-live-check
```

Review is read-only. Live-check is GET-only against the CloudFront site and
our API — it must not POST `/submissions` or call SFL.

---

## Docs map

| Doc | Role |
|-----|------|
| **This file** | Agent rules + live facts |
| `README.md` | Human overview + local commands |
| `SETUP_CHECKLIST.md` | First-deploy + console Admin user |
| `backend/docs/API_DOCUMENTATION.md` | HTTP contract (source of truth for FE types) |

---

## Do not

| Habit | Why |
|-------|-----|
| Recreate the account OIDC provider | Already exists; account-wide |
| Touch any stack that is not `sfl-pj007-dev-digging-tournament` | One-account, this product only |
| Call SFL from the browser | Key + rate limit live on Lambda |
| Restore HMAC / `POST /admin/login` | Replaced by Cognito |
| `Authorization: Bearer …` | Breaks the JWT authorizer |
| `DefaultAuthorizer: NONE` | SAM lint rejects it |
| Secrets Manager for SFL_API_KEY | Deliberately env/NoEcho |
| SAM `Policies:` shorthand | House IAM rule |
| `resolve_s3=true` | AccessDenied on the managed bucket |
| Hardcoded `VITE_API_BASE` | Wrong API in the wrong env |
| Neon gold `#e8b923` on near-black | Eye strain; dusk palette is the look |
| Invent dig scoring | Tests + `scoring.py` are the rules |
| Create the Cognito `Admin` user unasked | Operator does that in the console |

---

## After `/clear`

1. Trust **this AGENTS.md**, then the fullstack-api skill.
2. HTTP changes → `backend/docs/API_DOCUMENTATION.md` in the same diff.
3. Scoring changes → `scoring.py` + unit tests together.
4. Deploy → push `dev` when the change is done. Do not wait to be asked.
   Do not improvise a second pipeline.
5. Auth → Cognito ID token on `/admin/*` only. Public stays public.
6. Repeatable review / post-deploy probe → `/workflow pj007-review` or
   `/workflow pj007-live-check` (see Workflows).
