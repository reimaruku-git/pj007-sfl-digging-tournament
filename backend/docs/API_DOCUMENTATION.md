# SFL Digging Tournament API

Wire JSON is **snake_case**. The browser talks only to this API.

Auth for admin routes: Cognito **ID token** in `Authorization` — raw token, no `Bearer ` prefix.
API Gateway verifies the JWT. There is no `/admin/login` on this API; the browser signs in to Cognito (Amplify SRP).
Public routes (`/health`, `/config`, `/leaderboard`, `/farms/{farm_id}`, `POST /submissions`) have no authorizer.

Errors:

```json
{ "error": "VALIDATION_ERROR", "message": "farm_id is required" }
```

## Public

### `GET /health`

```json
{ "status": "healthy" }
```

### `GET /config`

```json
{
  "start_at": "2026-08-14T12:00:00+00:00",
  "end_at": "2026-08-21T12:00:00+00:00",
  "prize_amount": "30",
  "status": "active",
  "last_full_sync_at": "2026-08-14T13:00:00+00:00",
  "updated_at": "2026-08-14T13:00:00+00:00"
}
```

### `GET /leaderboard`

Cached snapshot. Frontend never calls the SFL API.

```json
{
  "entries": [
    {
      "rank": 1,
      "farm_id": "3666918801844311",
      "name": "rmr",
      "digs_to_third_op": 42,
      "otter_count": 3,
      "digs_today": 8,
      "total_digs": 42,
      "last_updated_at": "2026-08-14T13:00:00+00:00",
      "status": "completed",
      "invalidated": false
    }
  ],
  "count": 1,
  "generated_at": "2026-08-14T13:00:00+00:00",
  "config": {
    "start_at": "2026-08-14T12:00:00+00:00",
    "end_at": "2026-08-21T12:00:00+00:00",
    "prize_amount": "30",
    "status": "active",
    "last_full_sync_at": "2026-08-14T13:00:00+00:00",
    "updated_at": "2026-08-14T13:00:00+00:00"
  }
}
```

`status` is `not_started` | `in_progress` | `completed` | `invalidated`.

### `GET /farms/{farm_id}`

Shareable personal result.

```json
{
  "farm": {
    "rank": 1,
    "farm_id": "3666918801844311",
    "name": "rmr",
    "digs_to_third_op": 42,
    "otter_count": 3,
    "digs_today": 8,
    "total_digs": 42,
    "last_updated_at": "2026-08-14T13:00:00+00:00",
    "status": "completed",
    "invalidated": false
  }
}
```

### `POST /submissions`

```json
{ "farm_id": "3666918801844311", "name": "rmr" }
```

```json
{
  "submission": {
    "farm_id": "3666918801844311",
    "name": "rmr",
    "submitted_at": "2026-08-14T13:00:00+00:00",
    "status": "pending"
  }
}
```

`409` if the farm is already tracked or already pending.

## Admin

All `/admin/*` routes require a Cognito ID token. `401` if the token is missing or invalid.

### `GET /admin/session`

```json
{ "ok": true }
```

### `GET /admin/farms`

```json
{
  "farms": [
    { "farm_id": "3666918801844311", "name": "rmr", "active": true }
  ],
  "count": 1
}
```

### `POST /admin/farms`

Writes the S3 JSON source of truth.

```json
{ "farm_id": "2791164672544774", "name": "", "active": true }
```

### `PUT /admin/farms/{farm_id}`

```json
{ "name": "rmr", "active": false }
```

### `DELETE /admin/farms/{farm_id}`

Removes the farm from `config/tracked-farms.json`.

### `GET /admin/submissions`

```json
{ "submissions": [], "count": 0 }
```

### `POST /admin/submissions/{farm_id}/approve`

Moves a pending farm into the S3 registry.

### `DELETE /admin/submissions/{farm_id}`

Rejects a pending farm.

### `GET /admin/config`

Same public shape as `GET /config` — never the raw DynamoDB item.

```json
{
  "config": {
    "start_at": "2026-08-14T12:00:00+00:00",
    "end_at": "2026-08-21T12:00:00+00:00",
    "prize_amount": "30",
    "status": "active",
    "last_full_sync_at": "2026-08-14T13:00:00+00:00",
    "updated_at": "2026-08-14T13:00:00+00:00"
  }
}
```

### `PUT /admin/config`

Minimum duration is 7 days. `prize_amount` is a JSON string.

After a successful write the handler re-scores every farm that has an S3
snapshot against the new window, then kicks the farm-sync Lambda so farms
without a snapshot catch up.

```json
{
  "start_at": "2026-08-14T00:00:00+00:00",
  "end_at": "2026-08-21T00:00:00+00:00",
  "prize_amount": "30"
}
```

```json
{
  "config": {
    "start_at": "2026-08-14T00:00:00+00:00",
    "end_at": "2026-08-21T00:00:00+00:00",
    "prize_amount": "30",
    "status": "active",
    "last_full_sync_at": "2026-08-14T13:00:00+00:00",
    "updated_at": "2026-08-14T13:00:00+00:00"
  },
  "rescore": {
    "rescored": 2,
    "missing_snapshots": 0,
    "sync_accepted": true
  }
}
```

### `POST /admin/farms/{farm_id}/refresh`

`202` — asks the farm-sync worker to fetch this one tracked farm. The HTTP
handler does not call SFL and does not return a live score.

```json
{ "accepted": true, "farm_id": "3666918801844311" }
```

`404` if the farm is not in the S3 registry.

### `POST /admin/sync`

`202` — asks the farm-sync worker to walk every tracked farm. Asynchronous;
the HTTP handler does not wait for SFL.

```json
{ "accepted": true }
```

### `PUT /admin/scores/{farm_id}`

```json
{
  "override_digs_to_third_op": 40,
  "invalidated": false,
  "override_reason": "manual correction"
}
```

### `GET /admin/scores/{farm_id}/snapshot`

```json
{
  "snapshot": {
    "farm_id": "3666918801844311",
    "fetched_at": "2026-08-14T13:00:00+00:00",
    "grid": [],
    "score": {
      "digs_to_third_op": 42,
      "otter_count": 3,
      "total_digs": 42,
      "digs_today": 8,
      "status": "completed"
    }
  }
}
```
