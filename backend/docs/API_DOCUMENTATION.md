# SFL Digging Tournament API

Wire JSON is **snake_case**. The browser talks only to this API.

Auth for admin routes: Cognito **ID token** in `Authorization` — raw token, no `Bearer ` prefix.
API Gateway verifies the JWT. There is no `/admin/login` on this API; the browser signs in to Cognito (Amplify SRP).
Public routes (`/health`, `/config`, `/slogans`, `/leaderboard`, `/farms/{farm_id}`, `/farms/{farm_id}/memberships`, `/tournaments`, `/tournaments/{id}`, `/tournaments/{id}/farms/{farm_id}`, `POST /identify`, `POST /submissions`) have no authorizer.

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
  "updated_at": "2026-08-14T13:00:00+00:00",
  "featured_tournament_id": "20260814T120000Z_7d",
  "min_bumpkin_island": null,
  "min_digging_streak": null,
  "vip_required": false,
  "max_players": null,
  "join_mode": "confirm",
  "description": "",
  "prize_places": [],
  "nft_giveaway": false
}
```

`tournament_id` is the soonest-ending **live** scoring window. FarmSync
follows that window. `featured_tournament_id` is the admin-chosen home
showcase (`scheduled`, `active`, or `ended`). Featuring an upcoming
event keeps that id when it goes live. It is `null` when none is set.
It is not the scoring pointer — featuring a scheduled or ended event
does not stop live sync.

### `GET /slogans`

Ordered header slogans. The browser picks one per UTC day (exhaust the
list, then restart). A `today_text` whose `today_day` is the current UTC
date wins for that day only. Empty never-stored returns the seeded six.
This is **not** the tournament window document.

```json
{
  "slogans": [
    { "text": "Slap my pets" },
    { "text": "Grow my banana" },
    { "text": "Squeeze my orange" },
    { "text": "Clean my poop" },
    { "text": "Want some weed?" },
    { "text": "Erect my monument" }
  ],
  "count": 6,
  "today_text": null,
  "today_day": null
}
```

`text` is 1–80 characters. Put any emoji in the text. `today_day` is
`YYYY-MM-DD` UTC.

### `GET /leaderboard`

Cached snapshot of the soonest-ending **live** event.
Each event's own board is `GET /tournaments/{id}`. Frontend never
calls the SFL API. Public home uses `featured_tournament_id` from
`GET /tournaments` (or `GET /config`) and loads that event's board.

```json
{
  "entries": [
    {
      "rank": 1,
      "farm_id": "3666918801844311",
      "name": "rmr",
      "score": 21.0,
      "score_first_op": 5.0,
      "score_second_op": 12.0,
      "digs_to_third_op": 42,
      "digs_to_first_op": 10,
      "digs_to_second_op": 24,
      "otter_count": 3,
      "digs_today": 8,
      "score_today": 20,
      "scored_days": 2,
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
    "updated_at": "2026-08-14T13:00:00+00:00",
    "featured_tournament_id": "20260814T120000Z_7d",
    "min_bumpkin_island": null,
    "min_digging_streak": null,
    "vip_required": false,
    "max_players": null,
    "join_mode": "confirm",
    "description": "",
    "prize_places": [],
    "nft_giveaway": false
  }
}
```

`status` is `not_started` | `in_progress` | `completed` | `invalidated`.

`digs_to_third_op` is the **total score**: the sum of each stored day's
3rd-pebble digs that already have a number. `score` is that total divided
only by those scored days (yesterday 14 + today 20 → 17; yesterday 14 +
today still `null` → 14). It is **not** divided by the configured
tournament length while some days have no score yet. A missed day that
already has a recorded 3rd-OP (including the 23:00 incomplete penalty)
still enters both total and average.

`score_first_op` and `score_second_op` use the same day-mean rule as
`score`, against `days[].digs_to_first_op` and `days[].digs_to_second_op`.
Days still `null` for that pebble are omitted. `null` when no day has a
number.

`score_today` is that UTC day's 3rd-OP (`null` until it has a number).
`otter_count` is pebbles dug today. `total_digs` is window activity for
debug and is not ranked.

Sunflower Land's desert grid resets every UTC day. Each day is kept
under `days` (and on S3 as `snapshots/history/{farm_id}/{day}.json`).
The live DynamoDB score row is derived from those days. A later fetch
must not replace an earlier day.

`days[].digs_to_third_op` is that UTC day's flattened dig number of the
3rd pebble. After the **23:00 UTC finalize** (and any later full sync
that day), farms that did not find all 3 **that day** get a numeric dig
count instead of `null`:

`max(highest digs_to_third_op among farms that found all 3, 30) + 5 × (3 − otter_count)`

If that day has no recorded 2nd pebble, `days[].digs_to_second_op` is
that penalty minus 1. No 1st pebble → penalty minus 2. Found 1st/2nd
digs stay. If nobody finished, the floor is 30. Mid-day syncs (14:00 /
16:00 / 18:00 / 20:00 UTC) leave incompletes as `null`. Tiles with `dugAt` after 23:00 UTC
that day are not counted. Admin `POST /admin/sync` still starts a full
sweep; the worker applies finalize when the clock is 23:00 UTC or later.
If the roster does not fit in one 15-minute Lambda, FarmSync invokes
itself with the remaining farms and the same frozen clock. Finalize,
daily snapshot, and archive run only after the last farm. Farms that
already have a numeric 3rd-OP for that UTC day are not fetched again;
23:00 still tallies them from the stored day file. FarmSync loads SFL
keys from a private S3 JSON list (`sfl-api-keys.json`), not Lambda env.
After every loaded key has had a successful fetch, the next wait is 10s.
Failed SFL calls still back off at least 12s.

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
    "score": 21.0,
    "score_first_op": 5.0,
    "score_second_op": 12.0,
    "digs_to_third_op": 42,
    "digs_to_first_op": 10,
    "digs_to_second_op": 24,
    "otter_count": 3,
    "digs_today": 8,
    "score_today": 20,
    "scored_days": 2,
    "total_digs": 42,
    "tournament_days": 7,
    "first_op_at": "2026-08-14T12:10:00+00:00",
    "second_op_at": "2026-08-14T12:24:00+00:00",
    "third_op_at": "2026-08-14T12:42:00+00:00",
    "last_updated_at": "2026-08-14T13:00:00+00:00",
    "status": "completed",
    "invalidated": false,
    "days": [
      {
        "day": "2026-08-14",
        "digs_to_third_op": 42,
        "digs_to_first_op": 10,
        "digs_to_second_op": 24,
        "otter_count": 3,
        "total_digs": 42,
        "digs_today": 42,
        "status": "completed",
        "finalized": true,
        "first_op_at": "2026-08-14T12:10:00+00:00",
        "second_op_at": "2026-08-14T12:24:00+00:00",
        "third_op_at": "2026-08-14T12:42:00+00:00"
      }
    ],
    "recorded_average_per_day": 21.0
  }
}
```

`score` is the featured event's official average (scored days in that
window). `recorded_average_per_day` is this farm's mean 3rd-OP over
every stored UTC day that already has a number, across events. Shared
days from overlapping windows count once. `score_today` is today's
3rd-OP from that history (null if today has no recorded score yet).

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
      "leader_farm_id": null,
      "min_bumpkin_island": null,
      "min_digging_streak": null,
      "vip_required": false,
      "max_players": null,
      "join_mode": "confirm",
      "description": "",
      "prize_places": [],
      "nft_giveaway": false,
      "enrolled_count": 0
    }
  ],
  "count": 1,
  "featured_tournament_id": "20260814T120000Z_7d"
}
```

`featured_tournament_id` is the admin-chosen home showcase, or `null`.
Scheduled, live, and ended events can be featured. The same id stays
when a scheduled event becomes live.

### `GET /tournaments/{tournament_id}`

Live board if the event is active, enrolled ∩ tracked ∩ active
participants if scheduled, frozen S3 standings if ended.
Scheduled entries are roster identity only (`not_started`, scores
`null`) so a farm's live-event digs do not leak onto an upcoming board.
`overall_average_per_day` is the mean of those entries' official scores
(3rd-OP digs ÷ that event's duration days), or `null` when none have a
score yet.

`accepts_joins` is true while the public join button should show.
Scheduled events stay joinable. An **active** event accepts new joins
only until **22:30 UTC on its first UTC day** (30 minutes before that
day's 23:00 final recording). At 22:30 and later that first day it is
false. Already-enrolled farms stay on the board.

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
      "status": "ended",
      "min_bumpkin_island": null,
      "min_digging_streak": null,
      "vip_required": false,
      "max_players": null,
      "join_mode": "confirm",
      "description": "",
      "prize_places": [],
      "nft_giveaway": false,
      "enrolled_count": 0
    },
    "entries": [],
    "count": 0,
    "leader_farm_id": null,
    "overall_average_per_day": null,
    "accepts_joins": false
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
    "score": 21.0,
    "score_first_op": 5.0,
    "score_second_op": 12.0,
    "digs_to_third_op": 42,
    "score_today": 20,
    "otter_count": 3,
    "status": "completed"
  }
}
```

