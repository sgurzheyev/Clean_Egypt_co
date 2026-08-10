/**
 * Full-viewport cyberpunk splash — logo morphs from desktop-icon palette
 * into the brand cyan→violet gradient, then the ring becomes the map loader.
 *
 * Perf: only transform / opacity / SVG stopColor (via MotionValues). No layout
 * thrashing; CSS keyframes handle continuous pulse/spin on the compositor.
 */
import React, { useEffect, useState } from 'react';
import { animate, motion, useMotionValue, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import BrandLogoMark from './BrandLogoMark';

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
  const reduceMotion = useReducedMotion();
  const morph = useMotionValue(reduceMotion ? 1 : 0);
  const [stage, setStage] = useState<'icon' | 'brand' | 'loader'>(
    reduceMotion ? 'loader' : 'icon'
  );

  const phaseLabel =
    phase === 'loading_map'
      ? t('mapBootLoadingMap', { defaultValue: 'Loading map…' })
      : t('mapBootLocating', { defaultValue: 'Acquiring position…' });

  // Hand off from the static HTML boot shell (#gg-boot-splash) so the mark
  // appears to keep its home-screen position instead of flashing.
  useEffect(() => {
    const boot = document.getElementById('gg-boot-splash');
    if (!boot) return;
    boot.style.opacity = '0';
    const tmr = window.setTimeout(() => boot.remove(), 280);
    return () => window.clearTimeout(tmr);
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      morph.set(1);
      setStage('loader');
      return;
    }

    // Desktop icon → brand gradient morph (GPU-friendly MotionValue).
    const morphCtrl = animate(morph, 1, {
      duration: 0.95,
      ease: [0.22, 1, 0.36, 1],
      delay: 0.18,
    });

    const brandTimer = window.setTimeout(() => setStage('brand'), 320);
    const loaderTimer = window.setTimeout(() => setStage('loader'), 980);

    return () => {
      morphCtrl.stop();
      window.clearTimeout(brandTimer);
      window.clearTimeout(loaderTimer);
    };
  }, [morph, reduceMotion]);

  const showLoader = stage === 'loader' || phase === 'loading_map';

  return (
    <motion.div
      className="fixed inset-0 z-[20000] flex flex-col items-center justify-center overflow-hidden bg-[#05060a]"
      initial={false}
      animate={{
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
      }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      aria-busy={visible}
      aria-live="polite"
      role="status"
    >
      {/* Neon grid + vignette — static paint, no per-frame work */}
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

      <div className="relative flex flex-col items-center gap-5 px-6">
        {/*
          Shared-element illusion: starts at ~home-screen icon size (72px) and
          eases up to the splash hero. OS splash → this mark share the same
          black canvas + centered G, so the jump feels continuous.
        */}
        <motion.div
          className="relative flex items-center justify-center"
          initial={
            reduceMotion
              ? false
              : { scale: 0.58, y: 18, opacity: 0.92 }
          }
          animate={{ scale: 1, y: 0, opacity: 1 }}
          transition={{
            duration: 0.85,
            ease: [0.16, 1, 0.3, 1],
          }}
          style={{ transform: 'translateZ(0)', willChange: 'transform' }}
        >
          {/* Soft brand glow — opacity only after morph begins */}
          <motion.div
            className="pointer-events-none absolute inset-[-28%] rounded-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: stage === 'icon' ? 0 : 0.85 }}
            transition={{ duration: 0.6 }}
            style={{
              background:
                'radial-gradient(circle, rgba(34,211,238,0.28) 0%, rgba(192,38,255,0.12) 45%, transparent 70%)',
            }}
            aria-hidden
          />

          <BrandLogoMark
            size={120}
            morph={morph}
            pulseRing={stage === 'brand'}
            showRing={!showLoader}
            gradientId="gg-boot-logo-grad"
          />

          {/* Ring morph → circular spinner (same center, compositor spin) */}
          <motion.div
            className="pointer-events-none absolute inset-[-2px] flex items-center justify-center"
            initial={false}
            animate={{ opacity: showLoader ? 1 : 0, scale: showLoader ? 1 : 0.86 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            aria-hidden
          >
            <span
              className="gg-logo-loader-spin block h-full w-full rounded-full border-[3px] border-transparent border-t-cyan-300 border-r-fuchsia-400"
              style={{
                boxShadow: '0 0 18px rgba(34,211,238,0.35)',
              }}
            />
          </motion.div>
        </motion.div>

        {/* Wordmark fades in as the G finishes its color morph */}
        <motion.p
          className="select-none text-3xl font-black tracking-[0.18em] text-transparent sm:text-4xl"
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          animate={{
            opacity: stage === 'icon' ? 0 : 1,
            y: stage === 'icon' ? 10 : 0,
          }}
          transition={{ duration: 0.45, ease: 'easeOut', delay: 0.05 }}
          style={{
            backgroundImage:
              'linear-gradient(120deg, #22d3ee 0%, #a5f3fc 40%, #c026ff 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            filter: 'drop-shadow(0 0 14px rgba(34,211,238,0.35))',
          }}
        >
          GarbaGin
        </motion.p>

        <motion.p
          className="text-[10px] font-bold uppercase tracking-[0.28em] text-cyan-300/75"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: showLoader ? 1 : 0 }}
          transition={{ duration: 0.35 }}
        >
          {phaseLabel}
        </motion.p>
      </div>
    </motion.div>
  );
};

export default MapBootSplash;
