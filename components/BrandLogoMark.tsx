/**
 * GarbaGin mark — circular ring + bold "G" with the brand cyan→violet gradient.
 * Static SVG only (no color morph / MotionValues) so splash paints instantly.
 */
import React from 'react';

export const LOGO_BRAND_CYAN = '#22d3ee';
export const LOGO_BRAND_MID = '#a5f3fc';
export const LOGO_BRAND_VIOLET = '#c026ff';
export const LOGO_ICON_RING = '#00e5ff';

export type BrandLogoMarkProps = {
  size?: number;
  className?: string;
  /** Unique gradient id when multiple marks mount. */
  gradientId?: string;
};

const BrandLogoMark: React.FC<BrandLogoMarkProps> = ({
  size = 112,
  className = '',
  gradientId = 'garbagin-logo-grad',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 128 128"
    className={className}
    aria-hidden
    style={{ display: 'block' }}
  >
    <defs>
      <linearGradient id={gradientId} x1="8%" y1="12%" x2="92%" y2="88%">
        <stop offset="0%" stopColor={LOGO_BRAND_CYAN} />
        <stop offset="45%" stopColor={LOGO_BRAND_MID} />
        <stop offset="100%" stopColor={LOGO_BRAND_VIOLET} />
      </linearGradient>
    </defs>

    <circle
      cx="64"
      cy="64"
      r="54"
      fill="none"
      stroke={LOGO_ICON_RING}
      strokeWidth="5.5"
      strokeLinecap="round"
    />

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

export default BrandLogoMark;
