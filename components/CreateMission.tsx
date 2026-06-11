import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  validateMissionDescription,
  filterMissionDescription,
  MISSION_DESCRIPTION_POLICY_ERROR,
} from '../src/lib/missionContentPolicy';
import { PROFILE_GLASS_PANEL } from '../constants';

type Props = {
  taskType: 'city' | 'home';
  orderDescription: string;
  setOrderDescription: (v: string) => void;
  orderPhotos: File[];
  setOrderPhotos: (files: File[]) => void;
  onDescriptionPolicyError: (msg: string | null) => void;
  onTextWarning?: (msg: string | null) => void;
  hasTextWarning?: boolean;
  /** SaaS lead-gen: hide the long description field (keep only photo upload). */
  showDescription?: boolean;
};

const CreateMission: React.FC<Props> = ({
  taskType,
  orderDescription,
  setOrderDescription,
  orderPhotos,
  setOrderPhotos,
  onDescriptionPolicyError,
  onTextWarning,
  hasTextWarning = false,
  showDescription = true,
}) => {
  const { t } = useTranslation();
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);

  const resizeDescription = useCallback(() => {
    const el = descriptionRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, 72), 320);
    el.style.height = `${next}px`;
  }, []);

  useLayoutEffect(() => {
    resizeDescription();
  }, [orderDescription, resizeDescription]);

  useEffect(() => {
    const { textWarningKey } = filterMissionDescription(orderDescription);
    onTextWarning?.(textWarningKey ? t(textWarningKey) : null);
  }, [orderDescription, onTextWarning, t]);

  const handleDescriptionChange = (v: string) => {
    setOrderDescription(v);
    const r = validateMissionDescription(v);
    onDescriptionPolicyError(r.ok ? null : MISSION_DESCRIPTION_POLICY_ERROR);
    const { textWarningKey } = filterMissionDescription(v);
    onTextWarning?.(textWarningKey ? t(textWarningKey) : null);
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
            {t('uploadPhoto')}
          </label>
          <label className="flex min-h-[52px] items-center justify-center rounded-2xl border border-dashed border-slate-600 bg-black/30 px-2 text-center text-[11px] text-slate-400 cursor-pointer hover:border-teal-400 hover:text-teal-300 transition-all">
            {orderPhotos.length > 0 ? `${orderPhotos.length} ${t('photosSelected')}` : t('tapToAddReferencePhotos')}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files || []).slice(0, 10);
                setOrderPhotos(files);
              }}
            />
          </label>
          {orderPhotos.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {orderPhotos.length <= 4 ? (
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-amber-500/10 border border-amber-400/50 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">
                  {t('lowProofWork')}
                </span>
              ) : (
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-400/50 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">
                  {t('highProofWork')}
                </span>
              )}
            </div>
          )}
          {orderPhotos.length > 0 && (
            <ul className="mt-2 space-y-1 text-[10px] text-slate-400">
              {orderPhotos.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex justify-between gap-2">
                  <span className="truncate">{f.name}</span>
                  <span className="text-emerald-400">✓</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {showDescription && (
        <div>
        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
          {t('shortDescriptionAndArea')}
        </label>
        <textarea
          ref={descriptionRef}
          value={orderDescription}
          onChange={(e) => handleDescriptionChange(e.target.value)}
          rows={2}
          placeholder={
            taskType === 'city' ? t('describeCitySpot') : t('describeHomeTask')
          }
          className={`w-full min-h-[4.5rem] max-h-[20rem] overflow-y-auto ${PROFILE_GLASS_PANEL} px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500 resize-none ${
            hasTextWarning ? 'border-b-2 border-dashed border-[#ea580c]' : ''
          }`}
        />
        </div>
      )}
    </>
  );
};

export default CreateMission;
