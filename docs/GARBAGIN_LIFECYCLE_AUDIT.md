# Garbagin marketplace lifecycle audit

**Date:** 2026-09-12  
**Scope:** Read-only comparison of vault canon vs shipped SQL / Edge / client.  
**Repo:** Clean Egypt / garbagin-marketplace (`main` at audit start: `e8bb1a1`).  
**This PR does not change product behavior.**

How to read this note:

| Label | Meaning |
| --- | --- |
| **Confirmed bug** | Code contradicts a shipped product rule, or a user flow is broken. Each claim cites a function / file. |
| **Doc-only TODO** | Vault describes a target that was never implemented. Not a regression — a missing feature. |
| **Stale doc** | Vault still describes a gap that later migrations already closed. |
| **Working as designed** | Code matches `.cursorrules` / later migrations even if an older roadmap checkbox is still open. |

The 2026-08-26 snapshot in [`04_Roadmap_Tasks/Garbage_History_Lifecycle.md`](../04_Roadmap_Tasks/Garbage_History_Lifecycle.md) §8 is still useful, but it is **one day older than** `20260826_status_changed_at_approved_reviews.sql`. Several of its rows are now stale. This audit re-reads the latest RPC bodies, not that table.

---

## A) Intended lifecycle (teacher version)

Two worlds share the `missions` table. Do not mix their money rules.

```
WORLD 1 — P2P (home / office / non-crowd city jobs)
  Token pin  →  available  →  accept bid  →  in_progress
       →  proof (GPS ≤200m)  →  review  →  creator confirms  →  completed
  No platform fiat escrow. Worker and client settle off-app.

WORLD 2 — Garbage Removal civic / crowdfund
  Free pin (reported, $0, 7 days)
       ├─ nobody donates ──────────────► hide / delete
       │                                 NO Gov Notice, NO n8n
       └─ first real Stripe dollar ────► funding (crowdfunding_mode=true)
                                              rolling +30d per payment
            ├─ target met, no cleaner ─► available (open tender)
            ├─ target met, cleaner locked ─► in_progress (skip re-bid)
            └─ timer ends AND 0 < raised < target
                   ► expired  →  Gov Notice PDF
                   ► n8n social campaign
                   ► public “Garbage History” 7 days
                   ► then R2 purge + archive
```

**Hungry-Games overlay (both worlds):** 1 token per *new* bid; creator phone stays locked until a bid is accepted. Crowdfunding pins never expose a client phone.

**Funding overlay:** a creator *may* accept a worker while status is still `funding`. If the accepted price is higher than the pot, `expected_price` rises and the pin stays `funding` until donations catch up. Feed/map must keep showing `funding` even when `cleaner_id` is set, with the violet “Cleaner locked in! Needs $X more” callout.

Canon sources: [`.cursorrules`](../.cursorrules), [`04_Roadmap_Tasks/Garbage_History_Lifecycle.md`](../04_Roadmap_Tasks/Garbage_History_Lifecycle.md), [`01_Architecture/P2P_Deal_Flow.md`](../01_Architecture/P2P_Deal_Flow.md), [`01_Architecture/Stripe_USD_Flow.md`](../01_Architecture/Stripe_USD_Flow.md).

---

## B) What the code actually does today

Latest function bodies win. Migrations replace RPCs in place.

### B.1 Status vocabulary in production

| Status | Who writes it | Meaning in code |
| --- | --- | --- |
| `reported` | `create_garbage_zone_report` | Free civic pin. `is_report=true`, `crowdfunding_mode=false`, budgets 0. |
| `funding` | `create_lead_mission_with_token` (crowd), `convert_report_to_mission`, stays after `accept_mission_bid` if still underfunded | Accepts Stripe money + crowd bids. |
| `available` / `pending` / `open` | lead create (P2P), convert (direct mode), or `apply_stripe_contribution` when target met and no cleaner | Open tender. |
| `in_progress` | `accept_mission_bid` (funded or P2P) or `apply_stripe_contribution` when cleaner already locked | Assigned work. |
| `review` / `pending_approval` | `submit_mission_proof` for **P2P only** | Creator confirm / reject. |
| `awaiting_approval` | `submit_mission_proof` for **crowdfunding** | Donor video vote. |
| `approved` | `process_proof_vote` (yes) or `auto_approve_escrow_proofs` (24h) | Crowd success terminal. |
| `failed` | `process_proof_vote` (no) | Crowd reject terminal. **No retry RPC.** |
| `completed` / `finished` | P2P confirm / `process_stuck_reviews` | P2P success terminal. |
| `expired` | `process_expired_crowdfunding_missions` | Underfunded crowd after timer. |
| `hidden` / `archived` | — | **Do not exist** as statuses, columns, or filters. |

