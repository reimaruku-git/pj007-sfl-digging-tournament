# SFL Community API reference

Source: https://sunflower-land.com/community-docs/#/endpoints  
Captured: 2026-09-05 (docs site last-modified 2026-08-31).  
Stale: GitHub `sunflower-land/docs/OFFCHAIN_API.md` (15s interval, no key, no dump).

Base URLs:

| Env | Host |
|-----|------|
| Mainnet | `https://api.sunflower-land.com` |
| Testnet | `https://api-dev.sunflower-land.com` |
| Nightly files | `https://community.sunflower-land.com/{filename}` |

Keys are per environment. Header on every `/community` request:

```
x-api-key: sfl.…
```

HTTP header names are case-insensitive (`X-Api-Key` is the same). Issue a key
from the community-docs **sidebar while logged into the game**. Requirements:
**VIP + Bumpkin level 50+**, checked on issue **and** on every request. Lapsed
VIP → 401 on the same key; renew VIP and it works again. Rotate in the sidebar
if leaked (old key dies immediately). Treat like a password; never ship in
frontend.

401 example:

```json
{ "error": "API key is required - get one at https://sunflower-land.com/community-docs (requires VIP and level 50+)" }
```

## Rate limits

Each `/community` endpoint is throttled **per caller IP**:

- ~**1 request every 5 seconds**
- **Doubles to 10 seconds** if you keep pushing
- 429, **empty body** — wait and retry; do not tight-loop

`POST /community/getFarms` shares the bucket with `GET /community/farms`.
Two API keys from one IP do **not** buy two slots.

CDN dumps are **not** throttled. The dump **manifest** is a normal community
route (throttled). Fetch the manifest once per run.

## Farm object

Visit-prepared game state (inventory, bumpkin, island, desert digging grid,
etc.). This tournament scores `farm.desert.digging.grid`. Bodies are large;
stream or raise client limits.

---

## Farm endpoints

### GET `/community/farms` — List farms

Page every farm, **internal id order**. Not a roster lookup.

| Query | |
|-------|--|
| `limit` | 1–1000, default 100. ~500 is a practical ceiling. |
| `cursor` | previous `next_cursor`; omit on first page |

200:

```json
{
  "farms": [
    { "id": 121500, "nft_id": 29411, "farm": { } }
  ],
  "next_cursor": "eyJpZCI6MTIxNTAxfQ"
}
```

Last page has no `next_cursor`. Not a stable snapshot (saves continue). A full
walk at 5s/request is hours — use the nightly dump for “all farms”.

Errors: 401, 429.

### POST `/community/getFarms` — Get farms by id (**legacy**)

**Only** official way to fetch an **arbitrary set of ids in one call**.
Deprecated: “kept working”; docs prefer List farms (slices) or nightly dump
(whole set). 100-id cap; List farms / dump do not have that cap.

Body:

```json
{ "ids": [121500, 3666918801844311] }
```

1–100 numbers. Empty body / no `ids` → behaves like List farms (`limit` /
`cursor`); do not call it that way.

200 (ids mode) — **different shape** from List/Get:

```json
{
  "farms": {
    "121500": { "balance": "…", "inventory": {}, "isBlacklisted": false, "updatedAt": "2026-08-27T21:14:03.221Z" }
  },
  "skipped": [999999999],
  "warning": "This endpoint is deprecated. Please use pagination"
}
```

- `farms` is an **object keyed by id**, values are the farm object itself
  (not `{ id, farm }`).
- `skipped`: farm does not exist **or** dropped by the **5.5 MB** cap.
  Retry skipped ids in a smaller batch. One id still skipped → does not exist.
- `warning` is informational.

Throttle **shared with List farms**. Malformed body (empty array, >100, non-numeric) → 500 before read. 401, 429.

### GET `/community/farms/{id}` — Get a farm

One farm. Path `id`:

| Value | Resolved as |
|-------|-------------|
| Number ≤ 1,000,000,000 | NFT id |
| Larger number | Account / farm id (pj007 `farm_id`) |
| `0x…` | Linked wallet (first farm) |

200:

```json
{
  "id": 121500,
  "nft_id": 29411,
  "nftId": 29411,
  "farm": { },
  "isBlacklisted": false,
  "updatedAt": "2026-08-25T03:12:44.000Z"
}
```

`updatedAt` is last **real save**. Store it and skip *processing* when unchanged
(the GET already happened). `nftId` duplicates `nft_id`. 404 empty body if
unknown. 401, 429.

This is what `sfl_client.RateLimitedSFLClient.fetch_farm` calls today.

---

## Nightly dump

### GET `/community/data?type=nightlyDump`

Manifest of published files (keyed). Then download:

`https://community.sunflower-land.com/{filename}`

No key, no rate limit on the file.

Paths: `{YYYY-MM-DD}/all.jsonl.gz` and `{YYYY-MM-DD}/active.jsonl.gz`. Last
**7 days** only. Export ~**22:00 UTC**. `active` = played in last 90 days
(~⅓ size, usually what you want). Sizes on the order of ~780 MB gzipped
(active) / ~2 GB (all) — **stream line by line**, never buffer the file.

Each line:

```json
{ "id": 206379, "nftId": 206379, "farm": { }, "isBlacklisted": false, "lastActivity": 1756072800000 }
```

Field drift vs live API: `nftId` not `nft_id`; `lastActivity` ms epoch;
`isBlacklisted` may be absent; chapter tickets stripped.

Dump is up to **24h stale**. Desert grid resets **each UTC day** — a 22:00
file is still *that* UTC day’s grid as of ~22:00, not useful for 14:00 the
next day.

---

## Other `/community/data` types (not used by pj007 scoring)

All keyed, same `x-api-key` + per-IP 5s throttle.

| `type` | Role |
|--------|------|
| `auctions` | Auctioneer calendar |
| `auctionResults` | One auction leaderboard (`auctionId`) |
| `marketplaceActivity` | Daily FLOWER volume + floors (`date` optional) |
| `tradeable` | One item book (`collection`, `id`) |
| `marketplaceProfile` | One farm’s trades (`farmId`) |
| `ticketLeaderboard` | Chapter tickets (`farmId`, `limit`) |
| `discordAnnouncements` | Last 20 official Discord posts |
| `raffles` | Raffle calendar |
| `raffleResults` | One raffle (`id`) |

---

## pj007 mapping

| Our need | Upstream |
|----------|----------|
| Score desert grid | Farm object → `farm.desert.digging.grid` |
| Island / streak / VIP gates | Same farm object (Main Lambda join fetch) |
| Name + nft_id | Community GET, or sfl.world land-info (identify fallback) |
| Live roster of N farms | Legacy POST `getFarms` **or** N× GET one farm |
| Yesterday-complete snapshot | Nightly `active.jsonl.gz` |
| Browser | Must not call any of this |
