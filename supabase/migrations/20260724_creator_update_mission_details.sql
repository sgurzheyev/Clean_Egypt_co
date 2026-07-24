-- Allow mission creators to edit description + append photos while the pin is still open.

CREATE OR REPLACE FUNCTION public.creator_update_mission_details(
  p_mission_id uuid,
  p_description text,
  p_photo_urls text[]
)
RETURNS public.missions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mission public.missions;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_mission
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  IF v_mission.creator_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Only the mission creator can edit';
  END IF;

  v_status := lower(coalesce(v_mission.status::text, ''));
  IF v_status NOT IN ('available', 'pending', 'funding', 'open') THEN
    RAISE EXCEPTION 'Mission is not editable in its current status';
  END IF;

  IF p_photo_urls IS NOT NULL AND coalesce(cardinality(p_photo_urls), 0) > 9 THEN
    RAISE EXCEPTION 'Too many photos (max 9)';
  END IF;

  IF p_description IS NOT NULL AND char_length(p_description) > 2000 THEN
    RAISE EXCEPTION 'Description too long';
  END IF;

  UPDATE public.missions
  SET
    description = CASE
      WHEN p_description IS NULL THEN description
      ELSE nullif(btrim(p_description), '')
    END,
    photo_urls = CASE
      WHEN p_photo_urls IS NULL THEN photo_urls
      ELSE p_photo_urls[1:9]
    END
  WHERE id = p_mission_id
  RETURNING * INTO v_mission;

  RETURN v_mission;
END;
$$;

REVOKE ALL ON FUNCTION public.creator_update_mission_details(uuid, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.creator_update_mission_details(uuid, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_update_mission_details(uuid, text, text[]) TO service_role;
