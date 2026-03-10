import React from 'react';

// Интерфейс данных маркера на основе твоей SQL структуры
interface JobMarkerProps {
  amount: number;       // Сумма заказа ($1 - $500)
  orderType: 'home' | 'city'; // Тип: Дом (золото) или Город (градиент)
  label?: string;       // Текст задания
}

const JobMarker: React.FC<JobMarkerProps> = ({ amount, orderType, label }) => {
  
  // 1. Расчет РАЗМЕРА: от 20px (минимум) до 120px (максимум для $500)
  // Масштабируем так, чтобы "жирные" заказы были реально огромными на карте
  const size = Math.min(20 + (amount / 500) * 100, 120);

  // 2. Расчет ЦВЕТА и СВЕЧЕНИЯ
  let mainColor = '#38bd3d'; // Дефолтный зеленый
  let glowColor = 'rgba(56, 189, 61, 0.6)';

  if (orderType === 'home') {
    // ЗОЛОТО для CleanMyHome ($5 - $500)
    mainColor = '#FFD700';
    glowColor = 'rgba(255, 215, 0, 0.8)';
  } else {
    // ГРАДИЕНТ для City Cleanup ($1 - $100)
    // Зеленый -> Синий -> Пурпурный
    if (amount >= 70) {
      mainColor = '#a855f7'; // Пурпурный
      glowColor = 'rgba(168, 85, 247, 0.8)';
    } else if (amount >= 30) {
      mainColor = '#0000FF'; // Синий
      glowColor = 'rgba(0, 0, 255, 0.7)';
    }
  }

  return (
    <div className="relative flex items-center justify-center group cursor-pointer">
      {/* Контейнер пирамиды с динамическим размером и свечением */}
      <div
        style={{
          width: `${size}px`,
          height: `${size}px`,
          filter: `drop-shadow(0 0 ${size / 3}px ${glowColor})`
        }}
        className="relative transition-transform duration-500 hover:scale-110"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full"
        >
          {/* Основное тело пирамиды */}
          <path
            d="M12 2L2 22H22L12 2Z"
            fill={mainColor}
            fillOpacity="0.3"
            stroke={mainColor}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          {/* Внутренняя грань для 3D эффекта как на концепте */}
          <path
            d="M12 2V22M12 2L22 22"
            stroke={mainColor}
            strokeWidth="1"
            strokeOpacity="0.5"
          />
        </svg>

        {/* Отображение суммы по центру пирамиды: уменьшенная зона + адаптивный шрифт */}
        {(() => {
          const baseFontSize = Math.max(size / 4, 8);
          const digitCount = String(amount).length + 1; // +1 за символ $
          const scale = digitCount >= 4 ? 0.55 : digitCount >= 3 ? 0.75 : 1;
          const fontSize = Math.max(Math.round(baseFontSize * scale), 6);
          return (
            <div
              className="absolute inset-[18%] flex items-center justify-center text-white font-black italic drop-shadow-md overflow-hidden"
              style={{ fontSize: `${fontSize}px` }}
            >
              <span className="truncate max-w-full leading-none">{amount}$</span>
            </div>
          );
        })()}
      </div>

      {/* Текст задания (появляется при наведении или всегда для больших пирамид) */}
      {label && (
        <div className="absolute -bottom-10 bg-black/80 backdrop-blur-sm border border-white/10 px-3 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
          <p className="text-[10px] text-white font-bold uppercase tracking-widest">{label}</p>
        </div>
      )}
    </div>
  );
};

export default JobMarker;
