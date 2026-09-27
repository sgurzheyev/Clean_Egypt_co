---
tags: [garbagin, payments, google-play, twa, stripe]
aliases: [Payments Play Policy, Play Billing]
updated: 2026-09-27
---

# Payments — Google Play policy

> Hub: [[🗺️ GARBAGIN Master Index]] · Dashboard: [[04_Roadmap_Tasks/00_Dashboard]] · Roadmap: [[04_Roadmap_Tasks/Roadmap_to_GooglePlay]] · Stripe: [[01_Architecture/Stripe_USD_Flow]] · Edge: [[03_Backend_SQL/Backend_Edge_and_API]] · UI: [[02_Frontend/Frontend_Components]]

The Android app is a Bubblewrap Trusted Web Activity of `www.garbagin.com`, package `com.garbagin.app`. Inside that shell, digital goods are not sold with Stripe. The website keeps Stripe exactly as it is.

## Business model

GarbaGin is SaaS. On a regular mission the client pays the worker directly, outside the platform. `confirm_mission_work_done` sets `completed` and moves no donated money.

The platform holds money only for crowdfunded public-cleanup donations. Donated USD (`current_funding`) and donated tokens (`token_donations` held) are released to the locked worker only after a donation-weighted donor vote (`process_proof_vote`, `mission_proof_votes`). One no is not final. Yes-weight over half of all donations pays immediately. Otherwise a 24-hour window decides by the heavier side of the votes cast. A no majority allows one new proof upload. No votes, a tie, or a second no means the cleanup is not done: the municipal PDF is queued and donors receive tokens at the closed-economy +20% rate. Card payments are not refunded. `completed` does not release the pot. Detail: [[04_Roadmap_Tasks/Garba_Vortex_Heatmap]] and [[../supabase/migrations/20260927170000_donor_vote_release.sql]].

That held-donation release is not a digital-goods purchase. The TWA rules below still hide token packs, the subscription, and Stripe crowdfunding checkouts. Spending tokens the user already holds stays allowed.

Play Billing code exists and is **off**. Neither `VITE_PLAY_BILLING_ENABLED` nor `PLAY_BILLING_ENABLED` is set.

## 1. Detecting the TWA

Source: [[../src/lib/twaContext.ts]]. Called from [[../index.tsx]] before render.

A page is the TWA when any of these is true:

1. `document.referrer` is `android-app://com.garbagin.app`, or that string plus `/`, `?`, or `#`. A longer package such as `com.garbagin.app.fake` does not match.
2. The URL has `twa=1` (`?twa=1` or `&twa=1`). `?twa=0` does not turn the flag off.
3. `sessionStorage` or `localStorage` already has `ce_twa=1`.

The first positive signal is written to **both** `sessionStorage` and `localStorage` under `ce_twa`. Chrome often drops the Android referrer after the first document, so later screens in the same app still hide Stripe. `localStorage` also covers a process restart that opens the origin again without the referrer. The same Chrome profile then keeps TWA mode on `www.garbagin.com` until `ce_twa` is cleared. The website PWA manifest must not set this flag (see below).

## 2. `?twa=1` on the Bubblewrap rebuild

`twa-manifest.json` is **not** in this repo. The website manifest [[../public/manifest.json]] keeps `"start_url": "/"`. Do not put `?twa=1` there — an installed PWA would hide Stripe.

On the Bubblewrap project, set the start URL and leave Play Billing disabled, then rebuild:

```json
{
  "startUrl": "/?twa=1",
  "features": {
    "playBilling": {
      "enabled": false
    }
  }
}
```

```bash
bubblewrap update
bubblewrap build
```

`startUrl` is the path Bubblewrap appends to the manifest origin. Digital Asset Links for `com.garbagin.app` already live at [[../public/.well-known/assetlinks.json]].

`features.playBilling.enabled` stays `false` until the product flag in section 4 is deliberately turned on. Enabling the manifest feature without the server flag does not sell anything; the client flag is also off, so the Play buttons are not mounted.

## 3. What Stripe does inside the TWA

Neutral copy (EN / RU), key `playPurchasesComingSoon`:

- EN: `Purchases coming soon in the Android app.`
- RU: `Покупки скоро появятся в приложении Android.`

No “buy on the website” link or steering sentence. Token **spending** stays: placing a pin, bidding (1 token), and [[../components/TokenDonateForm.tsx]] (donating tokens the user already holds).

