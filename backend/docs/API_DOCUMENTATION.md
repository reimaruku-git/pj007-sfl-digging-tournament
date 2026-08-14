# SFL Digging Tournament API

Wire JSON is **snake_case**. The browser talks only to this API.

Auth for admin routes: `Authorization: <session token>` — raw token, no `Bearer ` prefix.

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

### `POST /admin/login`

```json
{ "password": "..." }
```

```json
{
  "token": "1700000000.ab12.signature",
  "expires_at": "2026-08-15T01:00:00+00:00"
}
```

### `GET /admin/session`

```json
{ "ok": true, "expires_at": "2026-08-15T01:00:00+00:00" }
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

### `PUT /admin/config`

Minimum duration is 7 days. `prize_amount` is a JSON string.

```json
{
  "start_at": "2026-08-14T00:00:00+00:00",
  "end_at": "2026-08-21T00:00:00+00:00",
  "prize_amount": "30"
}
```

### `POST /admin/farms/{farm_id}/refresh`

Force-refresh one farm (still respects the 10–15s SFL gap).

### `POST /admin/sync`

`202` — invokes the scheduled sync Lambda asynchronously.

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
