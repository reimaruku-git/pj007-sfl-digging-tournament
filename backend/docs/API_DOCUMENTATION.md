# SFL Digging Tournament API

Wire JSON is **snake_case**. The browser talks only to this API.

Auth for admin routes: Cognito **ID token** in `Authorization` — raw token, no `Bearer ` prefix.
API Gateway verifies the JWT. There is no `/admin/login` on this API; the browser signs in to Cognito (Amplify SRP).
Public routes (`/health`, `/config`, `/leaderboard`, `/farms/{farm_id}`, `/tournaments`, `/tournaments/{id}`, `/tournaments/{id}/farms/{farm_id}`, `POST /submissions`) have no authorizer.

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

An empty catalog does **not** invent a default Active window. Then
`start_at` / `end_at` are `null`, `duration_days` is `0`, and `status`
is `scheduled`.

```json
{
  "tournament_id": "20260814T120000Z_7d",
  "name": "Week of 14 Aug",
  "start_at": "2026-08-14T12:00:00+00:00",
  "end_at": "2026-08-21T12:00:00+00:00",
  "duration_days": 7,
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
      "score": 6.0,
      "digs_to_third_op": 42,
      "digs_to_first_op": 10,
      "digs_to_second_op": 24,
      "otter_count": 3,
      "digs_today": 8,
      "total_digs": 42,
      "tournament_days": 7,
      "first_op_at": "2026-08-14T12:10:00+00:00",
      "second_op_at": "2026-08-14T12:24:00+00:00",
      "third_op_at": "2026-08-14T12:42:00+00:00",
      "last_updated_at": "2026-08-14T13:00:00+00:00",
      "status": "completed",
      "invalidated": false
    }
  ],
  "count": 1,
  "generated_at": "2026-08-14T13:00:00+00:00",
  "config": {
    "tournament_id": "20260814T120000Z_7d",
    "name": "Week of 14 Aug",
    "start_at": "2026-08-14T12:00:00+00:00",
    "end_at": "2026-08-21T12:00:00+00:00",
    "duration_days": 7,
    "prize_amount": "30",
    "status": "active",
    "last_full_sync_at": "2026-08-14T13:00:00+00:00",
    "updated_at": "2026-08-14T13:00:00+00:00"
  }
}
```

`status` is `not_started` | `in_progress` | `completed` | `invalidated`.

`score` is the official board number: `digs_to_third_op / duration_days`
(configured length, not days so far). Digs after the 3rd pebble do not
enter `score`. `total_digs` is window activity for debug and is not ranked.

`digs_to_third_op` is the flattened dig number of the 3rd pebble. After the
**23:00 UTC finalize** (and any later full sync that day), farms that did
not find all 3 get a numeric dig count instead of `null`:

`max(highest digs_to_third_op among farms that found all 3, 30) + 5 × (3 − otter_count)`

If nobody finished, the floor is 30. Mid-day syncs (14:00 / 16:00 / 18:00 /
20:00 UTC) leave incompletes as `null`. Tiles with `dugAt` after 23:00 UTC
that day are not counted. Admin `POST /admin/sync` still starts a full
sweep; the worker applies finalize when the clock is 23:00 UTC or later.

Ranking (lowest better): `score`, then `digs_to_third_op`, then
`digs_to_second_op`, then `digs_to_first_op`, then `third_op_at`,
`second_op_at`, `first_op_at`.

### `GET /farms/{farm_id}`

Shareable personal result.

```json
{
  "farm": {
    "rank": 1,
    "farm_id": "3666918801844311",
    "name": "rmr",
    "score": 6.0,
    "digs_to_third_op": 42,
    "digs_to_first_op": 10,
    "digs_to_second_op": 24,
    "otter_count": 3,
    "digs_today": 8,
    "total_digs": 42,
    "tournament_days": 7,
    "first_op_at": "2026-08-14T12:10:00+00:00",
    "second_op_at": "2026-08-14T12:24:00+00:00",
    "third_op_at": "2026-08-14T12:42:00+00:00",
    "last_updated_at": "2026-08-14T13:00:00+00:00",
    "status": "completed",
    "invalidated": false
  }
}
```

### `GET /tournaments`

Scheduled, live, and ended events. Ended standings are frozen to S3
`archives/{id}/`. With no admin-created events the list is empty
(`tournaments: []`, `count: 0`).