| Id | Rail | Surface | In the TWA |
| --- | --- | --- | --- |
| `stripe-token-intent` | digital goods | Token pack slider in [[../src/components/TokenPackModal.tsx]] | Hidden. Modal shows the neutral line. No PaymentIntent is created. |
| `stripe-token-credit` | digital goods | Credits that pack | Unreachable from the TWA UI. |
| `stripe-subscription-intent` | digital goods | $9.99 yearly phone-unlock | Hidden. Profile / map subscribe opens the same neutral modal. The worker gate hides the price and the pay button. |
| `stripe-subscription-activate` | digital goods | Activates that subscription | Unreachable from the TWA UI. |
| `stripe-contribution-checkout` | digital goods | Crowdfunding Stripe donation. If nobody cleans the pin, the closed loop credits in-app tokens. | Form hidden. [[../src/lib/contributions.ts]] `startContributionCheckout` throws `digital_goods_blocked`. |
| `stripe-contribution-confirm` | digital goods | Applies a Checkout session that already exists | Server confirm stays for the website return URL. The TWA cannot start that Checkout. |
| `stripe-webhook` | digital goods | Crowdfunding Checkout sessions only | Server-side. No client button. |
| `stripe-intent` | digital goods | Wallet top-up. No screen calls it | [[../src/lib/stripe.ts]] `createWalletTopUpIntent` throws in the TWA. |
| `stripe-wallet-credit` | digital goods | Credits a wallet top-up. No screen calls it | No UI. |
| `create-payment-intent` | legacy, unused | Intent with no cleaner metadata. No UI caller | Not a purchase screen. Not blocked as a physical rail because it does not pay a cleaner. |
| `verify-job-payment` | legacy, unused | [[../api/verify-job-payment.ts]] always returns `{ moved: false }` | Profile may call it after an old `job_creation` flag. It does not charge. |

**Physical-service Stripe: none.** There is no Checkout that pays a named cleaner for a cleanup, car detailing, or any other real-world job. Those jobs settle off-platform after contact unlock ([[01_Architecture/P2P_Deal_Flow]]). Pin placement spends existing tokens. If a physical Stripe rail is added later, classify it in [[../src/lib/stripeEntryPoints.ts]] as `physical_service`. `stripeRailBlockedInTwa` is true only for `digital_goods`, so that rail would stay available in the TWA.

List: [[../src/lib/stripeEntryPoints.ts]]. Tests: [[../src/lib/twaContext.test.ts]].

## 4. Play Billing stub (off)

Client: [[../src/lib/playBilling.ts]], panel [[../src/components/PlayBillingCheckout.tsx]].

- Method: `window.getDigitalGoodsService('https://play.google.com/billing')` plus the Payment Request API (`supportedMethods` the same URL, `data.sku`).
- Shown only when `import.meta.env.VITE_PLAY_BILLING_ENABLED === '1'` **and** the page is the TWA. The env var is unset, so the panel is not mounted. The TWA shows only the neutral sentence.
- SKUs (must match Play Console and the Edge function):
  - Consumable: `tokens_100`, `tokens_300`, `tokens_700`, `tokens_5000` (same token counts as [[../src/lib/tokenPricing.ts]]).
  - Subscription: `yearly_access` (12 months).

Server: [[../supabase/functions/play-billing-verify/index.ts]]. `supabase/config.toml` lists the function so it can be deployed. **`enabled = true` in that file means the function exists. It does not turn billing on.** The first line of `POST` returns `403` `{ code: 'play_billing_disabled', enabled: false }` unless `PLAY_BILLING_ENABLED` is exactly `true`. That secret is not set. No purchase is credited while it is off.

When both flags are later turned on, the function:

1. Requires the caller JWT.
2. Signs a service-account JWT (`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`) for `https://www.googleapis.com/auth/androidpublisher`.
3. Reads `purchases/products/{sku}/tokens/{token}` or `purchases/subscriptions/yearly_access/tokens/{token}` for `com.garbagin.app`.
4. Credits only when the product `purchaseState` is `0`, or the subscription `paymentState` is `1`.
5. Writes ledger id `play:` + purchase token through `credit_tokens_from_payment_service_role` or `activate_subscription_from_payment_service_role` (unique `payment_intent_id`, so a replay does not double-credit).
6. Then consumes the token pack or acknowledges the subscription. A failed settle still returns the credit and `acknowledged: false` so a retry can settle without a second grant.

### Before anyone enables it

1. Play Console in-app products with those exact ids, priced in the console (shop reference: token tiers $10 / $19.99 / $49.99 / $99, subscription $9.99).
2. A Google Cloud service account linked in Play Console → API access, with permission to view orders. Store the JSON key as the Edge secret `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.
3. Bubblewrap `features.playBilling.enabled: true`, then `bubblewrap update` and a new AAB.
4. Set `PLAY_BILLING_ENABLED=true` on the function and build the web app with `VITE_PLAY_BILLING_ENABLED=1`.

Until those four are done on purpose, leave the flags unset and `playBilling.enabled` false.
