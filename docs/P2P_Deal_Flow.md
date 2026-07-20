# P2P Deal Flow

> Standard (non-crowdfund) missions: worker and creator settle directly. No internal fiat escrow. See [[Architecture_Overview]], [[Security_and_RPCs]], [[KYC_Verification]], [[Stripe_USD_Flow]].

## Status flow

```
available → in_progress → review → completed
```

Legacy aliases still seen in UI/data: `pending` ≈ available, `pending_approval` ≈ review, `finished` ≈ completed.

## Steps

1. **Create** — `create_lead_mission_with_token` (token pin fee). Budget = `expected_price` USD.
2. **Bid / accept** — worker bids; creator `accept_mission_bid` → `in_progress` ([[Security_and_RPCs]]).
3. **Home missions** — worker must be KYC-verified ([[KYC_Verification]]).
4. **Proof** — worker `submit_mission_proof` → `review` (photos / liveness + **server GPS ≤200m**). No wallet debit.
5. **Confirm** — creator confirms work done and pays the worker **off-platform / agreed P2P**. Platform does not hold fiat escrow.
5b. **Creator reject** — `creator_reject_proof` → `in_progress` with `rejection_reason` (worker re-uploads).
5c. **Timers** — abandoned `in_progress` (>24h) → `available`; stuck `review` (>3d) → `completed` + `auto_approved`.
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

Garbage Removal campaigns use Stripe contributions while `status = funding`, then open for bidding when target met — [[Stripe_USD_Flow]]. Expired underfunded campaigns → `expired` + city PDF queue (not P2P refund).

## Related RPCs

Documented in [[Security_and_RPCs]]. Field notes: [[../00_Dashboard]].
