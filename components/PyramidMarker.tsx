// src/components/PyramidMarker.tsx
import React from 'react';

interface PyramidProps {
  amount: number;
  label?: string;
}

export const PyramidMarker: React.FC<PyramidProps> = ({ amount, label }) => {
  // Определяем цвет на основе "Clean My Wallet" логики
  const isPremium = amount >= 5;
  const glowColor = isPremium ? 'rgba(168, 85, 247, 0.8)' : 'rgba(56, 189, 61, 0.8)';
  const textColor = isPremium ? '#a855f7' : '#38bd3d';

  return (
    <div className="relative flex flex-col items-center justify-center cursor-pointer group">
      {/* Сумма над пирамидой */}
      <div
        className="mb-1 px-2 py-0.5 rounded text-[10px] font-black italic border transition-all group-hover:scale-110"
        style={{ borderColor: textColor, color: textColor, backgroundColor: 'black' }}
      >
        {amount}$
      </div>

      {/* Сама пирамида (SVG) */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="w-10 h-10 drop-shadow-lg transition-transform"
        style={{ filter: `drop-shadow(0 0 8px ${glowColor})` }}
      >
        <path
          d="M12 2L2 22H22L12 2Z"
          stroke={textColor}
          strokeWidth="2"
          fill={isPremium ? "rgba(168, 85, 247, 0.2)" : "rgba(56, 189, 61, 0.2)"}
        />
        <path d="M12 2V22" stroke={textColor} strokeWidth="1" opacity="0.5" />
      </svg>
      
      {label && (
        <span className="text-[8px] uppercase tracking-tighter mt-1 text-gray-400">{label}</span>
      )}
    </div>
  );
};