### `POST /identify`

Resolve a visitor farm ID to the Sunflower Land username via sfl.world
`GET /api/v1/land/info/farm_id/{farm_id}`. The browser never calls
sfl.world. The resolved name is stored so admin can retrieve the farm ID
later (`GET /admin/identities`). Identify fails when sfl.world cannot
produce a username (new farms can lag 2–7 days).

```json
{ "farm_id": "3666918801844311" }
```

```json
{
  "farm_id": "3666918801844311",
  "name": "rmr",
  "nft_id": 220411,
  "identified_at": "2026-08-17T12:00:00+00:00"
}
```

`400` if `farm_id` is missing or not numeric. `404` if sfl.world has no
username for that farm.

### `GET /farms/{farm_id}/memberships`

Pending and enrolled join rows for that farm. Rejected requests are
deleted and do not appear. Empty list when the farm has never joined.
The public Join button uses this so a pending request stays hidden after
a reload or on another browser.

```json
{
  "memberships": [
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

`400` if `farm_id` is missing or not numeric.

### `POST /submissions`

Join request for one or more scheduled/live tournaments. Visitors have no
accounts; they send a numeric farm ID. The display name is the sfl.world
username from `POST /identify` when that farm has identified; the client
does not collect a typed display name. Already-tracked farms may still
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

Must-confirm (`join_mode: "confirm"`, the default when omitted) creates
`pending` rows. Auto-join (`join_mode: "auto"`) enrolls immediately:

```json
{
  "submissions": [
    {
      "farm_id": "3666918801844311",
      "name": "rmr",
      "tournament_id": "20260822T140000Z_7d",
      "status": "enrolled",
      "submitted_at": "2026-08-14T13:00:00+00:00",
      "approved_at": "2026-08-14T13:00:00+00:00"
    }
  ],
  "count": 1
}
```

`400` if no joinable `tournament_id` is sent, or if the event is
**active** and the clock is 22:30 UTC or later on that event's first
UTC day (`join closed after 22:30 UTC on the first day`). Scheduled
events stay joinable. When island, streak, or VIP gates are set, the
API fetches that one farm from the SFL Community API (server-side) and
writes island / digging streak / VIP onto the stored snapshot before
checking. That fetch does not score the farm. `400` `VALIDATION_ERROR`
if the farm's island is below `min_bumpkin_island` (`basic` < `spring`
< `desert` < `volcano+`), if digging streak is below
`min_digging_streak`, if `vip_required` is true and the farm is not
VIP (paid pass, unexpired `expiresAt`, 7-day trial, or Lifetime Farmer
Banner), if a set gate cannot be read after that fetch, or if enrolled
players already equal `max_players`. Every unmet island/streak/VIP gate
is listed in `message` (required value and the farm's stored value when
the snapshot has it). Unreadable snapshot fields name which gate could
not be read. Optional `details` repeats those gates:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "farm does not meet the join requirements: minimum bumpkin island desert (farm is spring); minimum digging streak 3 (farm is 1); VIP required (farm is not VIP)",
  "details": [
    {
      "gate": "min_bumpkin_island",
      "required": "desert",
      "farm": "spring",
      "readable": true
    },
    {
      "gate": "min_digging_streak",
      "required": 3,
      "farm": 1,
      "readable": true
    },
    {
      "gate": "vip_required",
      "required": true,
      "farm": false,
      "readable": true
    }
  ]
}
```

