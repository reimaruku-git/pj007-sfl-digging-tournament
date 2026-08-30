# SFL Digging Tournament (pj007)

Agent rules (read first): **[AGENTS.md](AGENTS.md)**. House HTTP contract:
`~/.grok/skills/fullstack-api/SKILL.md`.

Players compete to collect **all 3 Otter Pebbles** in the fewest digs.

- Sand Shovel = **1 dig**
- Sand Drill = **4 numbered digs** (API may stamp the whole drill as one number; an OP from that drill sits on the last of the 4)
- Official average = **sum of days that already have a 3rd-OP score ÷ that day count** (a missed recorded day still counts; today is omitted until it has a number)
- Auto-sync at **14:00, 16:00, 18:00, 20:00, 23:00 UTC**. After 23:00, later digs do not count. Farms missing Otter Pebbles get `max(highest completed, 30) + 5 × missing`.
- Lower score ranks higher
- Farm IDs live in `s3://pj007-dev-digging-tournament/config/tracked-farms.json`
- The browser talks **only** to our API. The SFL Community API key stays on Lambda.
- Admin is **Cognito** (admin-created users, no self-signup). Public leaderboard has no login.

## Layout

```
backend/     SAM Python 3.13 — HTTP API + scheduled farm sync
frontend/    Vite + React — public leaderboard + master admin
.github/     OIDC deploy: push `dev` → dev account; push `main` → prd account
```

## Local

```bash
# backend
cd backend
poetry install
poetry run pytest tests/unit -v
# SFL keys: s3://pj007-dev-digging-tournament-secrets/sfl-api-keys.json
make local-api   # http://localhost:3001 (Cognito not enforced locally)

# frontend
cd frontend
cp .env.example .env.local
npm install
npm test
npm run dev      # http://localhost:5173
```

Live **prd** site: https://bumpkinclash.com  
API: https://api.bumpkinclash.com

Live **dev** site: https://d1balcacprl09z.cloudfront.net  
API: https://oacun88q99.execute-api.ap-southeast-1.amazonaws.com/dev

## Deploy

First **dev** deploy is local (creates the GitHub OIDC **role** for this repo;
the account OIDC provider already exists). After that, `git push origin dev`
deploys backend + frontend.

**prd:** create the GitHub OIDC role in account `498754465871` (do not recreate
the provider), set GitHub var `PRD_AWS_DEPLOY_ROLE_ARN`, then merge to `main`.

See [SETUP_CHECKLIST.md](SETUP_CHECKLIST.md).

## Scoring

See `backend/lib/tournament/scoring.py` and `backend/tests/unit/test_scoring.py`.
