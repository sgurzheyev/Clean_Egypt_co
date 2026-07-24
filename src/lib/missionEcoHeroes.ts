import { supabase } from '../../services/supabase';

export type MissionEcoHero = {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  contribution_count: number;
  total_donated: number;
  isTopDonor: boolean;
  isVip: boolean;
};

export async function fetchMissionEcoHeroes(
  missionId: string
): Promise<MissionEcoHero[]> {
  if (!missionId) return [];

  const { data, error } = await supabase.rpc('list_mission_eco_heroes', {
    p_mission_id: missionId,
  });

  if (error) {
    console.warn('[ecoHeroes] list_mission_eco_heroes failed', error);
    throw error;
  }

  const rows = Array.isArray(data) ? data : [];
  const mapped = rows.map((row: Record<string, unknown>) => {
    const contributionCount = Math.max(0, Math.floor(Number(row.contribution_count ?? 0)));
    const totalDonated = Math.max(0, Math.floor(Number(row.total_donated ?? 0)));
    return {
      user_id: String(row.user_id ?? ''),
      full_name: row.full_name != null ? String(row.full_name) : null,
      avatar_url: row.avatar_url != null ? String(row.avatar_url) : null,
      contribution_count: contributionCount,
      total_donated: totalDonated,
      isTopDonor: false,
      isVip: contributionCount >= 2,
    };
  }).filter((h) => h.user_id);

  if (mapped.length === 0) return mapped;

  const topTotal = Math.max(...mapped.map((h) => h.total_donated));
  return mapped.map((h) => {
    const isTopDonor = h.total_donated === topTotal && topTotal > 0;
    return {
      ...h,
      isTopDonor,
      isVip: h.contribution_count >= 2 || isTopDonor,
    };
  });
}
