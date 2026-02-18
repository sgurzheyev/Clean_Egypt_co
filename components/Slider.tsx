
import React from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  unit?: string;
  displayValue?: string;
  colorClass?: string;
}

const Slider: React.FC<SliderProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  unit,
  displayValue,
  colorClass = 'accent-teal-500',
}) => {
  const percentage = ((value - min) / (max - min)) * 100;
  
  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-2">
        <label className="text-lg font-bold text-gray-700">{label}</label>
        <span className="px-4 py-1 text-lg font-bold bg-white text-gray-800 rounded-full shadow-sm border border-gray-200">
          {displayValue || value} {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        className={`w-full h-4 bg-gray-200 rounded-full appearance-none cursor-pointer ${colorClass}`}
        style={{
          background: `linear-gradient(to right, ${colorClass.replace('accent', 'bg')}-500, ${colorClass.replace('accent', 'bg')}-500 ${percentage}%, #e5e7eb ${percentage}%)`
        }}
      />
    </div>
  );
};

export default Slider;
