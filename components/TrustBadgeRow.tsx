/**
 * Glossy Zero-KYC community trust badge pills.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  TRUST_BADGE_DEFS,
  type TrustBadgeId,
} from '../src/lib/trustBadges';

export type TrustBadgeRowProps = {
  badges: TrustBadgeId[];
  /** Compact = smaller pills for feed / sidebar. */
  compact?: boolean;
  className?: string;
  /** Vertical stack (immersive sidebar). */
  vertical?: boolean;
};

const TrustBadgeRow: React.FC<TrustBadgeRowProps> = ({
  badges,
  compact = false,
  className = '',
  vertical = false,
}) => {
  const { t } = useTranslation();
  if (!badges.length) return null;

  return (
    <div
      className={`${
        vertical ? 'flex flex-col items-center gap-1.5' : 'flex flex-wrap gap-1.5'
      } ${className}`}
    >
      {badges.map((id) => {
        const def = TRUST_BADGE_DEFS[id];
        if (!def) return null;
        return (
          <span
            key={id}
            title={t(def.hintKey, { defaultValue: def.defaultHint })}
            className={`inline-flex items-center rounded-full border font-black uppercase tracking-[0.12em] backdrop-blur-md ${
              def.toneClass
            } ${
              compact
                ? 'px-1.5 py-0.5 text-[8px]'
                : 'px-2.5 py-1 text-[9px]'
            } ${vertical ? 'max-w-[4.5rem] justify-center text-center leading-tight' : ''}`}
          >
            {t(def.labelKey, { defaultValue: def.defaultLabel })}
          </span>
        );
      })}
    </div>
  );
};

export default TrustBadgeRow;
