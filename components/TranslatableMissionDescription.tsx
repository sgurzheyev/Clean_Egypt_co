import React from 'react';
import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import MissionDescriptionText from './MissionDescriptionText';
import { useMissionTextTranslation } from '../src/hooks/useMissionTextTranslation';

type Props = {
  text: string | undefined | null;
  autoTranslate?: boolean;
  showTranslateButton?: boolean;
  className?: string;
  clampClassName?: string;
};

const TranslatableMissionDescription: React.FC<Props> = ({
  text,
  autoTranslate = true,
  showTranslateButton = false,
  className,
  clampClassName,
}) => {
  const { t } = useTranslation();
  const { displayText, loading, error, needsTranslation, translate, sourceText } =
    useMissionTextTranslation(text, { autoTranslate });

  if (!sourceText) return null;

  return (
    <div>
      <MissionDescriptionText
        text={displayText}
        className={className}
        clampClassName={clampClassName}
      />
      {loading && (
        <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-cyan-400/80 animate-pulse">
          {t('translating')}
        </p>
      )}
      {showTranslateButton && needsTranslation && (
        <button
          type="button"
          onClick={() => void translate()}
          disabled={loading}
          className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-400 transition-colors hover:text-cyan-300 disabled:cursor-wait disabled:opacity-60"
        >
          <Globe className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
          {loading ? t('translating') : t('translate')}
        </button>
      )}
      {error && !loading && (
        <p className="mt-1 text-xs text-red-300">{error}</p>
      )}
    </div>
  );
};

export default TranslatableMissionDescription;