### B.2 Free civic pin

**Create:** client `createGarbageZoneReport` ([`src/lib/garbageZoneReport.ts`](../src/lib/garbageZoneReport.ts)) uploads R2 `reports/` then calls RPC `create_garbage_zone_report` ([`supabase/migrations/20260826_video_proof_url_and_starter_tokens.sql`](../supabase/migrations/20260826_video_proof_url_and_starter_tokens.sql)).

Inserted row:

- `status='reported'`, `is_report=true`, `crowdfunding_mode=false`
- `expected_price=0`, `current_funding=0`, `amount_target=0`
- **`crowdfunding_expires_at` is not set**
- no token debit

Trigger `trg_missions_crowdfunding_default_expiry` only fills expiry when `crowdfunding_mode=true` ([`20260722_dynamic_crowdfunding_timers.sql`](../supabase/migrations/20260722_dynamic_crowdfunding_timers.sql)). Reports therefore have **no 7-day clock**.

**No hide/delete sweep** exists for `status='reported'`. Nothing in `process_expired_crowdfunding_missions` selects reports.

### B.3 Manual convert (the only on-ramp from report → campaign)

RPC `convert_report_to_mission` ([`20260909_min_work_budget_2_usd.sql`](../supabase/migrations/20260909_min_work_budget_2_usd.sql)):

- any authenticated user (not just the reporter)
- requires `is_report=true` and `status='reported'`
- target ≥ **$2** (was $5; `CITY_MIN_PRICE` in [`constants.ts`](../constants.ts) is 2)
- crowd path: `is_report=false`, `crowdfunding_mode=true`, `status='funding'`, `crowdfunding_expires_at = now()+7d`, **funding stays 0**
- direct path: `status='available'`, no token pin fee

UI: Mission Briefing “Launch Crowdfunding / Set bounty” ([`components/MissionBriefing.tsx`](../components/MissionBriefing.tsx) `submitReportConversion`). Any signed-in viewer sees the button.

### B.4 Stripe money

```
Briefing → startContributionCheckout (src/lib/contributions.ts)
        → Edge stripe-contribution-checkout
        → Stripe Checkout
        → stripe-contribution-confirm  AND  stripe-webhook
        → service_role apply_stripe_contribution
```

Latest `apply_stripe_contribution` ([`20260724_restore_crowdfunding_contribution_timer_bump.sql`](../supabase/migrations/20260724_restore_crowdfunding_contribution_timer_bump.sql)):

1. Idempotent on `stripe_checkout_session_id`.
2. Requires `crowdfunding_mode`, garbage service, **`status = 'funding'`**, unexpired window, `expected_price ≥ 1`, room left in the pot.
3. Rejects oversubscription (does not silently clip).
4. Credits `current_funding`, then `GREATEST(expires, now()+30d)`.
5. If pot full: `in_progress` when `cleaner_id` set, else `available`.

Checkout Edge ([`supabase/functions/stripe-contribution-checkout/index.ts`](../supabase/functions/stripe-contribution-checkout/index.ts)) repeats the same gates **and** rejects the mission creator. A `reported` pin fails at step 2 (`crowdfunding_mode` is false **and** status is not `funding`).

Client `contributeToMission` is a hard throw — direct `contribute_to_mission` is revoked.

### B.5 Expiry sweep + Gov Notice

