/**
 * Full-viewport cyberpunk splash — shown until Mapbox style + layers are ready.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';

export type MapBootSplashProps = {
  /** Soft exit after mapReady (opacity/pointer-events). */
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

  return (
    <div
      className={`fixed inset-0 z-[20000] flex flex-col items-center justify-center overflow-hidden bg-[#05060a] transition-opacity duration-500 ease-out ${
        visible
          ? 'opacity-100 pointer-events-auto'
          : 'opacity-0 pointer-events-none'
      }`}
      aria-busy={visible}
      aria-live="polite"
      role="status"
    >
      {/* Neon grid + vignette */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(34,211,238,0.07) 1px, transparent 1px),
            linear-gradient(90deg, rgba(34,211,238,0.07) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
          maskImage:
            'radial-gradient(ellipse 70% 60% at 50% 45%, black 20%, transparent 75%)',
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 55% 45% at 50% 40%, rgba(34,211,238,0.12), transparent 70%), radial-gradient(ellipse 80% 60% at 50% 100%, rgba(192,38,255,0.08), transparent 55%)',
        }}
        aria-hidden
      />

      <div className="relative flex flex-col items-center gap-6 px-6">
        <p
          className="select-none text-4xl font-black tracking-[0.18em] text-transparent sm:text-5xl"
          style={{
            backgroundImage:
              'linear-gradient(120deg, #22d3ee 0%, #a5f3fc 40%, #c026ff 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            textShadow: '0 0 28px rgba(34,211,238,0.45)',
            filter: 'drop-shadow(0 0 18px rgba(192,38,255,0.35))',
          }}
        >
          GarbaGin
        </p>

        {/* Neon ring loader */}
        <div className="relative h-14 w-14" aria-hidden>
          <span
            className="absolute inset-0 rounded-full border-2 border-cyan-400/25"
            style={{ boxShadow: '0 0 18px rgba(34,211,238,0.2) inset' }}
          />
          <span
            className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-cyan-300 border-r-fuchsia-400"
            style={{
              boxShadow: '0 0 16px rgba(34,211,238,0.55)',
              animationDuration: '0.85s',
            }}
          />
          <span className="absolute inset-[18%] rounded-full bg-cyan-400/20 blur-[1px]" />
        </div>

        <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-cyan-300/70">
          {phaseLabel}
        </p>
      </div>
    </div>
  );
};

export default MapBootSplash;
