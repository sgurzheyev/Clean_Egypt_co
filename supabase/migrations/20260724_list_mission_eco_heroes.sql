-- Public Eco-Ego ribbon: aggregated crowdfunding supporters for a mission.

CREATE OR REPLACE FUNCTION public.list_mission_eco_heroes(p_mission_id uuid)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  avatar_url text,
  contribution_count integer,
  total_donated integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.contributor_id AS user_id,
    nullif(btrim(coalesce(p.full_name, '')), '') AS full_name,
    nullif(btrim(coalesce(p.avatar_url, '')), '') AS avatar_url,
    count(*)::integer AS contribution_count,
    coalesce(sum(c.amount_usd), 0)::integer AS total_donated
  FROM public.contributions c
  LEFT JOIN public.profiles p ON p.id = c.contributor_id
  WHERE c.mission_id = p_mission_id
  GROUP BY c.contributor_id, p.full_name, p.avatar_url
  ORDER BY
    coalesce(sum(c.amount_usd), 0) DESC,
    count(*) DESC,
    max(c.created_at) DESC NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.list_mission_eco_heroes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_mission_eco_heroes(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.list_mission_eco_heroes(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_mission_eco_heroes(uuid) TO service_role;

COMMENT ON FUNCTION public.list_mission_eco_heroes(uuid) IS
  'Aggregated crowdfunding supporters (avatar, name, donation count + total USD) for Eco-Ego ribbon.';
