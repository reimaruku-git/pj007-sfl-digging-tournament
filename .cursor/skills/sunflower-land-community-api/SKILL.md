---
name: sunflower-land-community-api
description: >-
  Sunflower Land Community API (api.sunflower-land.com /community): x-api-key,
  per-IP 5s throttle, GET farm by id, deprecated POST getFarms batch, nightly
  dump. Use when changing FarmSync, sfl_client, identify/join SFL fetches,
  SFL_API_KEY, rate limits, or when the user mentions SFL community-docs,
  Otter Pebble grids, or speeding up farm fetches.
metadata:
  short-description: SFL Community API + throttle options
---

# Sunflower Land Community API

Live docs: [community-docs endpoints](https://sunflower-land.com/community-docs/#/endpoints)
(captured 2026-09-05 from the published bundle; GitHub `docs/OFFCHAIN_API.md` is stale).

This product talks to SFL **only from Lambda**. Never from the browser.
Do **not** invent a second batch shape. List farms is not a roster lookup.

## Hard facts (do not invent)

1. **Auth:** every `/community/*` call sends `x-api-key: sfl.…`. 401 if missing,
   invalid, or the key’s farm lost VIP / dropped below level 50.
2. **Throttle is per IP, not per key.** Roughly **one request / 5 seconds**
   per `/community` endpoint, **doubling to 10s** if you keep hammering.
   429 body is empty. Extra keys from the **same Lambda IP do not go faster**
   and can trip the 10s penalty. `POST /community/getFarms` **shares** the
   throttle with `GET /community/farms`.
3. **IDs:** path `id` on `GET /community/farms/{id}` is NFT id if the number
   is ≤ 1,000,000,000; a larger number is the **account / farm id** (what
   this tournament stores); `0x…` is a linked wallet (first farm).
4. **Arbitrary set of ids in one call:** only the **legacy**
   `POST /community/getFarms` `{ "ids": [ … ] }` (1–100). Docs say new code
   should use List farms or the nightly dump; List farms is **id-order pages**,
   not “these roster ids”.
5. **Whole dataset:** `GET /community/data?type=nightlyDump` (keyed manifest),
   then stream `https://community.sunflower-land.com/{filename}` — **no key,
   no throttle** on the file. Export ~22:00 UTC, keep 7 days, up to 24h stale.
   Desert grids **reset every UTC day**, so a dump cannot replace 14/16/18/20
   live scoring.
6. Logs here: `sfl.` + first 4 + last 4 of the token. Never print the key.

## This repo today

`backend/lib/tournament/sfl_client.py` uses the **first** secrets-bucket
key. Sweeps `POST /community/getFarms` (legacy batch, default 25 ids).
GET `/community/farms/{id}` is the fallback (also join, identify, admin
one-farm refresh). Success wait 5.5s; 429/403/5xx wait ≥10s. Extra keys
do not increase rate.

Identify uses sfl.world first, then one Community GET. Join gates also GET
one farm. Those share the same upstream IP bucket if they egress together.

## Read next

- Endpoint catalog, headers, response shapes: [community-api.md](community-api.md)
- Ways to make FarmSync faster **without coding yet**: [pj007-throttle-options.md](pj007-throttle-options.md)
