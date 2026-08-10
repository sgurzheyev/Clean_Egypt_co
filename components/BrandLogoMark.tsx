/**
 * GarbaGin mark — circular ring + bold "G".
 * Color morph is driven by a Framer MotionValue (no React re-renders per frame).
 */
import React from 'react';
import { motion, useTransform, type MotionValue } from 'framer-motion';

/** Desktop / PWA icon colors (toxic lime G + electric cyan ring). */
export const LOGO_TOXIC_GREEN = '#b8ff00';
export const LOGO_ICON_RING = '#00e5ff';

/** In-app brand gradient stops (cyan → violet). */
export const LOGO_BRAND_CYAN = '#22d3ee';
export const LOGO_BRAND_MID = '#a5f3fc';
export const LOGO_BRAND_VIOLET = '#c026ff';

export type BrandLogoMarkProps = {
  size?: number;
  className?: string;
  /** Unique gradient id when multiple marks mount. */
  gradientId?: string;
  /** 0 = toxic desktop icon, 1 = brand cyan→violet gradient. */
  morph: MotionValue<number>;
  /** Soft pulse on the outer ring (CSS transform only). */
  pulseRing?: boolean;
  /** Fade the static ring out when the spinner takes over. */
  showRing?: boolean;
};

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function lerpHex(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const u = Math.min(1, Math.max(0, t));
  const r = Math.round(pa.r + (pb.r - pa.r) * u);
  const g = Math.round(pa.g + (pb.g - pa.g) * u);
  const bl = Math.round(pa.b + (pb.b - pa.b) * u);
  return `rgb(${r} ${g} ${bl})`;
}

function stopAt(t: number, bias: number): string {
  if (bias < 0.3) return lerpHex(LOGO_TOXIC_GREEN, LOGO_BRAND_CYAN, t);
  if (bias < 0.7) return lerpHex(LOGO_TOXIC_GREEN, LOGO_BRAND_MID, t);
  return lerpHex(LOGO_TOXIC_GREEN, LOGO_BRAND_VIOLET, t);
}

const BrandLogoMark: React.FC<BrandLogoMarkProps> = ({
  size = 112,
  className = '',
  gradientId = 'garbagin-logo-grad',
  morph,
  pulseRing = false,
  showRing = true,
}) => {
  const stop0 = useTransform(morph, (t) => stopAt(t, 0));
  const stop1 = useTransform(morph, (t) => stopAt(t, 0.45));
  const stop2 = useTransform(morph, (t) => stopAt(t, 1));
  const ringStroke = useTransform(morph, (t) =>
    lerpHex(LOGO_ICON_RING, LOGO_BRAND_CYAN, t)
  );

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      className={className}
      aria-hidden
      style={{
        display: 'block',
        transform: 'translateZ(0)',
        willChange: 'transform',
      }}
    >
      <defs>
        <linearGradient id={gradientId} x1="8%" y1="12%" x2="92%" y2="88%">
          <motion.stop offset="0%" style={{ stopColor: stop0 }} />
          <motion.stop offset="45%" style={{ stopColor: stop1 }} />
          <motion.stop offset="100%" style={{ stopColor: stop2 }} />
        </linearGradient>
      </defs>

      <motion.circle
        cx="64"
        cy="64"
        r="54"
        fill="none"
        strokeWidth="5.5"
        strokeLinecap="round"
        initial={false}
        animate={{ opacity: showRing ? 1 : 0 }}
        transition={{ duration: 0.35 }}
        style={{ stroke: ringStroke, transformOrigin: '64px 64px' }}
        className={pulseRing && showRing ? 'gg-logo-ring-pulse' : undefined}
      />

      {/* Bold G — same weight as the home-screen mark; fill is the morphing gradient. */}
      <text
        x="64"
        y="70"
        textAnchor="middle"
        fontFamily="'Nunito', system-ui, -apple-system, sans-serif"
        fontWeight="900"
        fontSize="78"
        letterSpacing="-0.04em"
        fill={`url(#${gradientId})`}
      >
        G
      </text>
    </svg>
  );
};

export default BrandLogoMark;
