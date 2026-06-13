import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  missionTextNeedsTranslation,
  translateMissionText,
} from '../lib/missionTranslation';

type Options = {
  autoTranslate?: boolean;
};

export function useMissionTextTranslation(
  sourceText: string | undefined | null,
  options?: Options
) {
  const { i18n } = useTranslation();
  const targetLanguage = (i18n.language || 'en').split('-')[0];
  const trimmed = String(sourceText ?? '').trim();
  const autoTranslate = options?.autoTranslate !== false;

  const needsTranslation = useMemo(
    () => missionTextNeedsTranslation(trimmed, targetLanguage),
    [trimmed, targetLanguage]
  );

  const [translated, setTranslated] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const translate = useCallback(async () => {
    if (!trimmed) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await translateMissionText(trimmed, targetLanguage);
      if (id !== requestId.current) return;
      setTranslated(result);
    } catch (e) {
      console.error('Mission text translation error:', e);
      if (id !== requestId.current) return;
      setTranslated(null);
      setError('Translation failed. Try again.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [trimmed, targetLanguage]);

  useEffect(() => {
    requestId.current += 1;
    setTranslated(null);
    setError(null);
    setLoading(false);

    if (!trimmed || !needsTranslation || !autoTranslate) return;

    const id = requestId.current;
    setLoading(true);
    translateMissionText(trimmed, targetLanguage)
      .then((result) => {
        if (id !== requestId.current) return;
        setTranslated(result);
        setError(null);
      })
      .catch((e) => {
        console.error('Mission text translation error:', e);
        if (id !== requestId.current) return;
        setTranslated(null);
        setError('Translation failed. Try again.');
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }, [trimmed, targetLanguage, needsTranslation, autoTranslate]);

  const displayText = translated ?? trimmed;

  return {
    displayText,
    sourceText: trimmed,
    translated,
    loading,
    error,
    needsTranslation,
    translate,
    isShowingTranslation: Boolean(translated),
  };
}
