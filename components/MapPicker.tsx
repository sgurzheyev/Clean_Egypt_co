import React from 'react';

const MapPicker: React.FC = () => {
  return (
    <div className="w-full h-48 bg-black/40 border border-[#39FF14]/20 rounded-2xl flex items-center justify-center">
      <p className="text-[#39FF14] text-[10px] uppercase font-black animate-pulse">
        GPS Signal Active...
      </p>
    </div>
  );
};

export default MapPicker;
