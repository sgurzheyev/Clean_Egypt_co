# Field test: token reset + Stripe check (2026-09-27)

> Hub: [[04_Roadmap_Tasks/00_Dashboard]] · [[🗺️ GARBAGIN Master Index]] · SQL: [[03_Backend_SQL/SQL_Migrations_Index]] · Admin: [[04_Roadmap_Tasks/Admin_P1_Upgrade]]

## A. Admin panel: "Reset all tokens to N"

- Migration [[20260927100000_admin_reset_tokens.sql]] adds `public.admin_reset_all_tokens(p_tokens integer DEFAULT 100) RETURNS integer`.
  - It is SECURITY DEFINER. Only a platform admin or service_role can run it; anyone else gets `forbidden` (42501). EXECUTE is revoked from PUBLIC and anon.
  - It sets `profiles.token_balance` (the live token column, int4) on every profile. `wallet_balance`, `frozen_balance` and the other money columns are not touched.
  - It writes one `admin_audit_log` row: before = profile count and old token total/min/max; after = new value, new total, number of profiles changed.
  - It returns the number of profiles whose balance changed. The allowed range is 0..1,000,000.
- UI: in **Admin → Users → People**, under the search box, there is a number input (default 100) and a "Reset all tokens to N" button. The in-panel confirm dialog runs before the RPC. Commit `60ef5a5`.
- Applied with `supabase db query --linked -f …`, then `supabase migration repair --linked --status applied 20260927100000`. Dry run first (rolled back): non-admin got `forbidden`, anon got `permission denied`, admin changed 20 profiles, `-1` was rejected.

## B. Prod reset: every account to 100 tokens

- Backup before the reset: `~/Downloads/garbagin-token-backup-2026-09-27.csv` on the Mac (outside the repo). Columns: `id, token_balance, wallet_balance, frozen_balance`; 20 profiles.
- Before: 20 profiles, 6676 tokens in total, min 0, max 5125, average 333.8. Distribution: 0×7, 5×1, 27×1, 40×1, 48×2, 50×4, 97×1, 98×1, 988×1, 5125×1.
- Ran `admin_reset_all_tokens(100)` as the founder admin (`260afcbd…`) at 2026-09-27 00:35 Cairo. 20 profiles changed.
- After: 20 of 20 profiles have `token_balance = 100`. `sum(wallet_balance)` = 3910.00 and `sum(frozen_balance)` = −4113, both the same as before.
- To restore from the CSV: run `admin_set_token_balance(id, old)` per row as an admin, or do a service-role UPDATE from the CSV.
- New sign-ups still get **50** starter tokens (trigger `trg_profiles_starter_token_balance`). This reset does not change that.

## C. Stripe payment path (no card charged)

How it works: token packs and the yearly subscription use **PaymentIntents + Stripe Elements**, not Checkout. `stripe-token-intent` / `stripe-subscription-intent` create the PaymentIntent (the client sends `pack_usd_cents` + `pack_tokens` from `tokenPricing.ts`). The card is confirmed in the browser. Then the client calls `stripe-token-credit` / `stripe-subscription-activate`, which re-fetch the PI from Stripe (`status = succeeded`, metadata user and purpose must match) and credit through `credit_tokens_from_payment_service_role`. That RPC is idempotent on `token_purchases.payment_intent_id`. Pins are paid with **tokens**, not Stripe. `stripe-webhook` handles only crowdfunding `checkout.session.completed`. It acknowledges and ignores token/subscription purposes.

What passed:

- All payment functions are deployed and ACTIVE: `stripe-token-intent` v40, `stripe-token-credit` v33, `stripe-subscription-intent` v32, `stripe-subscription-activate` v31, `stripe-intent` v33, `stripe-webhook` v16, `stripe-contribution-checkout` / `-confirm`. The token/intent functions were deployed 2026-09-01 10:07 UTC, one minute after the last commit touching them (`b14263d`), so the repo matches what is deployed.
- Supabase secrets `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` exist (checked by name only).
- `stripe-webhook` POST without a signature returns `400 Missing stripe-signature`. The function checks both Stripe env vars first and would return 500 "Server misconfigured" if either were missing, so both are set.
- `stripe-token-intent` without auth returns 401 from the gateway. With the anon key it returns 401 `session_expired` from the function, so the functions boot and enforce a user session.
- The prod bundle on www.garbagin.com has `VITE_STRIPE_PUBLISHABLE_KEY` = **`pk_live_…`**, so payments are **live mode and charge real cards**. Test cards will not work on prod.
- History: 22 `token_purchases` and 7 `subscription_purchases`, the last on 2026-08-19. None in the last 30 days.

What could not be verified without a real user session or a real payment:

- Creating an intent end to end as a signed-in user. We have no user JWT and did not mint one. How to check: sign in on www.garbagin.com and open **Buy tokens**. If the card form renders, the server made a PaymentIntent with a secret key in the same mode as the `pk_live` key (the client throws `stripe_mode_mismatch` otherwise). Do not press Pay.
- Whether `STRIPE_SECRET_KEY` is `sk_live` / `rk_live`. Values cannot be read; the check above proves it.
- Webhook delivery history lives in the Stripe dashboard. The Supabase log API was not permitted for this connector, and the Vercel CLI is not logged in, so Vercel env names were not listed.
- The credit step after a successful charge needs one real small purchase ($10 = 100 tokens).

Risk to note: token/subscription credit is **client-driven**. If the tab closes after the card succeeds but before `stripe-token-credit` runs, the user is charged without being credited. No webhook covers `payment_intent.succeeded` for `purpose = token_pack`. The fix is to handle `payment_intent.succeeded` in `stripe-webhook` with the same idempotent RPC and subscribe the endpoint to that event in Stripe.
