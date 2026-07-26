/**
 * [[Frontend_Components.md]] · [[Architecture_Overview.md]]
 *
 * Immersive Visual Feed — full-screen, vertical, media-first mission browser
 * (TikTok-style snap scroll). Entered by tapping a mission photo in the
 * Services Market or the Profile marketplace list.
 *
 * The mission stack is the caller's already-filtered + sorted list, so active
 * Country / City / Tag filters carry over 1:1 — swiping up always moves to the
 * next mission of the current selection.
 *
 * Right action sidebar: creator avatar → public profile, location pin → map
 * focus, Contact → mission briefing (contact stays privacy-locked until a bid
 * is accepted — "Hungry-Games" rule), Message → briefing P2P chat.
 * Bottom nav: Map (back to map, focused on current mission) / Messages / Profile.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Map as MapIcon,
  MapPin,
  MessageCircle,
  Phone,
  UserRound,
  X,
  ChevronsUp,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import TranslatableMissionDescription from './TranslatableMissionDescription';
import { formatWorkBudgetUsd } from '../src/lib/formatMoney';
import { missionWorkBudgetUsd } from '../src/lib/missionBudget';
import { missionPinIcon, missionSector } from '../src/lib/serviceSectors';
import { missionFeedPlaceholderGradient } from '../src/lib/missionFeedVisuals';
import { extractMissionFeedDescription } from '../src/lib/missionDescription';

/** Structural mission shape — both LiveMarketMission and Profile's Job satisfy it. */
export type ImmersiveFeedMission = {
  id: string;
  status?: string | null;
  category?: string | null;
  service_type?: string | null;
  expected_price?: number | null;
  amount_target?: number | null;
  location_lat?: number | null;
  location_lng?: number | null;
  country?: string | null;
  city?: string | null;
  description?: string | null;
  photo_urls?: string[] | null;
  creator_id?: string | null;
  creator?: {
    full_name?: string | null;
    avatar_url?: string | null;
  } | null;
};

export interface ImmersiveMissionFeedProps {
  open: boolean;
  /** Already-filtered + sorted mission stack (Country/City/Tags respected by caller). */
  missions: readonly ImmersiveFeedMission[];
  /** Mission whose photo was tapped — feed opens scrolled to it. */
  startMissionId?: string | null;
  onClose: () => void;
  /** Avatar tap → creator public profile. */
  onOpenCreator: (creatorId: string) => void;
  /** Location icon + bottom-nav "Map" → interactive map focused on the mission. */
  onShowOnMap: (mission: ImmersiveFeedMission) => void;
  /** "Contact" → mission briefing (contact panel; unlock rules apply there). */
  onContact: (mission: ImmersiveFeedMission) => void;
  /** "Message" + bottom-nav "Messages" → briefing with P2P chat intent. */
  onMessage: (mission: ImmersiveFeedMission) => void;
  /** Bottom-nav "Profile" → account management overlay. */
  onOpenProfile?: () => void;
}

/** Slides whose photos stay mounted around the active index (cheap windowing). */
const PHOTO_WINDOW = 2;