```json
{
  "tournaments": [
    {
      "tournament_id": "20260822T140000Z_7d",
      "name": "Late August Otter Cup",
      "start_at": "2026-08-22T14:00:00+00:00",
      "end_at": "2026-08-29T14:00:00+00:00",
      "duration_days": 7,
      "prize_amount": "30",
      "status": "scheduled",
      "archived_at": null,
      "count": 0,
      "leader_farm_id": null
    }
  ],
  "count": 1
}
```

### `GET /tournaments/{tournament_id}`

Live board if the event is active, enrolled ∩ tracked ∩ active
participants if scheduled, frozen S3 standings if ended.
`overall_average_per_day` is the mean of those entries' official scores
(3rd-OP digs ÷ that event's duration days), or `null` when none have a
score yet.

```json
{
  "tournament": {
    "tournament_id": "20260814T000000Z_7d",
    "archived_at": "2026-08-21T00:05:00+00:00",
    "config": {
      "tournament_id": "20260814T000000Z_7d",
      "name": "Week of 14 Aug",
      "start_at": "2026-08-14T00:00:00+00:00",
      "end_at": "2026-08-21T00:00:00+00:00",
      "duration_days": 7,
      "prize_amount": "30",
      "status": "ended"
    },
    "entries": [],
    "count": 0,
    "leader_farm_id": null,
    "overall_average_per_day": null
  }
}
```

### `GET /tournaments/{tournament_id}/farms/{farm_id}`

That farm's row in that event. Do not use live `GET /farms/{id}` for an
archive.

```json
{
  "farm": {
    "rank": 1,
    "farm_id": "3666918801844311",
    "name": "rmr",
    "score": 6.0,
    "digs_to_third_op": 42,
    "otter_count": 3,
    "status": "completed"
  }
}
```

### `POST /submissions`

Join request for one or more scheduled/live tournaments. Visitors have no
accounts; they send a numeric farm ID. Already-tracked farms may still
request another event. `tournament_id` (one) or `tournament_ids` (many)
is required.

```json
{
  "farm_id": "3666918801844311",
  "name": "rmr",
  "tournament_ids": ["20260814T120000Z_7d", "20260822T140000Z_7d"]
}
```

```json
{
  "submissions": [
    {
      "farm_id": "3666918801844311",
      "name": "rmr",
      "tournament_id": "20260814T120000Z_7d",
      "status": "pending",
      "submitted_at": "2026-08-14T13:00:00+00:00",
      "approved_at": null
    }
  ],
  "count": 1
}
```

`400` if no joinable `tournament_id` is sent. `409` if that
`(farm_id, tournament_id)` pair is already pending or enrolled.
Approving tournament A does not enroll the farm in tournament B.

## Admin

All `/admin/*` routes require a Cognito ID token. `401` if the token is missing or invalid.

### `GET /admin/session`

```json
{ "ok": true }
```

### `GET /admin/farms`

Collapsed player list. `digging_streak` is Sunflower Land's in-game
`farm.desert.digging.streak.count` copied at FarmSync (missing → `0`).
`average_per_day` is unique 3rd-OP digs ÷ the union of calendar days
that farm was enrolled in any tournament. The same digging record on
two overlapping boards counts once.

```json
{
  "farms": [
    {
      "farm_id": "3666918801844311",
      "name": "rmr",
      "active": true,
      "digging_streak": 3,
      "average_per_day": 6.0
    }
  ],
  "count": 1
}
```

### `GET /admin/farms/{farm_id}`

Opened player: records/history, enrollments, pending joins, SFL digging
streak, and unique-day average. In-detail actions stay on the other farm
routes (enable, refresh, snapshot, remove).

```json
{
  "farm": {
    "farm_id": "3666918801844311",
    "name": "rmr",
    "active": true,
    "digging_streak": 3,
    "average_per_day": 6.0,
    "score": {
      "farm_id": "3666918801844311",
      "digs_to_third_op": 42,
      "otter_count": 3,
      "status": "completed"
    },
    "history": [
      {
        "tournament_id": "20260701T000000Z_7d",
        "name": "July cup",
        "start_at": "2026-07-01T00:00:00+00:00",
        "end_at": "2026-07-08T00:00:00+00:00",
        "duration_days": 7,
        "score": 2.0,
        "digs_to_third_op": 14,
        "rank": 1,
        "status": "completed",
        "otter_count": 3
      }
    ],
    "enrollments": [
      {
        "farm_id": "3666918801844311",
        "name": "rmr",
        "tournament_id": "20260814T120000Z_7d",
        "status": "enrolled",
        "submitted_at": "2026-08-14T13:00:00+00:00",
        "approved_at": "2026-08-14T13:05:00+00:00",
        "tournament_name": "Week of 14 Aug",
        "tournament_status": "active"
      }
    ],
    "pending_joins": []
  }
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

Removes the farm from `config/tracked-farms.json`, deletes its score
row, and drops every pending/enrolled membership. The public board for a
scheduled or live event lists only farms enrolled in that event that are
still tracked and **active**. Removing a farm from one tournament leaves
their other enrollments and the global player row.

### `GET /admin/submissions`

Pending joins across all events. Each row names the tournament they
asked for.

```json
{
  "submissions": [
    {
      "farm_id": "3666918801844311",
      "name": "rmr",
      "tournament_id": "20260814T120000Z_7d",
      "status": "pending",
      "submitted_at": "2026-08-14T13:00:00+00:00",
      "approved_at": null
    }
  ],
  "count": 1
}
```

### `POST /admin/submissions/{farm_id}/{tournament_id}/approve`

Enrolls the farm in that tournament only. Adds them to the S3 registry
if they are not already tracked.

```json
{ "farm": { "farm_id": "3666918801844311", "name": "rmr", "active": true } }
```

### `DELETE /admin/submissions/{farm_id}/{tournament_id}`

Rejects that pending join. Other pending or enrolled rows are unchanged.

```json
{ "ok": true }
```

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

Minimum duration is 1 day. Prefer `duration_days` (1, 7, or 30 are the
usual lengths); `end_at` is derived as `start_at + duration_days`.
`end_at` is still accepted. `prize_amount` is a JSON string.

Changing start/length archives the previous event to S3 first. After a
successful write the handler re-scores farms that have snapshots.
Prefer `POST /admin/tournaments` to queue a new named event.

```json
{
  "name": "Week of 14 Aug",
  "start_at": "2026-08-14T00:00:00+00:00",
  "duration_days": 7,
  "prize_amount": "30"
}
```

### `GET /admin/tournaments`

Same list shape as `GET /tournaments`.

### `POST /admin/tournaments`

Create a named event. `201` `{ "tournament": { … } }`. Windows may not
overlap a scheduled or live event. Minimum 1 day. `name` is required
(1–80 chars). `end_at` or `duration_days` is required.

```json
{
  "name": "Late August Otter Cup",
  "start_at": "2026-08-22T14:00:00+00:00",
  "end_at": "2026-08-29T14:00:00+00:00",
  "prize_amount": "30"
}
```

A window that has already started becomes `active` if nothing else is
live. Otherwise it is `scheduled`.

### `PUT /admin/tournaments/{tournament_id}`

Scheduled or live: name, `start_at`, `duration_days` (or `end_at`), and
prize. Changing the live window re-scores farms from snapshots. Ended:
`409`.

### `DELETE /admin/tournaments/{tournament_id}`

Cancel a scheduled or live event. Ended → `409`. Deleting the live
event clears the current window; the catalog stays empty until an
admin creates another.

```json
{ "ok": true }
```

### `GET /admin/tournaments/{tournament_id}/roster`

Enrolled players and pending joins for that event.

```json
{
  "members": [
    {
      "farm_id": "3666918801844311",
      "name": "rmr",
      "tournament_id": "20260814T120000Z_7d",
      "status": "enrolled",
      "submitted_at": "2026-08-14T13:00:00+00:00",
      "approved_at": "2026-08-14T13:05:00+00:00",
      "active": true,
      "tracked": true
    }
  ],
  "count": 1
}
```

### `POST /admin/tournaments/{tournament_id}/farms`

Multi-add existing tracked players onto that tournament.

```json
{ "farm_ids": ["3666918801844311", "2791164672544774"] }
```

```json
{
  "farms": [
    { "farm_id": "3666918801844311", "name": "rmr", "active": true }
  ],
  "count": 1
}
```

`404` if the tournament or a farm is missing. `409` if the event has ended.

### `DELETE /admin/tournaments/{tournament_id}/farms/{farm_id}`

Unenroll from that tournament only. The global player row stays.

```json
{ "ok": true }
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
