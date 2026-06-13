export type MissionFeedPlaceholderVariant = 'home' | 'city' | 'default';

export function missionFeedPlaceholderGradient(variant: MissionFeedPlaceholderVariant): string {
  if (variant === 'home') {
    return 'bg-gradient-to-br from-amber-500/50 via-orange-950/80 to-slate-950';
  }
  if (variant === 'city') {
    return 'bg-gradient-to-br from-emerald-500/45 via-cyan-950/75 to-slate-950';
  }
  return 'bg-gradient-to-br from-cyan-500/35 via-indigo-950/70 to-slate-950';
}
