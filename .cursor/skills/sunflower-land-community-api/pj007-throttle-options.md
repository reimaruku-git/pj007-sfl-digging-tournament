# pj007 — make FarmSync faster (options only)

**No code in this note.** Operator picks; a later change implements one path.
Scoring rules, 23:00 finalize, and “browser never calls SFL” stay.

## Why two keys no longer help

Old model (removed `PooledSFLClient`): each key has its own bucket; rotate
two keys, wait 10s after a full pass → ~2 farms / 10s.

Current Community API: **one bucket per IP per endpoint**, ~**5s**, **10s if
you hammer**. Lambda FarmSync is one process, one egress IP (or a tiny NAT
set). Two keys on that IP are two requests in the **same** bucket. Firing
them back-to-back looks like hammering and can **slow** the sweep to 10s
per call instead of 5s.

GitHub `OFFCHAIN_API.md` (“batch every 15s”, no key) is not what
community-docs describes now.

Rough wall clock for a live roster of **N** farms (HTTP time ignored):

| Pattern | Requests | Wait if well-behaved |
|---------|----------|----------------------|
| Today: 1 GET / farm, 2 keys, 10s round | N | Worse than 5s/farm if the pool double-fires |
| 1 GET / farm, 1 key, ≥5s | N | ~5N seconds (100 farms ≈ 8–9 min) |
| Legacy POST 100 ids / 5s | ceil(N/100) | 100 farms ≈ **5s**; 400 ≈ 20s |
| Nightly dump | 1 keyed manifest + 1 CDN GET | Minutes of download, **0** farm GETs |

FarmSync is 15 minutes and already self-chunks. The bottleneck is SFL, not
Lambda CPU. Mid-day syncs (14/16/18/20) and 23:00 finalize all need **today’s**
grid. Identify/join GETs share the IP bucket if they egress with the sweep.

---

## Option A — Stop rotating keys (smallest change)

Keep `GET /community/farms/{id}`. Use **one** key. Wait **≥5s** (maybe 5.5–6s)
after every success. On 429 wait **≥10s** (or `Retry-After`). Do not issue a
second key’s GET from the same IP in the same 5s window.

- **Wins:** Stops self-inflicted 10s penalty; matches the published throttle.
- **Does not:** Change N requests. 200 farms still ~15–20 min + chunks.
- **Fits:** Immediate safety fix even if B/C come later.

## Option B — Legacy batch `POST /community/getFarms` (best speed / effort)

One POST, `{ "ids": [ … ] }`, up to **100** account ids (our `farm_id`s).
That is still **one** throttled request. Map the object-keyed `farms` back
onto roster rows; retry `skipped` in smaller batches (5.5 MB cap vs missing
farm). Keep single GET for admin one-farm refresh and for a 1-id skip.

- **Wins:** ~100× fewer SFL calls on a full sweep. A typical live roster
  finishes in **one or two 5s slots**, so 14/16/18/20/23 can finish inside
  one Lambda without continuation. Join/identify stay one GET.
- **Risks:** Docs mark it **deprecated**. They have not turned it off
  (“kept working”). 5.5 MB `skipped` is normal, not an error. Response
  shape is not `{ id, farm }`. Shared throttle with List farms — do not
  also page List farms in the same process.
- **Mitigation:** Feature-flag; fall back to Option A GET on 404/410/501;
  log the `warning` field; never send >100 ids.

This is the option that actually matches “we have a known set of farm IDs”.
List farms cannot do that (id-order pages of the whole game).

## Option C — Nightly dump, then live-fetch the rest (23:00 only)

`GET …/data?type=nightlyDump` → stream latest `active.jsonl.gz` from
`community.sunflower-land.com` (no key, no throttle). Pull today’s grid for
enrolled farms that appear in the file. Live GET (or Option B) only farms
**missing** from the dump or still without a 3rd OP.

- **Wins:** CDN is the path SFL wants for bulk. Huge cut in keyed requests
  at 23:00 if most of the roster has already saved by ~22:00.
- **Does not replace 14/16/18/20:** dump is previous night relative to
  those clocks; the desert grid **reset at 00:00 UTC**.