function missionHashtags(description: string | null | undefined): string[] {
  return (String(description ?? '').match(/#[\p{L}0-9_]+/gu) ?? []).slice(0, 3);
}

/** 📍 description line → stored city/country → raw coordinates. */
function missionPlaceLine(mission: ImmersiveFeedMission): string | undefined {
  const first = String(mission.description ?? '').split('\n')[0]?.trim();
  if (first && first.startsWith('📍')) return first;
  const place = [mission.city, mission.country]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(', ');
  if (place) return `📍 ${place}`;
  if (
    typeof mission.location_lat === 'number' &&
    typeof mission.location_lng === 'number'
  ) {
    return `📍 ${mission.location_lat.toFixed(4)}, ${mission.location_lng.toFixed(4)}`;
  }
  return undefined;
}

const sidebarBtnClass =
  'flex h-12 w-12 items-center justify-center rounded-full border border-white/25 bg-black/55 text-white shadow-lg backdrop-blur-md transition-transform hover:bg-black/75 active:scale-90';

const ImmersiveMissionFeed: React.FC<ImmersiveMissionFeedProps> = ({
  open,
  missions,
  startMissionId,
  onClose,
  onOpenCreator,
  onShowOnMap,
  onContact,
  onMessage,
  onOpenProfile,
}) => {
  const { t } = useTranslation();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const indexRef = useRef(0);
  const [index, setIndex] = useState(0);

  const startIndex = useMemo(() => {
    if (!startMissionId) return 0;
    const found = missions.findIndex((m) => m.id === startMissionId);
    return found >= 0 ? found : 0;
  }, [missions, startMissionId]);

  // Jump (no animation) to the tapped mission every time the feed opens.
  useEffect(() => {
    if (!open) return;
    indexRef.current = startIndex;
    setIndex(startIndex);
    const raf = requestAnimationFrame(() => {
      const el = scrollerRef.current;
      if (el) el.scrollTop = startIndex * el.clientHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [open, startIndex]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const next = Math.min(
      Math.max(0, missions.length - 1),
      Math.max(0, Math.round(el.scrollTop / Math.max(1, el.clientHeight)))
    );
    if (next !== indexRef.current) {
      indexRef.current = next;
      setIndex(next);
    }
  }, [missions.length]);

  const current = missions[Math.min(index, Math.max(0, missions.length - 1))];

  const navBtn = (
    icon: React.ReactNode,
    label: string,
    onClick: (() => void) | undefined
  ) => (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-black uppercase tracking-[0.14em] transition-colors ${
        onClick ? 'text-slate-200 hover:text-emerald-300' : 'text-slate-500'
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );

  return (
    <AnimatePresence>
      {open && missions.length > 0 && (
        <motion.div
          key="immersive-feed"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="fixed inset-0 z-[10040] h-dvh bg-black"
          role="dialog"
          aria-modal="true"
          aria-label={t('immersiveFeedTitle', { defaultValue: 'Visual feed' })}
        >
          {/* Vertical snap scroller — one full-viewport slide per mission. */}
          <div
            ref={scrollerRef}
            onScroll={handleScroll}
            className="ce-hide-scrollbar h-full w-full snap-y snap-mandatory overflow-y-auto overscroll-contain"
          >
            {missions.map((mission, i) => {
              const nearActive = Math.abs(i - index) <= PHOTO_WINDOW;
              const photoUrl = mission.photo_urls?.[0] ?? null;
              const isHome =
                missionSector(mission.service_type, mission.category ?? undefined) ===
                'home';
              const budget = formatWorkBudgetUsd(missionWorkBudgetUsd(mission));
              const placeLine = missionPlaceLine(mission);
              const tags = missionHashtags(mission.description);
              const shortDesc = extractMissionFeedDescription(mission.description);
              const creatorName = mission.creator?.full_name ?? null;
              const creatorInitial =
                (creatorName || '?').trim().charAt(0).toUpperCase() || '?';

              return (
                <section
                  key={mission.id}
                  className="relative h-full w-full snap-start snap-always overflow-hidden"
                >
                  {/* Media layer — object-cover for a true full-screen fit. */}
                  {photoUrl && nearActive ? (
                    <img
                      src={photoUrl}
                      alt=""
                      draggable={false}
                      loading={i === index ? 'eager' : 'lazy'}
                      className="absolute inset-0 h-full w-full select-none object-cover"
                    />
                  ) : (
                    <div
                      className={`absolute inset-0 flex items-center justify-center ${missionFeedPlaceholderGradient(
                        isHome ? 'home' : 'city'
                      )}`}
                    >
                      <span className="text-6xl opacity-80" aria-hidden>
                        {missionPinIcon(mission.service_type, mission.category ?? undefined)}
                      </span>
                    </div>
                  )}

                  {/* Legibility gradients. */}
                  <div
                    className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 to-transparent"
                    aria-hidden
                  />
                  <div
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/90 via-black/45 to-transparent"
                    aria-hidden
                  />

                  {/* Metadata overlay — clears the sidebar (right) and bottom nav. */}
                  <div className="absolute inset-x-0 bottom-0 z-10 px-4 pb-[calc(5.5rem+max(0.75rem,env(safe-area-inset-bottom)))] pr-[4.75rem]">
                    <p className="text-3xl font-black leading-none tracking-tight text-orange-300 drop-shadow-[0_2px_14px_rgba(0,0,0,0.6)]">
                      {budget}
                    </p>
                    {placeLine && (
                      <p className="mt-2 truncate text-sm font-semibold text-slate-100/95">
                        {placeLine}
                      </p>
                    )}
                    {shortDesc && nearActive && (
                      <div className="mt-2 max-w-xl text-sm text-slate-100/90">
                        <TranslatableMissionDescription
                          text={shortDesc}
                          autoTranslate
                          clampClassName="line-clamp-3"
                        />
                      </div>
                    )}
                    {tags.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full border border-cyan-400/40 bg-cyan-500/15 px-2.5 py-0.5 text-[11px] font-bold text-cyan-100 backdrop-blur-sm"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {i === startIndex && missions.length > 1 && (
                      <p className="mt-3 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-300/70">
                        <ChevronsUp className="h-3.5 w-3.5 animate-bounce" aria-hidden />
                        {t('immersiveSwipeHint', {
                          defaultValue: 'Swipe up — next mission',
                        })}
                      </p>
                    )}
                  </div>

                  {/* Right action sidebar. */}
                  <div className="absolute right-3 bottom-[calc(6.75rem+max(0.75rem,env(safe-area-inset-bottom)))] z-20 flex flex-col items-center gap-4">
                    <button
                      type="button"
                      onClick={
                        mission.creator_id
                          ? () => onOpenCreator(mission.creator_id!)
                          : undefined
                      }
                      disabled={!mission.creator_id}
                      className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-2 border-emerald-300/60 bg-black/55 text-emerald-100 shadow-lg backdrop-blur-md transition-transform ${
                        mission.creator_id ? 'active:scale-90' : 'cursor-default opacity-70'
                      }`}
                      aria-label={t('viewCreatorProfile', {
                        defaultValue: 'View creator profile',
                      })}
                      title={creatorName || undefined}
                    >
                      {mission.creator?.avatar_url ? (
                        <img
                          src={mission.creator.avatar_url}
                          alt=""
                          draggable={false}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-base font-black uppercase">
                          {creatorInitial}
                        </span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => onShowOnMap(mission)}
                      className={`${sidebarBtnClass} text-cyan-200`}
                      aria-label={t('immersiveShowOnMap', {
                        defaultValue: 'Show on map',
                      })}
                    >
                      <MapPin className="h-5 w-5" strokeWidth={2.25} />
                    </button>

                    <div className="flex flex-col items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onContact(mission)}
                        className={`${sidebarBtnClass} text-emerald-300`}
                        aria-label={t('immersiveContact', { defaultValue: 'Contact' })}
                      >
                        <Phone className="h-5 w-5" strokeWidth={2.25} />
                      </button>
                      <span className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-200/90">
                        {t('immersiveContact', { defaultValue: 'Contact' })}
                      </span>
                    </div>

                    <div className="flex flex-col items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onMessage(mission)}
                        className={`${sidebarBtnClass} text-violet-300`}
                        aria-label={t('immersiveMessage', { defaultValue: 'Message' })}
                      >
                        <MessageCircle className="h-5 w-5" strokeWidth={2.25} />
                      </button>
                      <span className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-200/90">
                        {t('immersiveMessage', { defaultValue: 'Message' })}
                      </span>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>

          {/* Top chrome: position counter + close. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <span className="rounded-full border border-white/15 bg-black/45 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-slate-200 backdrop-blur-md">
              {index + 1} / {missions.length}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-black/55 text-white backdrop-blur-md transition-transform hover:bg-black/75 active:scale-90"
              aria-label={t('close', { defaultValue: 'Close' })}
            >
              <X className="h-5 w-5" strokeWidth={2.25} />
            </button>
          </div>

          {/* Bottom navigation — Map replaces Home inside the feed. */}
          <nav className="absolute inset-x-0 bottom-0 z-30 flex items-stretch border-t border-white/10 bg-black/65 pb-safe-sm backdrop-blur-lg">
            {navBtn(
              <MapIcon className="h-5 w-5" strokeWidth={2.25} />,
              t('immersiveNavMap', { defaultValue: 'Map' }),
              current ? () => onShowOnMap(current) : undefined
            )}
            {navBtn(
              <MessageCircle className="h-5 w-5" strokeWidth={2.25} />,
              t('immersiveNavMessages', { defaultValue: 'Messages' }),
              current ? () => onMessage(current) : undefined
            )}
            {navBtn(
              <UserRound className="h-5 w-5" strokeWidth={2.25} />,
              t('immersiveNavProfile', { defaultValue: 'Profile' }),
              onOpenProfile
            )}
          </nav>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ImmersiveMissionFeed;
