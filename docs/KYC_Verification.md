# KYC Verification

> Worker identity verification for Home / Private missions. See also [[Architecture_Overview]], [[Security_and_RPCs]], [[P2P_Deal_Flow]], [[Stripe_USD_Flow]].

## Purpose

Only verified workers may take home/private missions. KYC is a multi-step modal flow: document upload → liveness video → submit for admin review.

## Status machine

| Status | Meaning |
| --- | --- |
| `unverified` | Default |
| `pending` | Submitted; waiting admin |
| `verified` | Approved (`is_verified` synced true) |
| `rejected` | Admin rejected (optional reason) |

Synced via triggers on `profiles.verification_status` ↔ `profiles.is_verified`.

## Frontend

- Modal: [[../components/VerificationModal.tsx]]
- Entry: [[../components/Profile.tsx]], [[../components/MapPicker.tsx]] (bid gate)
- Admin queue: [[../src/components/KYCReviewDashboard.tsx]]
- Signed URL helpers: [[../src/lib/kycDocuments.ts]], [[../src/lib/supabaseAuth.ts]]

### Liveness capture

Short front-camera clip (WebRTC / `MediaRecorder`) in [[../components/VerificationModal.tsx]]. Stored as a private object under `kyc/{uid}/liveness/…`.

### Submission

1. Upload front (and optional back) + liveness blob to Storage bucket `kyc_documents`.
2. Call RPC `submit_kyc_verification` → sets `verification_status = 'pending'`.

## Storage

- Bucket: **`kyc_documents`** (private)
- Paths: `kyc/{user_id}/docs/…`, `kyc/{user_id}/liveness/…`
- Policies: owner insert/select; admins select (Dashboard / [[../supabase/manual/kyc_documents_storage_policies.sql]])

### Admin media previews

Browser RLS blocks non-owner reads. Admins mint 1h URLs via Edge Function:

- [[../supabase/functions/kyc-admin-signed-urls/index.ts]]
- Uses `SUPABASE_SERVICE_ROLE_KEY` after `is_platform_admin` check

## SQL migrations

- Identity + RPC: [[../supabase/migrations/20260720_kyc_identity_verification.sql]]
- Admin moderate: [[../supabase/migrations/20260720_kyc_admin_moderation.sql]]
- List + email join: [[../supabase/migrations/20260720_fix_kyc_admin_list_and_media.sql]]

## Related

- Trust / home mission gate: [[../src/lib/trustDeposit.ts]]
- Admin shell: [[../src/components/AdminDashboard.tsx]]
- Dashboard hub: [[../00_Dashboard]]
