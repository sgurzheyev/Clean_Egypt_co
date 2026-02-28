import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';

const TryFree: React.FC = () => {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  const handleFreeCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsSubmitting(true);

    try {
      // ПАРСИНГ: Сохраняем имейл в базу leads перед открытием карты
      const { error } = await supabase
        .from('leads')
        .insert([{ email, source: 'try_free_button', created_at: new Date() }]);

      if (error) console.error("Lead capture failed, but moving forward:", error.message);

      // Имитация "проверки" для солидности
      setTimeout(() => {
        setIsSubmitting(false);
        // Редиректим на карту, где теперь будет "туча пирамид"
        navigate('/?view=demo_active');
      }, 1500);

    } catch (err) {
      setIsSubmitting(false);
      navigate('/');
    }
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-[#0a0b0e] p-6">
      <div className="w-full max-w-md space-y-8 animate-in fade-in zoom-in duration-500">
        
        {/* Заголовок в твоем стиле */}
        <div className="text-center">
          <h2 className="text-4xl font-black italic tracking-tighter uppercase bg-clip-text text-transparent bg-gradient-to-r from-[#00f2ff] to-[#7000ff] mb-2">
            Clean<span className="text-white">Egypt</span>
          </h2>
          <p className="text-zinc-500 text-[10px] uppercase tracking-[0.2em] font-bold">
            Доступ в Cyber-Net: Бесплатная проверка
          </p>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 p-8 rounded-[2.5rem] backdrop-blur-xl shadow-2xl relative overflow-hidden">
          {isSubmitting && (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-10 flex flex-col items-center justify-center">
              <div className="w-10 h-10 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4"></div>
              <p className="text-cyan-500 text-[9px] font-mono animate-pulse">SEARCHING_ACTIVE_PYRAMIDS...</p>
            </div>
          )}

          <form onSubmit={handleFreeCheck} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-mono text-zinc-500 ml-4 uppercase tracking-widest">Target_Email</label>
              <input
                type="email"
                required
                placeholder="ВВЕДИ СВОЙ EMAIL..."
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-black/50 border border-zinc-800 p-5 rounded-2xl outline-none focus:border-cyan-500 text-white text-sm transition-all placeholder:text-zinc-700 font-bold"
              />
            </div>

            {/* Твоя кнопка "пушка-бомба" с градиентом */}
            <button
              type="submit"
              className="w-full py-5 bg-gradient-to-r from-[#00f2ff] to-[#7000ff] text-white font-black uppercase rounded-2xl hover:scale-[0.98] active:scale-95 transition-all shadow-[0_0_40px_rgba(0,242,255,0.25)]"
            >
              ПРОВЕРИТЬ БЕСПЛАТНО 🚀
            </button>
          </form>

          <p className="text-center text-[9px] text-zinc-600 mt-6 uppercase leading-relaxed">
            Нажимая кнопку, ты входишь в систему как независимый наблюдатель.<br/>
            Никаких списаний. Только данные.
          </p>
        </div>

        <button
          onClick={() => navigate('/')}
          className="w-full text-zinc-700 hover:text-zinc-400 text-[10px] uppercase font-bold transition-colors"
        >
          Вернуться к карте
        </button>
      </div>
    </div>
  );
};

export default TryFree;