Latest `process_expired_crowdfunding_missions` ([`20260722_stabilize_crowdfunding_proof_concurrency.sql`](../supabase/migrations/20260722_stabilize_crowdfunding_proof_concurrency.sql)):

```
crowdfunding_mode = true
status = funding
(expected_price < 1  OR  current_funding < expected_price)
COALESCE(crowdfunding_expires_at, created_at+7d) < now()
FOR UPDATE SKIP LOCKED
```

Then: `status='expired'` + `INSERT city_notification_events (event_type='crowdfunding_expired')`.

**It does not check `current_funding > 0`.** A converted or lead-created campaign that raised **$0** is treated exactly like a partially funded fail.

pg_cron (when the extension exists) is scheduled in [`20260720_crowdfunding_expiry_cron.sql`](../supabase/migrations/20260720_crowdfunding_expiry_cron.sql). Vercel stub [`api/process-expired-crowdfunding.ts`](../api/process-expired-crowdfunding.ts) is a **placeholder** (logs a sample PDF, does not call the RPC).

INSERT on `city_notification_events` fires `trg_city_notification_call_pipeline` → pg_net → Edge `city-notification-pipeline` ([`supabase/functions/city-notification-pipeline/index.ts`](../supabase/functions/city-notification-pipeline/index.ts)): pdf-lib A4 → R2 `city-pdfs/{missionId}/{eventId}.pdf` → Telegram → optional Resend. Photos/video are **not** embedded. No n8n POST. No `history_public_until` write.

Success PDF: trigger `enqueue_crowdfunding_completion_notification` **does** fire on `completed` **or** `approved` ([`20260826_status_changed_at_approved_reviews.sql`](../supabase/migrations/20260826_status_changed_at_approved_reviews.sql)). Helper comment in [`src/lib/cityNotification.ts`](../src/lib/cityNotification.ts) already documents both.

### B.6 Bids + tokens

Latest `place_mission_bid` ([`20260826_place_mission_bid_always_one_token.sql`](../supabase/migrations/20260826_place_mission_bid_always_one_token.sql)):

- Crowd: statuses `funding` / `available` / `pending`; rejects expired funding window.
- P2P: `available` / `pending` only. **`reported` is not biddable.**
- Blocks creator self-bid and any row that already has `cleaner_id`.
- **Every new bid costs 1 token** (P2P and crowd). Updating an existing pending bid is free.
- No subscription check. No KYC check.
- Token is not refunded on reject / expiry / failed proof.

Latest `accept_mission_bid` ([`20260726_tiered_bid_packages.sql`](../supabase/migrations/20260726_tiered_bid_packages.sql)):

- Creator only; pending bid; statuses `available` / `pending` / `open` / **`funding`**.
- Home/office: worker must be `profiles.is_verified` (KYC at accept, not at bid).
- If `funding` and `raised < accepted_price`: stay `funding`, set `cleaner_id`, set `expected_price` / `amount_target` to the accepted price (can raise **or lower** the goal).
- Else: `in_progress` + `started_at`.

Client: [`src/lib/missionBids.ts`](../src/lib/missionBids.ts). Map Briefing enables bid on P2P open statuses **or** live unexpired funding ([`components/MapPicker.tsx`](../components/MapPicker.tsx) `canPlaceBid` / `OPEN_BID_MISSION_STATUSES`).

Starter balance: new profiles get 50 tokens ([`20260826_video_proof_url_and_starter_tokens.sql`](../supabase/migrations/20260826_video_proof_url_and_starter_tokens.sql)).

### B.7 Proof + close