- **23:00 caveats:** export is ~**22:00 UTC**. Digs between dump and 23:00
  are missing. Finalize still needs a live pass for incompletes and anyone
  who saved after `modifiedAt`. Stream; do not load 780 MB into memory.
  Line shape uses `nftId` / `id` — match on account `id` (our farm_id).
- **Fits as a complement to B**, not a substitute for mid-day.

## Option D — List farms pagination

`GET /community/farms?limit=500` + cursor. One page = one request = hundreds
of farms, but **not our roster**: you walk the game until you happen to see
our ids, or you walk everything.

- **Wins:** Official, not deprecated.
- **Loses:** Hours / thousands of requests for a full walk (docs say don’t).
  Sparse tournament roster makes this the worst fit.
- **Skip** unless we ever need “every farm in the game”.

## Option E — Ask Thought Farm for a supported bulk-by-ids

Discord `#devs-chat` / community-docs maintainers: a non-deprecated
`ids` lookup (or a higher per-IP cap for VIP tooling keys).

- **Wins:** We would not be on a deprecated POST.
- **Loses:** Calendar, not engineering. Do this **in parallel** with A/B,
  not instead of a sweep that already 429s.

## Option F — More IPs (usually don’t)

Two Lambdas in two NATs, or VPC ENIs in different subnets, so two 5s
buckets. Technically works because the limit is per IP.

- **Wins:** Linear with IP count if we also split the roster.
- **Loses:** Cost, IAM/VPC in **this product’s stack only**, and it is
  clearly **working around** a published fair-use throttle. Keys can be
  revoked. FarmSync is deliberately single-flight today so keys (now: the
  IP) never overlap. Treat as last resort, not the plan.

Do **not** point the browser at SFL, and do not scrape the game session API
(`Authorization: Bearer` player JWT). That is a different surface and is
not allowed here.

## Option G — Product-side fewer fetches (already partly true)

Keep / tighten:

- Skip farms that already have **today’s numeric 3rd-OP** (already in
  FarmSync).
- After a GET/POST, honor `updatedAt`: if unchanged, do not rewrite the day
  file (saves Dynamo/S3, **not** SFL calls).
- Do not overlap Main identify/join retries with a sweep on the same egress
  (or give Main a short timeout and **no** 12s retry loop — already partly
  true for HTTP). A join that 429s should fail fast under API Gateway’s 30s
  cap rather than steal the sweep’s slot for 10s×N.
- Admin one-farm refresh can stay a single GET.

These are hygiene. They do not make a 200-farm incomplete board fast.

---

## What will not help

| Idea | Why |
|------|-----|
| Add `SFL_API_KEY_3` in the JSON | Same IP, same 5s bucket |
| Parallel `fetch_farm` in one Lambda | Hammer → 10s penalty (or 429 storm) |
| Overlapping FarmSync chunks | Same, and 23:00 finalize must stay last-chunk-only |
| sfl.world for grids | Land-info is names/levels, daily-ish, not the live desert grid |
| Nightly dump at 16:00 UTC | Yesterday’s grid after the UTC reset |
| Lower `limit` on List farms | We are not listing; we have ids |
| HTTP/2, keep-alive, bigger Lambda | Throttle is time between requests |

---

## Suggested sequence (implemented: A + B)

1. **A** — one key, ~5.5s success gap, 10s on 429. Extra keys ignored.
2. **B** — sweep via `POST /community/getFarms`; GET for refresh / fallback
   when the POST is gone (404/405/410/501) or an id stays skipped.
3. Optionally **C** only on the 23:00 path, after B is proven.
4. **E** in the background so B is not a forever dependency.
5. **F** only if B is removed upstream and E has no date.

Identify can stay sfl.world-then-one-GET; it is one farm. Do not batch
identify. Join stays one farm.

## Open questions before implementing B

- Typical live enrolled count (dev vs prd) — confirms 1 vs 2 POSTs.
- Whether current keys still pass VIP+50 (401 is not a throttle problem).
- Whether FarmSync and Main share a NAT today (join during a sweep).
- How small to start the batch (e.g. 25) before climbing toward 100, given
  5.5 MB and large `farm` objects (desert grid included).
