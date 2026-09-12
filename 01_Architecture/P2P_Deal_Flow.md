# P2P Deal Flow

> Standard (non-crowdfund) missions: worker and creator settle directly. No internal fiat escrow. See [[🗺️ GARBAGIN Master Index]], [[01_Architecture/Architecture_Overview]], [[01_Architecture/Security_and_RPCs]], [[01_Architecture/KYC_Verification]], [[01_Architecture/Stripe_USD_Flow]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]].

## Status flow

```
available → in_progress → review → completed
```

Legacy aliases still seen in UI/data: `pending` ≈ available, `pending_approval` ≈ review, `finished` ≈ completed.

## Steps

1. **Create** — `create_lead_mission_with_token` (token pin fee). Budget = `expected_price` USD.
2. **Bid / accept** — worker bids; creator `accept_mission_bid` → `in_progress` ([[Security_and_RPCs]]). Accepted USD writes `expected_price` only — `amount_target` stays token rank ([[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]]).
3. **Home missions** — worker must be KYC-verified ([[KYC_Verification]]).
4. **Proof** — worker `submit_mission_proof` → `review` (photos / liveness + **server GPS ≤200m**). No wallet debit.
5. **Confirm** — creator calls `confirm_mission_work_done` (alias of `confirm_mission_direct_payment`, P3-3 in the active tree) and pays the worker **off-platform / agreed P2P**. Platform does not hold fiat escrow.
5b. **Creator reject** — `creator_reject_proof` → `in_progress` with `rejection_reason` (worker re-uploads). Crowd donor reject uses the same retry shape ([[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]]).
5c. **Timers** — abandoned **P2P** `in_progress` (>24h) → `available`; stuck `review` (>3d) → `completed` + `auto_approved`. Crowdfunding is **not** silently abandoned (P1-2).
6. **Dispute** — supervisor/admin moderation updates status / retry; no escrow unwind ([[../supabase/migrations/20260719_moderate_mission_dispute_p2p.sql]]).

## UI surfaces

| Step | UI |
| --- | --- |
| Map create / bid | [[../components/MapPicker.tsx]] |
| Briefing | [[../components/MissionBriefing.tsx]] |
| Profile orders / review | [[../components/Profile.tsx]] |
| Admin / supervisor | [[../src/components/AdminDashboard.tsx]], [[../components/SupervisorDashboard.tsx]] |

## Money display

- Work budget: [[../src/lib/missionBudget.ts]], [[../src/lib/formatMoney.ts]]
- Safety: values &lt; 100 may render as tokens to avoid fiat confusion ([[../.cursorrules]])

## vs Crowdfunding

Garbage Removal campaigns use Stripe contributions while `status = funding`, then open for bidding when target met — [[Stripe_USD_Flow]]. Expired underfunded campaigns with money → eco-ultimatum (Gov Notice, n8n, 7-day Garbage History, then R2 archive) — [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]]. $0 after 7 days → pin hidden (no refund path). A Checkout the pot **never accepted** (overfund race) **is** card-refunded — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]]. Unpaid convert of a civic pin is the **reporter only**. Donor reject on a funded video retries the cleaner — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]]. Token rank vs USD, Profile `approved`, funded DELETE lock — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]].

## Related RPCs

Documented in [[01_Architecture/Security_and_RPCs]]. Field notes: [[04_Roadmap_Tasks/00_Dashboard]]. Audit: [[docs/GARBAGIN_LIFECYCLE_AUDIT]]. Hygiene: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]] · [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]].