| Path | RPC | Next status |
| --- | --- | --- |
| P2P proof | `submit_mission_proof` ([`20260825_fix_submit_mission_proof_geography.sql`](../supabase/migrations/20260825_fix_submit_mission_proof_geography.sql)) | `review` (photos required, GPS ≤200m) |
| Crowd proof | same RPC | `awaiting_approval` (**video** required) |
| P2P reject | `creator_reject_proof` ([`20260720_proof_of_work_lifecycle_security.sql`](../supabase/migrations/20260720_proof_of_work_lifecycle_security.sql)) | `in_progress` — **only from `review` / `pending_approval`** |
| Crowd vote | `process_proof_vote` ([`20260817_crowdfunding_escrow_proof_votes.sql`](../supabase/migrations/20260817_crowdfunding_escrow_proof_votes.sql)) | **first donor vote wins** → `approved` or `failed` |
| Crowd idle 24h | `auto_approve_escrow_proofs` | `approved` |
| P2P review idle 3d | `process_stuck_reviews` | `completed` — **explicitly skips** `crowdfunding_mode` |
| `in_progress` idle 24h | `process_abandoned_missions` ([`20260826_status_changed_at_approved_reviews.sql`](../supabase/migrations/20260826_status_changed_at_approved_reviews.sql)) | `available`, clears cleaner — **does not skip crowdfunding** |

P2P “work done” UI calls `confirm_mission_work_done` ([`components/Profile.tsx`](../components/Profile.tsx) `handleConfirmWorkDone`). That RPC is **only defined in archived** [`supabase/migrations/archive/20260614_confirm_mission_direct_payment.sql`](../supabase/migrations/archive/20260614_confirm_mission_direct_payment.sql) + alias in `archive/20260615_admin_delete_mission.sql`. Active `supabase/migrations/*.sql` never recreate it. Hosted DBs that ran the old files still have it; a greenfield apply of the active tree will not.

Phone lock: `get_mission_client_phone` always returns NULL when `crowdfunding_mode` ([`20260723_hide_client_phone_until_bid_accept.sql`](../supabase/migrations/20260723_hide_client_phone_until_bid_accept.sql)).

### B.8 Map + Live Market visibility

**Live Market** [`components/LiveMarketFeed.tsx`](../components/LiveMarketFeed.tsx) `ACTIVE_MARKET_STATUSES`:

`pending`, `available`, `open`, `funding`, `in_progress`, `reported`.

`isPublicMarketMission`: `reported` / `funding` / `in_progress` always (funding-with-cleaner is correct). Other listed statuses only if `cleaner_id` is null. **Not listed:** `expired`, `approved`, `completed`, `failed`, `review`, `awaiting_approval`.

Violet callout uses `crowdfundingFeedCallout` ([`src/lib/crowdfunding.ts`](../src/lib/crowdfunding.ts)) — matches `.cursorrules`.

**Map fetch** [`components/MapPicker.tsx`](../components/MapPicker.tsx) (~2535): same live set **plus** `review` / `pending_approval` / `awaiting_approval`. **Does not fetch** `expired`, `approved`, `completed`, `failed`.

`missionEligibleForMapPin` has a 24h window for `completed`, but it keys off **`created_at`** and the fetch never loads `completed` — so that branch is dead. `approved` is not in the eligibility list.

Free-report mute: [`src/lib/showFreeReports.ts`](../src/lib/showFreeReports.ts) (`filterMissionsByFreeReports`). Default ON.

Profile marketplace query is narrower (`available` / `funding` / `pending` / `reported` only) — no `in_progress`.

Worker “active jobs” query omits `approved` and `failed`. History query is only `completed` / `finished`.

### B.9 What is implemented and matches canon

- Rolling +30d under `FOR UPDATE` in `apply_stripe_contribution`.
- Stripe-only contribute; client RPC locked.
- Bid-during-funding + stay-in-funding when pot < accepted price.
- Funding pins remain on Live Market with locked-cleaner callout.
- 1 token / new bid, Hungry-Games phone lock, crowd phone always NULL.
- No Stripe refunds on expiry.
- Gov Notice PDF + Telegram path exists (operational, not municipal filing).
- Success PDF enqueue on **both** `completed` and `approved` (since 2026-08-26).
- Crowd proof isolated from P2P 3-day auto-complete.
- Idempotent Stripe session id.

---

## C) Confirmed bugs / gaps (ranked)

### P0 — money or municipal false-positive

#### P0-1. $0 funding campaigns fire Gov Notice

**Hypothesis 1 (partial).** Reported pins are **not** swept. Converted / lead-created **funding** campaigns with `$0 raised` **are**.

