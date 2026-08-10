/**
 * Lightweight map boot splash — static brand mark + CSS spinner + status text.
 * Heavy logo morph / color shifts live on the OS / PWA splash only (manifest +
 * theme-color); in-app we stay compositor-cheap so Mapbox can init without jank.
 */
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import BrandLogoMark from './BrandLogoMark';

export type MapBootSplashProps = {
  /** Soft exit after map is fully ready (opacity/pointer-events). */
  visible: boolean;
  /** Phase label under the wordmark. */
  phase?: 'locating' | 'loading_map';
};

const MapBootSplash: React.FC<MapBootSplashProps> = ({
  visible,
  phase = 'locating',
}) => {
  const { t } = useTranslation();

  const phaseLabel =
    phase === 'loading_map'
      ? t('mapBootLoadingMap', { defaultValue: 'Loading map…' })
      : t('mapBootLocating', { defaultValue: 'Acquiring position…' });

  // Hand off from the static HTML boot shell (#gg-boot-splash).
  useEffect(() => {
    const boot = document.getElementById('gg-boot-splash');
    if (!boot) return;
    boot.style.opacity = '0';
    const tmr = window.setTimeout(() => boot.remove(), 220);
    return () => window.clearTimeout(tmr);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[20000] flex flex-col items-center justify-center overflow-hidden bg-[#05060a] transition-opacity duration-500 ease-out"
      style={{
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
      }}
      aria-busy={visible}
      aria-live="polite"
      role="status"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.3]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(34,211,238,0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(34,211,238,0.06) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
          maskImage:
            'radial-gradient(ellipse 70% 60% at 50% 45%, black 20%, transparent 75%)',
        }}
        aria-hidden
      />

      <div className="relative flex flex-col items-center gap-5 px-6">
        <div className="relative flex h-[7.5rem] w-[7.5rem] items-center justify-center">
          {/* Lightweight circular spinner — transform-only CSS */}
          <span
            className="gg-logo-loader-spin pointer-events-none absolute inset-0 rounded-full border-[3px] border-transparent border-t-cyan-300/90 border-r-fuchsia-400/80"
            aria-hidden
          />
          <BrandLogoMark size={96} gradientId="gg-boot-logo-grad" />
        </div>

        <p
          className="select-none text-3xl font-black tracking-[0.18em] text-transparent sm:text-4xl"
          style={{
            backgroundImage:
              'linear-gradient(120deg, #22d3ee 0%, #a5f3fc 40%, #c026ff 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
          }}
        >
          GarbaGin
        </p>

        <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-cyan-300/75">
          {phaseLabel}
        </p>
      </div>
    </div>
  );
};

export default MapBootSplash;