Pending joins do not occupy a cap slot. Admin force-add and approve are
not blocked by the public cap or island/streak/VIP gates. `409` if that
`(farm_id, tournament_id)` pair is already pending or enrolled.
Admin unenroll deletes that membership, so the farm may join again
while the event still accepts public registration (auto enrolls;
must-confirm goes pending until approve).
Approving tournament A does not enroll the farm in tournament B.
Already-enrolled farms are not dropped when the join window closes.

## Admin

All `/admin/*` routes require a Cognito ID token. `401` if the token is missing or invalid.

### `GET /admin/session`

```json
{ "ok": true }
```

### `GET /admin/identities`

Farms that identified on the public site. `name` is the sfl.world
username stored at identify time.

```json
{
  "identities": [
    {
      "farm_id": "3666918801844311",
      "name": "rmr",
      "nft_id": 220411,
      "identified_at": "2026-08-17T12:00:00+00:00"
    }
  ],
  "count": 1
}
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
asked for (`tournament_name`). The admin pending list shows that name
as a link to the public event page, not the tournament id.

```json
{
  "submissions": [
    {
      "farm_id": "3666918801844311",
      "name": "rmr",
      "tournament_id": "20260814T120000Z_7d",
      "tournament_name": "Week of 14 Aug",
      "tournament_status": "active",
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

### `GET /admin/slogans`

Same list shape as `GET /slogans`.

### `POST /admin/slogans`

Append one slogan. Empty storage is seeded first, then the new row is
added. `201`.

```json
{ "text": "Feed my chicken" }
```

```json
{
  "slogan": { "text": "Feed my chicken" },
  "slogans": [
    { "text": "Slap my pets" },
    { "text": "Grow my banana" },
    { "text": "Squeeze my orange" },
    { "text": "Clean my poop" },
    { "text": "Want some weed?" },
    { "text": "Erect my monument" },
    { "text": "Feed my chicken" }
  ],
  "count": 7,
  "today_text": null,
  "today_day": null
}
```

### `PUT /admin/slogans`

Replace the whole ordered list. `today_text` pins that line for the
current UTC day (`today_day` is stamped server-side). `today_text: null`
clears the pin. Omitting `today_text` keeps the existing pin when it
still matches a row. An empty list is allowed.

```json
{
  "slogans": [
    { "text": "Slap my pets" },
    { "text": "Grow my banana" }
  ],
  "today_text": "Grow my banana"
}
```

```json
{
  "slogans": [
    { "text": "Slap my pets" },
    { "text": "Grow my banana" }
  ],
  "count": 2,
  "today_text": "Grow my banana",
  "today_day": "2026-08-28"
}
```

### `PUT /admin/config`

Minimum duration is 1 day. Prefer `duration_days` (1, 7, or 30 are the
usual lengths); `end_at` is derived as `start_at + duration_days`.
`end_at` is still accepted. `prize_amount` is a JSON string: a numeric
Flower amount (UI shows `$Flower`) or free-text prize label.

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

Same list shape as `GET /tournaments`, including `featured_tournament_id`.

### `PUT /admin/featured`

Set the public home showcase to a scheduled, live (`active`), or ended
tournament. `tournament_id: null` (or omitted / empty) clears it.
Missing ids return `404`.

Featuring a scheduled event keeps that showcase id when the window
becomes live. Does **not** change `current_tournament_id` or FarmSync.

```json
{ "tournament_id": "20260814T120000Z_7d" }
```

```json
{ "featured_tournament_id": "20260814T120000Z_7d" }
```

### `POST /admin/tournaments`

Create a named event. `201` `{ "tournament": { … } }`. Windows may
overlap; several events can be `active` at once. Minimum 1 day. `name`
is required (1–80 chars). `end_at` or `duration_days` is required.

```json
{
  "name": "Late August Otter Cup",
  "start_at": "2026-08-23T00:00:00+00:00",
  "end_at": "2026-08-30T00:00:00+00:00",
  "prize_amount": "80",
  "min_bumpkin_island": "desert",
  "min_digging_streak": 3,
  "vip_required": true,
  "max_players": 32,
  "join_mode": "auto",
  "description": "Bring a shovel.",
  "nft_giveaway": false,
  "prize_places": [
    { "place": 1, "amount": "50" },
    { "place": 2, "amount": "20" },
    { "place": 3, "amount": "10" }
  ]
}
```

`start_at` and `end_at` are UTC calendar dates. Both days count:
August 23 through August 30 is `duration_days` 8, and scoring includes
those dates. The stored `end_at` is the exclusive midnight after the
final day (`2026-08-31T00:00:00+00:00`). Sending `duration_days` still
sets `end_at = start_at + duration_days` (same exclusive convention).

Omitted extras keep today's defaults: `min_bumpkin_island` /
`min_digging_streak` / `max_players` null (no gate), `vip_required`
false, `join_mode` `"confirm"` (pending until admin approve), empty
`description`, empty `prize_places`, `nft_giveaway` false. `prize_amount`
is a JSON string: a Flower number (`"80"`) or free text (`"3x Rare Key"`)
when the pool is not Flower. Flower-only `prize_places` amounts
must sum to a numeric `prize_amount` (`400` otherwise). When `nft_giveaway` is
true, each place may include `nft_name`, Flower amounts need not
sum, and `prize_amount` may be non-numeric text. `join_mode` is `auto` or `confirm`. `min_bumpkin_island` is
`basic`, `spring`, `desert`, or `volcano+`.

```json
{
  "tournament": {
    "tournament_id": "20260823T000000Z_8d",
    "name": "Late August Otter Cup",
    "start_at": "2026-08-23T00:00:00+00:00",
    "end_at": "2026-08-31T00:00:00+00:00",
    "duration_days": 8,
    "prize_amount": "80",
    "status": "scheduled",
    "archived_at": null,
    "min_bumpkin_island": "desert",
    "min_digging_streak": 3,
    "vip_required": true,
    "max_players": 32,
    "join_mode": "auto",
    "description": "Bring a shovel.",
    "nft_giveaway": false,
    "prize_places": [
      { "place": 1, "amount": "50" },
      { "place": 2, "amount": "20" },
      { "place": 3, "amount": "10" }
    ]
  }
}
```

A window that contains `now` becomes `active` even if another event is
already live. A future start is `scheduled`. `GET /config` and
`GET /leaderboard` follow the soonest-ending live event. Each live
event has its own board at `GET /tournaments/{id}`.

Optional home-page images: `image_1_url` (small card art) and
`image_2_url` (wide hero canvas). Public tournament list/detail
responses include them when set. URLs are served from
`GET /media/tournaments/{tournament_id}/{filename}` on the public API.

### `POST /admin/tournaments/{tournament_id}/images`

Upload a tournament home-page image. Admin JWT required. Body is JSON
with base64 image bytes (the browser talks only to this API). Max 2 MB.

```json
{
  "slot": "image_1",
  "content_type": "image/webp",
  "data": "UklGRg=="
}
```

`slot` is `image_1` (small) or `image_2` (wide). Allowed
`content_type`: `image/jpeg`, `image/png`, `image/webp`, `image/gif`.

```json
{
  "slot": "image_1",
  "key": "media/tournaments/20260823T000000Z_8d/image_1.webp",
  "public_url": "https://oacun88q99.execute-api.ap-southeast-1.amazonaws.com/dev/media/tournaments/20260823T000000Z_8d/image_1.webp"
}
```

Save `public_url` on the tournament via `PUT /admin/tournaments/{id}`.

### `GET /media/tournaments/{tournament_id}/{filename}`

Public binary image bytes for tournament home-page art. Example:
`/media/tournaments/20260823T000000Z_8d/image_2.png`. No auth.
Returns the stored object with a matching image `Content-Type` and
`Cache-Control: public, max-age=300`.

### `PUT /admin/tournaments/{tournament_id}`

Scheduled or live: name, `start_at`, `duration_days` (or inclusive
`end_at`), prize, and the same extra settings as create
(`min_bumpkin_island`, `min_digging_streak`, `vip_required`,
`max_players`, `join_mode`, `description`, `nft_giveaway`,
`prize_places`, `image_1_url`, `image_2_url`). Omitted keys keep the
stored values; send `null` /
`[]` to clear an optional gate, description, or prize list. Changing
the live window re-scores farms from snapshots. Ended: `409`.

### `DELETE /admin/tournaments/{tournament_id}`

Cancel a scheduled or live event. Ended → `409`. Deleting one live
event leaves the others. The featured window (`GET /config`) moves to
the soonest-ending remaining live event, or clears if none remain.

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

Unenroll from that tournament only. The global player row stays. The
farm may join again while the event still accepts public registration
(auto enrolls immediately; must-confirm goes pending until approve).

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
the HTTP handler does not wait for SFL. The worker continues itself when
the 15-minute window is almost up; that is not a second HTTP call.

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