`process_expired_crowdfunding_missions` inserts `crowdfunding_expired` whenever `current_funding < expected_price`, including `raised = 0`. Canon: eco-ultimatum only when `0 < raised < target`; `$0` = hide, no PDF.

**Repro**

1. Sign in. Open a `reported` pin → Launch Crowdfunding, target `$20`. Do not donate.
2. Wait until `crowdfunding_expires_at` (or set it in SQL to `now()-1s`).
3. `SELECT process_expired_crowdfunding_missions();`
4. Row is `expired`; `city_notification_events` has `raised: 0`. Pipeline will build an “escalation” PDF for a campaign that never took a dollar.

Same for `create_lead_mission_with_token(..., p_crowdfunding_mode := true)` if nobody donates in 7 days.

**Not a bug:** a never-converted `reported` pin does **not** enter this sweep (`crowdfunding_mode` is false).

#### P0-2. First dollar cannot wake a reported pin

**Hypothesis 2 — confirmed.**

`stripe-contribution-checkout` requires `crowdfunding_mode` and `status='funding'`. `apply_stripe_contribution` raises `This mission is direct-payment only` / `Mission is not accepting contributions` on `reported`.

There is no atomic `reported → funding` inside apply. `convert_report_to_mission` is a **separate, unpaid** click.

**Repro**

1. Create a garbage-zone report (free pin).
2. As another user, try Contribute in Briefing — Contribute UI is hidden (`isCrowdfundingOpen` is false).
3. Call checkout Edge with that `mission_id` → `400 Mission is not in crowdfunding mode`.
4. Convert without paying → campaign is live at $0 and the 7-day Gov-Notice clock starts (feeds P0-1).

Canon wants: first successful Stripe payment *is* the convert.

#### P0-3. Stripe charged, contribution rejected (overfund race)

Checkout allows two users to open sessions for the last $N. `apply_stripe_contribution` correctly rejects the loser (`Contribution exceeds remaining budget`). `stripe-webhook` then **HTTP 200**s permanent business rejects so Stripe does not retry ([`supabase/functions/stripe-webhook/index.ts`](../supabase/functions/stripe-webhook/index.ts) ~178–213). Comment: “Money may need manual refund ops.”

No automated `Stripe.refunds.create`. Donor paid; mission was not credited.

**Repro:** two Checkouts for the last $5; complete both. One contribution row; one paid Session with `applied: false`.

### P1 — broken user flows after money moves

#### P1-1. Crowd `failed` is a dead end

`process_proof_vote(..., false)` writes `status='failed'`. `submit_mission_proof` requires `in_progress`. `creator_reject_proof` only matches `review` / `pending_approval`. No remediations, no refund, no Gov Notice, no success PDF.

**Repro:** fund a campaign, assign cleaner, submit video, any **one** donor votes no. Pin is stuck `failed`. Cleaner cannot re-upload.

This is worse because the vote is **first-vote-wins**, not a majority (`process_proof_vote` `SELECT … LIMIT 1` then decides). A $1 donor can kill a $200 job.

#### P1-2. `process_abandoned_missions` re-tenders funded crowd jobs

24h after entering `in_progress`, **including** `crowdfunding_mode=true`, the sweep sets `available` and clears `cleaner_id`. Donors already paid. Canon “skip re-bidding once funded + locked” is undone without a donor notification (`trg_notify_mission_funding_events` only handles `funding → available|in_progress`, not abandon / expire).

**Repro:** fully funded crowd job with locked cleaner; do not submit proof for 25h; run `process_abandoned_missions()`. Status `available`, pot still full, Stripe contribute rejected (not `funding`).

#### P1-3. Success PDF on `approved` — **not a current bug**

**Hypothesis 3 — discarded.** [`20260826_status_changed_at_approved_reviews.sql`](../supabase/migrations/20260826_status_changed_at_approved_reviews.sql) rewrote `enqueue_crowdfunding_completion_notification` to enqueue `mission_completed` when status becomes `completed` **or** `approved`, with a duplicate-event guard. [`Garbage_History_Lifecycle.md`](../04_Roadmap_Tasks/Garbage_History_Lifecycle.md) §8 is stale on this row.

