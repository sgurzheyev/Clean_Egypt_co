-- ============================================================================
-- GDPR: own-account deletion support (cascades + erase RPCs)
-- ============================================================================
-- App Store / Play Store requirement: users can fully erase personal data.
-- Physical Storage objects are removed by Edge Function `delete-account`
-- using paths returned from list_user_storage_objects_for_deletion().
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Soften shared finance FKs: keep crowdfunding totals, drop PII linkage
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contributions'
      AND column_name = 'contributor_id'
  ) THEN
    ALTER TABLE public.contributions
      ALTER COLUMN contributor_id DROP NOT NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'contributions.contributor_id nullable: %', SQLERRM;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'contributions'
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) ILIKE '%contributor_id%'
  LOOP
    EXECUTE format('ALTER TABLE public.contributions DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;

  IF to_regclass('public.contributions') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'contributions'
         AND column_name = 'contributor_id'
     ) THEN
    ALTER TABLE public.contributions
      ADD CONSTRAINT contributions_contributor_id_fkey
      FOREIGN KEY (contributor_id) REFERENCES public.profiles(id)
      ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'contributions FK rebuild skipped: %', SQLERRM;
END $$;

-- Mission participant FKs: anonymize instead of cascade-delete civic pins
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'missions' AND column_name = 'creator_id'
  ) THEN
    BEGIN
      ALTER TABLE public.missions ALTER COLUMN creator_id DROP NOT NULL;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'missions' AND column_name = 'cleaner_id'
  ) THEN
    BEGIN
      ALTER TABLE public.missions ALTER COLUMN cleaner_id DROP NOT NULL;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  -- Drop existing FKs on creator_id / cleaner_id if present, then recreate as SET NULL
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'missions'
      AND c.contype = 'f'
      AND (
        pg_get_constraintdef(c.oid) ILIKE '%creator_id%'
        OR pg_get_constraintdef(c.oid) ILIKE '%cleaner_id%'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.missions DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;

  BEGIN
    ALTER TABLE public.missions
      ADD CONSTRAINT missions_creator_id_fkey
      FOREIGN KEY (creator_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN NULL;
            WHEN OTHERS THEN RAISE NOTICE 'missions.creator_id FK: %', SQLERRM;
  END;

  BEGIN
    ALTER TABLE public.missions
      ADD CONSTRAINT missions_cleaner_id_fkey
      FOREIGN KEY (cleaner_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN NULL;
            WHEN OTHERS THEN RAISE NOTICE 'missions.cleaner_id FK: %', SQLERRM;
  END;
END $$;

-- Bids: remove with the cleaner account
DO $$
BEGIN
  IF to_regclass('public.mission_bids') IS NULL THEN
    RETURN;
  END IF;
  BEGIN
    ALTER TABLE public.mission_bids DROP CONSTRAINT IF EXISTS mission_bids_cleaner_id_fkey;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.mission_bids
      ADD CONSTRAINT mission_bids_cleaner_id_fkey
      FOREIGN KEY (cleaner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
            WHEN OTHERS THEN RAISE NOTICE 'mission_bids.cleaner_id FK: %', SQLERRM;
  END;
END $$;

-- Finance purchase rows: keep Stripe idempotency, drop PII link
DO $$
BEGIN
  IF to_regclass('public.token_purchases') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.token_purchases ALTER COLUMN user_id DROP NOT NULL;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      ALTER TABLE public.token_purchases DROP CONSTRAINT IF EXISTS token_purchases_user_id_fkey;
      ALTER TABLE public.token_purchases
        ADD CONSTRAINT token_purchases_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'token_purchases FK: %', SQLERRM;
    END;
  END IF;

  IF to_regclass('public.subscription_purchases') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.subscription_purchases ALTER COLUMN user_id DROP NOT NULL;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      ALTER TABLE public.subscription_purchases DROP CONSTRAINT IF EXISTS subscription_purchases_user_id_fkey;
      ALTER TABLE public.subscription_purchases
        ADD CONSTRAINT subscription_purchases_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'subscription_purchases FK: %', SQLERRM;
    END;
  END IF;

  IF to_regclass('public.transactions') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'user_id'
     ) THEN
    BEGIN
      ALTER TABLE public.transactions ALTER COLUMN user_id DROP NOT NULL;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_user_id_fkey;
      ALTER TABLE public.transactions
        ADD CONSTRAINT transactions_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'transactions FK: %', SQLERRM;
    END;
  END IF;
END $$;

-- Ensure profiles die with auth.users (standard Supabase layout)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN
    BEGIN
      ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
      ALTER TABLE public.profiles
        ADD CONSTRAINT profiles_id_fkey
        FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'profiles→auth.users FK: %', SQLERRM;
    END;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Block deletion while marketplace work is still live
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_own_account_deletable()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_blocking int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT count(*)::int INTO v_blocking
  FROM public.missions m
  WHERE (
      m.cleaner_id = v_uid
      AND lower(coalesce(m.status, '')) IN (
        'in_progress', 'review', 'pending_approval', 'funding', 'disputed', 'dispute'
      )
    )
     OR (
      m.creator_id = v_uid
      AND lower(coalesce(m.status, '')) IN (
        'in_progress', 'review', 'pending_approval', 'funding', 'disputed', 'dispute',
        'available', 'pending', 'open', 'pending_payment'
      )
    );

  IF v_blocking > 0 THEN
    RAISE EXCEPTION 'ACTIVE_MISSIONS'
      USING HINT = 'Finish or cancel active missions before deleting your account.';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_own_account_deletable() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_own_account_deletable() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) List Storage object names owned by / linked to the user (for Edge purge)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_user_storage_objects_for_deletion(p_user_id uuid)
RETURNS TABLE (bucket_id text, object_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_role text := coalesce(auth.jwt()->>'role', '');
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid user';
  END IF;
  -- Caller must be the subject (user JWT) or service_role (Edge Function).
  IF v_role IS DISTINCT FROM 'service_role'
     AND (v_caller IS NULL OR v_caller IS DISTINCT FROM p_user_id) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  -- Prefix layouts
  SELECT o.bucket_id::text, o.name::text
  FROM storage.objects o
  WHERE (
      (o.bucket_id = 'kyc_documents' AND o.name LIKE ('kyc/' || p_user_id::text || '/%'))
      OR (o.bucket_id = 'avatars' AND o.name LIKE (p_user_id::text || '/%'))
      OR (o.bucket_id = 'order-photos' AND o.name LIKE ('stores/' || p_user_id::text || '/%'))
      OR (
        o.bucket_id = 'chat-photos'
        AND (storage.foldername(o.name))[2] = p_user_id::text
      )
    )

  UNION

  -- Explicit KYC paths on the profile row (private bucket store paths / full URLs)
  SELECT 'kyc_documents'::text AS bucket_id, trim(both '/' from x.path) AS object_name
  FROM public.profiles p
  CROSS JOIN LATERAL (
    VALUES
      (p.verification_photo_front),
      (p.verification_photo_back),
      (p.verification_liveness_video)
  ) AS v(raw)
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN v.raw IS NULL OR btrim(v.raw) = '' THEN NULL
      WHEN v.raw LIKE '%/storage/v1/object/%/kyc_documents/%' THEN
        regexp_replace(v.raw, '^.*kyc_documents/', '')
      WHEN v.raw LIKE 'kyc/%' THEN v.raw
      ELSE v.raw
    END AS path
  ) x
  WHERE p.id = p_user_id
    AND x.path IS NOT NULL
    AND length(btrim(x.path)) > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.list_user_storage_objects_for_deletion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_user_storage_objects_for_deletion(uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Erase DB rows / anonymize shared records (service_role only — Edge)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.erase_account_data_for_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := p_user_id;
  v_missions_nulled int := 0;
  v_role text := coalesce(auth.jwt()->>'role', '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Invalid user';
  END IF;
  -- Never expose erase to end-user JWT: Storage purge must run first in Edge.
  IF v_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- Re-check blockers under service role (same rules as assert_own_account_deletable).
  IF EXISTS (
    SELECT 1
    FROM public.missions m
    WHERE (
        m.cleaner_id = v_uid
        AND lower(coalesce(m.status, '')) IN (
          'in_progress', 'review', 'pending_approval', 'funding', 'disputed', 'dispute'
        )
      )
       OR (
        m.creator_id = v_uid
        AND lower(coalesce(m.status, '')) IN (
          'in_progress', 'review', 'pending_approval', 'funding', 'disputed', 'dispute',
          'available', 'pending', 'open', 'pending_payment'
        )
      )
  ) THEN
    RAISE EXCEPTION 'ACTIVE_MISSIONS'
      USING HINT = 'Finish or cancel active missions before deleting your account.';
  END IF;

  UPDATE public.missions
  SET cleaner_id = NULL
  WHERE cleaner_id = v_uid;
  GET DIAGNOSTICS v_missions_nulled = ROW_COUNT;

  UPDATE public.missions
  SET creator_id = NULL
  WHERE creator_id = v_uid;

  IF to_regclass('public.mission_bids') IS NOT NULL THEN
    DELETE FROM public.mission_bids WHERE cleaner_id = v_uid;
  END IF;

  IF to_regclass('public.mission_chats') IS NOT NULL THEN
    DELETE FROM public.mission_chats
    WHERE sender_id = v_uid OR receiver_id = v_uid;
  END IF;

  IF to_regclass('public.user_push_tokens') IS NOT NULL THEN
    DELETE FROM public.user_push_tokens WHERE user_id = v_uid;
  END IF;

  IF to_regclass('public.notifications') IS NOT NULL THEN
    DELETE FROM public.notifications WHERE user_id = v_uid;
    UPDATE public.notifications SET actor_id = NULL WHERE actor_id = v_uid;
  END IF;

  IF to_regclass('public.contributions') IS NOT NULL THEN
    UPDATE public.contributions SET contributor_id = NULL WHERE contributor_id = v_uid;
  END IF;

  IF to_regclass('public.contractor_stores') IS NOT NULL THEN
    DELETE FROM public.contractor_stores WHERE owner_id = v_uid;
  END IF;

  IF to_regclass('public.reviews') IS NOT NULL THEN
    DELETE FROM public.reviews
    WHERE reviewer_id = v_uid OR reviewee_id = v_uid;
    BEGIN
      UPDATE public.reviews SET cleaner_id = NULL WHERE cleaner_id = v_uid;
    EXCEPTION WHEN undefined_column THEN NULL;
    END;
  END IF;

  IF to_regclass('public.token_purchases') IS NOT NULL THEN
    UPDATE public.token_purchases SET user_id = NULL WHERE user_id = v_uid;
  END IF;
  IF to_regclass('public.subscription_purchases') IS NOT NULL THEN
    UPDATE public.subscription_purchases SET user_id = NULL WHERE user_id = v_uid;
  END IF;
  IF to_regclass('public.transactions') IS NOT NULL THEN
    BEGIN
      UPDATE public.transactions SET user_id = NULL WHERE user_id = v_uid;
    EXCEPTION WHEN undefined_column THEN NULL;
    END;
  END IF;

  -- Scrub PII columns then delete the profile row (auth.users deleted by Edge).
  UPDATE public.profiles
  SET
    full_name = 'Deleted user',
    contact_email = NULL,
    phone_number = NULL,
    telegram_username = NULL,
    avatar_url = NULL,
    verification_photo_front = NULL,
    verification_photo_back = NULL,
    verification_liveness_video = NULL,
    verification_status = 'unverified',
    is_verified = false,
    token_balance = 0,
    wallet_balance = 0,
    subscription_expires_at = NULL
  WHERE id = v_uid;

  DELETE FROM public.profiles WHERE id = v_uid;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_uid,
    'missions_cleared', v_missions_nulled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.erase_account_data_for_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.erase_account_data_for_user(uuid) TO service_role;

COMMENT ON FUNCTION public.assert_own_account_deletable() IS
  'GDPR: blocks account deletion while the user still has active marketplace missions.';
COMMENT ON FUNCTION public.list_user_storage_objects_for_deletion(uuid) IS
  'GDPR: lists Storage objects to purge before auth.users deletion.';
COMMENT ON FUNCTION public.erase_account_data_for_user(uuid) IS
  'GDPR: service_role-only anonymize/delete of user DB rows after Storage purge.';
