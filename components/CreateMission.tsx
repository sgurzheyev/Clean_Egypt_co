import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  validateMissionDescription,
  filterMissionDescription,
  MISSION_DESCRIPTION_POLICY_ERROR,
} from '../src/lib/missionContentPolicy';
import { PROFILE_GLASS_PANEL } from '../constants';
import { fileToBase64Parts } from '../src/lib/imageBase64';

export interface PhotoVerificationState {
  verifying: boolean;
  allApproved: boolean;
  hasRejected: boolean;
  /** AI-generated tags for mission metadata (non-blocking) */
  aiTags?: string[];
}

type Props = {
  taskType: 'city' | 'home';
  orderDescription: string;
  setOrderDescription: (v: string) => void;
  orderPhotos: File[];
  setOrderPhotos: (files: File[]) => void;
  onDescriptionPolicyError: (msg: string | null) => void;
  onPhotoVerificationChange: (s: PhotoVerificationState) => void;
  onTextWarning?: (msg: string | null) => void;
  hasTextWarning?: boolean;
};

const CreateMission: React.FC<Props> = ({
  taskType,
  orderDescription,
  setOrderDescription,
  orderPhotos,
  setOrderPhotos,
  onDescriptionPolicyError,
  onPhotoVerificationChange,
  onTextWarning,
  hasTextWarning = false,
}) => {
  const { t } = useTranslation();
  const [checkingPhotos, setCheckingPhotos] = useState(false);
  const [photoStatuses, setPhotoStatuses] = useState<('pending' | 'done')[]>([]);
  const [aiKeywords, setAiKeywords] = useState<string[]>([]);
  const lastFilesKey = useRef<string>('');

  const runVerification = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        setPhotoStatuses([]);
        onPhotoVerificationChange({
          verifying: false,
          allApproved: true,
          hasRejected: false,
          aiTags: [],
        });
        return;
      }
      setCheckingPhotos(true);
      onPhotoVerificationChange({
        verifying: true,
        allApproved: true,
        hasRejected: false,
        aiTags: [],
      });
      const statuses: ('pending' | 'done')[] = files.map(() => 'pending');
      setPhotoStatuses(statuses);

      const collectedKeywords: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const { base64, mimeType } = await fileToBase64Parts(file);
          const res = await fetch('/api/verify-mission-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: base64, mimeType }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            status?: string;
            keywords?: string[];
          };
          if (Array.isArray(data?.keywords) && data.keywords.length > 0) {
            for (const kw of data.keywords) {
              if (kw && !collectedKeywords.includes(kw)) {
                collectedKeywords.push(kw);
              }
            }
          }
        } catch {
          /* ignore — non-blocking */
        }
        statuses[i] = 'done';
        setPhotoStatuses([...statuses]);
      }

      if (collectedKeywords.length > 0) setAiKeywords(collectedKeywords.slice(0, 5));
      setCheckingPhotos(false);
      onPhotoVerificationChange({
        verifying: false,
        allApproved: true,
        hasRejected: false,
        aiTags: collectedKeywords.slice(0, 5),
      });
    },
    [onPhotoVerificationChange]
  );

  useEffect(() => {
    const key = orderPhotos.map((f) => `${f.name}-${f.size}-${f.lastModified}`).join('|');
    if (key === lastFilesKey.current) return;
    lastFilesKey.current = key;
    setAiKeywords([]);
    void runVerification(orderPhotos);
  }, [orderPhotos, runVerification]);

  useEffect(() => {
    const { textWarning: tw } = filterMissionDescription(orderDescription);
    onTextWarning?.(tw ?? null);
  }, [orderDescription, onTextWarning]);

  const handleDescriptionChange = (v: string) => {
    setOrderDescription(v);
    const r = validateMissionDescription(v);
    onDescriptionPolicyError(r.ok ? null : MISSION_DESCRIPTION_POLICY_ERROR);
    const { textWarning } = filterMissionDescription(v);
    onTextWarning?.(textWarning ?? null);
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
              {checkingPhotos && (
                <span className="text-[10px] text-cyan-300 animate-pulse">
                  {t('aiVerifyingPhoto')}
                </span>
              )}
            </div>
          )}
          {photoStatuses.length > 0 && (
            <ul className="mt-2 space-y-1 text-[10px] text-slate-400">
              {orderPhotos.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex justify-between gap-2">
                  <span className="truncate">{f.name}</span>
                  <span
                    className={
                      photoStatuses[i] === 'done'
                        ? 'text-emerald-400'
                        : 'text-amber-300'
                    }
                  >
                    {photoStatuses[i] === 'pending' || checkingPhotos
                      ? t('aiVerifyingPhotoShort')
                      : '✓'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div>
        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
          {t('shortDescriptionAndArea')}
        </label>
        <textarea
          value={orderDescription}
          onChange={(e) => handleDescriptionChange(e.target.value)}
          rows={2}
          placeholder={
            taskType === 'city' ? t('describeCitySpot') : t('describeHomeTask')
          }
          className={`w-full ${PROFILE_GLASS_PANEL} px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500 resize-none ${
            hasTextWarning ? 'border-b-2 border-dashed border-[#ea580c]' : ''
          }`}
        />
        {aiKeywords.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">
              {t('aiSuggestions') || 'AI suggestions'}:
            </span>
            {aiKeywords.map((kw) => (
              <button
                key={kw}
                type="button"
                onClick={() => {
                  const newVal =
                    orderDescription.trim() ? `${orderDescription.trim()} ${kw}` : kw;
                  setOrderDescription(newVal);
                  const r = validateMissionDescription(newVal);
                  onDescriptionPolicyError(r.ok ? null : MISSION_DESCRIPTION_POLICY_ERROR);
                  const { textWarning: tw } = filterMissionDescription(newVal);
                  onTextWarning?.(tw ?? null);
                }}
                className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-medium text-cyan-300 transition hover:bg-cyan-500/20 hover:border-cyan-400/60"
              >
                {kw}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default CreateMission;