Residual: `failed` never gets a PDF (see P1-1). Pipeline still does not attach before/after photos.

#### P1-4. Convert is an unpaid hijack + token-fee bypass

Any authenticated user can convert any open report and set the USD target. `creator_id` stays the reporter; the converter pays **0 tokens**. Direct-mode convert opens `available` without `create_lead_mission_with_token`’s pin debit.

**Repro:** user A drops a free pin. User B launches crowdfunding at $2 (or $10,000). A’s pin is now a live campaign B priced. After 7 days with $0, P0-1 fires on A’s coordinates.

### P2 — visibility / history / ranking

#### P2-1. No Garbage History window, purge, or n8n

**Hypothesis 4 — confirmed as missing product, not a silent mis-fire.**

Repo-wide search: **zero** matches for `history_public_until`, `media_purged_at`, `n8n_eco`. Statuses `hidden` / `archived` are unused. Expired pins persist forever in Postgres with media left on R2.

`expired` is omitted from Live Market and map fetches, so the public “7-day history” never appears. Deep-link `?mission=&history=1` is not implemented.

#### P2-2. Map / feed rules vs canon

**Hypothesis 5.**

| Status | Canon | Live Market | Map |
| --- | --- | --- | --- |
| `funding` (+ cleaner) | Always show + violet callout | **Yes** | **Yes** |
| `reported` | Show until hide sweep | Yes (mute-able) | Yes |
| `expired` during history 7d | Show as Garbage History | **No** | **No** |
| `archived` / `hidden` | Hide | N/A (statuses missing) | N/A |
| `approved` / `completed` | Success, not eco-history | Hidden | Not fetched (`completed` 24h filter is dead) |
| `in_progress` | Not required on Service Market | Shown always | Shown |
| `awaiting_approval` | Work, not market | Hidden | Shown |

#### P2-3. `amount_target` overwritten with USD (rank pollution)

`amount_target` is the **token-boost / listing rank** column (`missionTokenBid` in [`src/lib/missionBudget.ts`](../src/lib/missionBudget.ts); map `.order('amount_target', { ascending: false })`).

`create_lead_mission_with_token` stores the token pin (usually 1) there.

`convert_report_to_mission` and `accept_mission_bid` set `amount_target =` the **USD** target / bid. A $50 convert outranks every honest 1-token pin.

**Repro:** convert a report at $50; reload map. That pin sorts above older 1-token leads.

#### P2-4. Profile lists drop crowd success / failure

Worker active query: `in_progress, review, pending_approval, awaiting_approval, completed, finished` — **no `approved`**.  
History: `completed, finished` only.  
A donor-approved crowd job vanishes from the worker’s Orders and History.

### P3 — gates and docs that lie

#### P3-1. Bid-during-funding works; a few edges remain

**Hypothesis 6.** Core accept-during-funding state machine matches `.cursorrules`. Edges:

- Token burned if the campaign later expires or the bid is rejected (Hungry-Games — likely intended; confirm in UX copy).
- Cannot place a second worker bid after `cleaner_id` is set (correct).
- Accepting a **lower** bid shrinks `expected_price`; if `raised >= new price`, jumps to `in_progress` immediately (correct math; donors who overshot are not notified).
- Subscription: Roadmap Phase 3 wants an active sub to bid. RPC does **not** check `subscription_expires_at`. Briefing only shows a “Subscribe to unlock” phone teaser (`workerHasActiveSubscription`) — not a bid blocker. Treat as **doc-only TODO**, not a code regression vs `.cursorrules`.
- KYC: home/office checked only on **accept**. Worker can spend 1 token, then be rejected for unverified ID.

#### P3-2. Soft-expired UI vs hourly sweep

Between `crowdfunding_expires_at` and the next cron tick, status stays `funding`. Checkout / apply / place / accept all reject on the timestamp. Briefing disables Contribute when the countdown is expired. Users see a live-looking pin that refuses money until the sweep flips it to `expired` (and then it disappears from the feed). Awkward, not a double-credit bug.

