-- ============================================================================
-- Admin SaaS overview: extend profile finance list + KPIs + grant tokens + stores
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Extend admin_list_profiles_finance with SaaS economy fields + store link
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_list_profiles_finance(integer);

CREATE OR REPLACE FUNCTION public.admin_list_profiles_finance(p_limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid,
  full_name text,
  telegram_username text,
  contact_email text,
  wallet_balance numeric,
  token_balance integer,
  subscription_expires_at timestamptz,
  verification_status text,
  avatar_url text,
  is_verified boolean,
  is_banned boolean,
  first_gps_track jsonb,
  store_id uuid,
  store_name text,
  store_published boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.telegram_username,
    p.contact_email,
    p.wallet_balance,
    coalesce(p.token_balance, 0)::integer,
    p.subscription_expires_at,
    coalesce(p.verification_status, CASE WHEN coalesce(p.is_verified, false) THEN 'verified' ELSE 'unverified' END),
    p.avatar_url,
    coalesce(p.is_verified, false),
    coalesce(p.is_banned, false),
    CASE
      WHEN p.first_gps_track IS NULL THEN NULL
      ELSE p.first_gps_track::jsonb
    END,
    s.id,
    s.store_name,
    coalesce(s.is_published, false)
  FROM public.profiles p
  LEFT JOIN LATERAL (
    SELECT cs.id, cs.store_name, cs.is_published
    FROM public.contractor_stores cs
    WHERE cs.owner_id = p.id
    ORDER BY cs.is_published DESC, cs.updated_at DESC NULLS LAST
    LIMIT 1
  ) s ON true
  ORDER BY coalesce(p.token_balance, 0) DESC, coalesce(p.wallet_balance, 0) DESC
  LIMIT greatest(1, least(coalesce(p_limit, 50), 200));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_profiles_finance(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_profiles_finance(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_list_profiles_finance(integer) IS
  'Admin-only profile directory: tokens, subscription, KYC, optional storefront.';

-- ---------------------------------------------------------------------------
-- 2) SaaS overview KPIs (users / active subs / token economy volume)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_saas_overview_metrics();

CREATE OR REPLACE FUNCTION public.admin_saas_overview_metrics()
RETURNS TABLE (
  total_users bigint,
  active_subscriptions bigint,
  tokens_purchased bigint,
  tokens_consumed bigint,
  tokens_in_circulation bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchased bigint := 0;
  v_circulation bigint := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  IF to_regclass('public.token_purchases') IS NOT NULL THEN
    EXECUTE 'SELECT coalesce(sum(tokens), 0)::bigint FROM public.token_purchases'
      INTO v_purchased;
  END IF;

  SELECT coalesce(sum(p.token_balance), 0)::bigint
  INTO v_circulation
  FROM public.profiles p;

  RETURN QUERY
  SELECT
    (SELECT count(*)::bigint FROM public.profiles) AS total_users,
    (
      SELECT count(*)::bigint
      FROM public.profiles p
      WHERE p.subscription_expires_at IS NOT NULL
        AND p.subscription_expires_at > now()
    ) AS active_subscriptions,
    v_purchased AS tokens_purchased,
    greatest(0, v_purchased - v_circulation) AS tokens_consumed,
    v_circulation AS tokens_in_circulation;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_saas_overview_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_saas_overview_metrics() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Admin grant / set token balance (bonus tokens)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_grant_tokens(p_user_id uuid, p_tokens integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF p_user_id IS NULL OR p_tokens IS NULL OR p_tokens = 0 OR abs(p_tokens) > 100000 THEN
    RAISE EXCEPTION 'Invalid token amount';
  END IF;

  UPDATE public.profiles
  SET token_balance = greatest(0, coalesce(token_balance, 0) + p_tokens)
  WHERE id = p_user_id
  RETURNING token_balance INTO v_next;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  RETURN v_next;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_token_balance(p_user_id uuid, p_balance integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF p_user_id IS NULL OR p_balance IS NULL OR p_balance < 0 OR p_balance > 1000000 THEN
    RAISE EXCEPTION 'Invalid token balance';
  END IF;

  UPDATE public.profiles
  SET token_balance = p_balance
  WHERE id = p_user_id
  RETURNING token_balance INTO v_next;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  RETURN v_next;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grant_tokens(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_token_balance(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_grant_tokens(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_token_balance(uuid, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Published / draft stores for Users & Stores directory
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_list_contractor_stores(integer);

CREATE OR REPLACE FUNCTION public.admin_list_contractor_stores(p_limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid,
  owner_id uuid,
  store_name text,
  is_published boolean,
  office_address text,
  owner_name text,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.owner_id,
    s.store_name,
    coalesce(s.is_published, false),
    s.office_address,
    p.full_name,
    s.updated_at
  FROM public.contractor_stores s
  LEFT JOIN public.profiles p ON p.id = s.owner_id
  ORDER BY s.is_published DESC, s.updated_at DESC NULLS LAST
  LIMIT greatest(1, least(coalesce(p_limit, 50), 200));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_contractor_stores(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_contractor_stores(integer) TO authenticated, service_role;