#### P3-3. P2P confirm RPC missing from the active migration tree

See B.7. Profile still calls `confirm_mission_work_done`. If the hosted function exists, P2P close works. A new environment built only from `supabase/migrations/*.sql` will not have it. `process_stuck_reviews` is the only guaranteed P2P close in the active tree (3-day idle).

#### P3-4. Creator DELETE is still allowed by RLS

`missions_delete_creator_or_admin` ([`20260726_missions_schema_hardening.sql`](../supabase/migrations/20260726_missions_schema_hardening.sql)) lets the creator `DELETE` any of their rows, including funded `funding` / `in_progress`. `handleDeleteJob` in Profile is currently **unwired** (no callers), so the UI does not expose it — the API still does.

#### P3-5. Stale vault vs code (not runtime bugs)

| Doc | Claim | Code |
| --- | --- | --- |
| `Garbage_History_Lifecycle.md` §8 | Success PDF only on `completed` | Fixed 2026-08-26 |
| `Security_and_RPCs.md` | `accept_mission_bid` only `available` / `pending` | Also `funding` / `open` since 2026-07-23 |
| `Roadmap_to_GooglePlay.md` Phase 1 | Bid-accept-during-funding still an “open product decision” | Shipped + in `.cursorrules` |
| `Roadmap_to_GooglePlay.md` baseline | “Fixed 7-day timer” | Rolling +30d shipped |
| `Stripe_USD_Flow.md` | Target met → always `available` | Also `in_progress` if cleaner locked |
| `api/process-expired-crowdfunding.ts` | Sounds like the cron | Stub only |

---

## D) Hypothesis scorecard

| # | Hypothesis | Verdict |
| --- | --- | --- |
| 1 | Free $0 pin never auto-hides; expiry treats $0 like underfunded and fires Gov Notice | **Split.** Reported pins never hide (**confirmed**). Sweep does **not** touch `reported`. Sweep **does** Gov-Notice $0-raised **`funding`** campaigns (**confirmed**, P0-1). |
| 2 | First Stripe donate does not atomically convert `reported→funding`; convert is manual; Stripe rejects donate on `reported` | **Confirmed** (P0-2). |
| 3 | Success PDF misses `approved` | **Discarded.** Enqueue includes `approved` since `20260826_status_changed_at_approved_reviews.sql`. |
| 4 | Missing `history_public_until` / R2 purge / n8n | **Confirmed as never-built** (P2-1). Not a misfire — the pipeline stops at PDF + Telegram. |
| 5 | Live Market / map visibility vs funding / expired / hidden / archived | **Confirmed gaps** for expired history and archive (P2-2). Funding-with-cleaner is **correct**. |
| 6 | Bid-during-funding + token edges | **Mostly working.** Token-on-new-bid, no refund, no RPC subscription gate, KYC-at-accept-only, `amount_target` clobber (P2-3, P3-1). |
| 7 | Other state-machine holes | **Yes:** `failed` terminal (P1-1), abandon re-tenders funded crowd (P1-2), unpaid convert (P1-4), overfund charge (P0-3), Profile omit `approved` (P2-4), P2P confirm only in archive (P3-3). |

---

## E) Suggested fix order (do not implement in this PR)

1. **Split the expiry sweep**  
   `raised = 0` (and `status='reported'` aged 7d) → `hidden` or delete + optional R2 `reports/` purge. **No** `city_notification_events`.  
   `0 < raised < target` → keep today’s eco-ultimatum.

2. **Atomic first donate**  
   Allow checkout on `reported` **or** convert inside `apply_stripe_contribution` under the same `FOR UPDATE`: set `crowdfunding_mode`, `status='funding'`, freeze `expected_price` (need a target source — convert-at-checkout UI or a draft target column), credit the dollar, bump +30d.  
   Until then, stop starting the 7-day Gov-Notice clock on unpaid convert (or require the converter to be the first donor).

3. **Overfund refund**  
   On webhook `business_reject` after a paid Session, enqueue an automated Stripe refund (or capture only after apply succeeds). Do not leave “manual ops” as the only path.

4. **`failed` recovery**  
   Donor reject should return `in_progress` (like `creator_reject_proof`) or require a quorum. First-vote-wins is too sharp for escrow-like pots.

5. **Exclude crowdfunding from `process_abandoned_missions`** (or notify donors and keep the pot, re-tender explicitly). Do not silently `available` a fully paid crowd job.

6. **Stop writing USD into `amount_target`** in `convert_report_to_mission` / `accept_mission_bid`. Keep token rank = 1 (or real boost).

7. **History columns + crons** (only after 1–2): `history_public_until`, `media_purged_at`, `hidden`/`archived`, n8n webhook after `pdf_status='sent'`, feed/map show `expired` until that timestamp, then purge R2.

8. **Profile / map list hygiene:** include `approved` in worker active + history; decide whether `completed` should appear 24h from `status_changed_at`; restrict `convert_report_to_mission` to reporter (or first donor); recreate `confirm_mission_work_done` in an active migration; revoke creator DELETE while `current_funding > 0`.

9. **Doc sync** (cheap): update `Garbage_History_Lifecycle.md` §8, `Security_and_RPCs.md` accept-bid statuses, `Stripe_USD_Flow.md` target-met transition, mark Roadmap Phase 1 crowd-bid decision as shipped.

**Do not break:** Stripe session idempotency, `FOR UPDATE SKIP LOCKED` on expiry, crowd phone = NULL, 1 token / new bid, funding-visible-with-cleaner.

---

## F) File index (for the next implementer)

| Concern | Latest source |
| --- | --- |
| Free pin create | `create_garbage_zone_report` — `20260826_video_proof_url_and_starter_tokens.sql`; client `src/lib/garbageZoneReport.ts` |
| Convert | `convert_report_to_mission` — `20260909_min_work_budget_2_usd.sql` |
| Credit + timer + target-met | `apply_stripe_contribution` — `20260724_restore_crowdfunding_contribution_timer_bump.sql` |
| Checkout gates | `supabase/functions/stripe-contribution-checkout/index.ts` |
| Webhook / confirm | `supabase/functions/stripe-webhook/index.ts`, `stripe-contribution-confirm/index.ts` |
| Expiry + city queue | `process_expired_crowdfunding_missions` — `20260722_stabilize_crowdfunding_proof_concurrency.sql` |
| Success enqueue | `enqueue_crowdfunding_completion_notification` — `20260826_status_changed_at_approved_reviews.sql` |
| PDF / Telegram / R2 | `supabase/functions/city-notification-pipeline/index.ts` |
| Bid / accept | `place_mission_bid` — `20260826_place_mission_bid_always_one_token.sql`; `accept_mission_bid` — `20260726_tiered_bid_packages.sql` |
| Crowd proof / vote | `submit_mission_proof` — `20260825_fix_submit_mission_proof_geography.sql`; `process_proof_vote` / `auto_approve_escrow_proofs` — `20260817_crowdfunding_escrow_proof_votes.sql` |
| Abandon / stuck review | `20260826_status_changed_at_approved_reviews.sql`, `20260817_…` |
| Feed / map | `components/LiveMarketFeed.tsx`, `components/MapPicker.tsx` |
| Countdown helpers | `src/lib/crowdfunding.ts` |
| Cron stub (not production) | `api/process-expired-crowdfunding.ts` |

---

## G) Method

Read-only. Compared `.cursorrules`, `04_Roadmap_Tasks/Garbage_History_Lifecycle.md` (incl. 2026-08-26 §8), `Roadmap_to_GooglePlay.md`, `00_Dashboard.md`, `01_Architecture/Stripe_USD_Flow.md`, `P2P_Deal_Flow.md`, `Security_and_RPCs.md` against the **latest** `CREATE OR REPLACE FUNCTION` for each RPC, the Edge functions listed above, and the client libs named in the request. No migrations were applied; no product code was changed.
