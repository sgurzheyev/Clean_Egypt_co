import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase'; // Путь исправлен согласно структуре папок

interface BidsTerminalProps {
  onclose?: () => void;
}

const BidsTerminal: React.FC<BidsTerminalProps> = ({ onclose }) => {
  const [task, setTask] = useState('');
  const [price, setPrice] = useState('');
  const [location, setLocation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [missions, setMissions] = useState<any[]>([]);

  // Загружаем список активных миссий из Supabase
  useEffect(() => {
    fetchMissions();
  }, []);

  const fetchMissions = async () => {
    const { data, error } = await supabase
      .from('missions')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error) setMissions(data || []);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true); // Включает экран «Установка защищенного соединения»

    try {
      // Получаем ID текущего пользователя для привязки миссии
      const { data: { session } } = await supabase.auth.getSession();

      const { error } = await supabase
        .from('missions')
        .insert([
          {
            task_description: task,
            location: location,
            price: parseFloat(price),
            user_id: session?.user?.id,
            status: 'pending'
          }
        ]);

      if (error) throw error;

      // Имитируем процесс "Cyber-Net" соединения перед закрытием
      setTimeout(() => {
        setIsSubmitting(false); // Выключаем синюю заглушку
        
        // Очистка формы
        setTask('');
        setPrice('');
        setLocation('');

        // ФИНАЛЬНЫЙ ШАГ: Закрываем терминал автоматически
        if (onclose) {
          onclose();
        }
        
        console.log("Mission Uploaded to Cyber-Net! 🚀");
        fetchMissions();
      }, 2500);

    } catch (error: any) {
      console.error('System Error:', error.message);
      setIsSubmitting(false);
      alert('Connection Lost: ' + error.message);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto bg-[#0a0a0a]/95 backdrop-blur-2xl text-white p-6 font-sans rounded-3xl border border-zinc-800 shadow-[0_20px_50px_rgba(0,0,0,0.5)] relative overflow-hidden">
      
      {/* ЭКРАН ЗАГРУЗКИ (Синий оверлей) */}
      {isSubmitting && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#0a0b0e]/90 backdrop-blur-lg">
          <div className="w-20 h-20 border-4 border-[#00f2ff] border-t-transparent rounded-full animate-spin mb-6 shadow-[0_0_15px_#00f2ff]"></div>
          <p className="text-[#00f2ff] font-mono text-sm animate-pulse tracking-widest uppercase text-center px-4">
            Установка защищенного соединения...
          </p>
        </div>
      )}

      <div className="relative">
        {/* Заголовок в стиле CleanEgypt */}
        <div className="flex items-center justify-between mb-6 border-b border-[#39FF14]/20 pb-4">
          <h1 className="text-2xl font-black italic tracking-tighter uppercase bg-clip-text text-transparent bg-gradient-to-r from-[#39FF14] to-[#00f2ff]">
            Bids Terminal
          </h1>
          <button
            onClick={onclose}
            className="text-zinc-500 hover:text-white transition-colors"
          >
            [ ESC ]
          </button>
        </div>

        {/* Форма создания миссии */}
        <form onSubmit={handleSubmit} className="space-y-4 mb-8">
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-zinc-500 ml-2">MISSION_DETAILS</label>
            <input
              type="text"
              placeholder="ЧТО НУЖНО СДЕЛАТЬ?"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              className="w-full bg-zinc-900/50 border border-zinc-800 p-4 rounded-2xl focus:border-[#39FF14] outline-none transition-all placeholder:text-zinc-600 text-sm"
              required
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-[10px] font-mono text-zinc-500 ml-2">GEO_LOCATION</label>
              <input
                type="text"
                placeholder="ХУРГАДА, РАЙОН..."
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full bg-zinc-900/50 border border-zinc-800 p-4 rounded-2xl outline-none focus:border-[#39FF14] text-sm"
                required
              />
            </div>
            <div className="w-28 space-y-1">
              <label className="text-[10px] font-mono text-zinc-500 ml-2">BUDGET</label>
              <input
                type="number"
                placeholder="EGP"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full bg-zinc-900/50 border border-zinc-800 p-4 rounded-2xl outline-none focus:border-[#00f2ff] font-bold text-[#00f2ff]"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-5 bg-gradient-to-r from-[#39FF14] to-[#00f2ff] text-black font-black uppercase rounded-2xl hover:scale-[0.98] active:scale-95 transition-all shadow-[0_0_30px_rgba(57,255,20,0.2)] mt-4"
          >
            CLEAN MY WALLET 🚀
          </button>
        </form>

        {/* Списох последних миссий */}
        <div className="space-y-3 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
          <p className="text-[10px] font-mono text-[#39FF14]/50 mb-2 tracking-widest">LATEST_CYBER_BIDS:</p>
          {missions.map((m) => (
            <div key={m.id} className="p-4 bg-zinc-900/20 border border-zinc-800/50 rounded-2xl flex justify-between items-center group hover:border-[#39FF14]/30 transition-colors">
              <div>
                <div className="text-zinc-200 font-bold text-xs uppercase">{m.task_description}</div>
                <div className="text-[9px] text-zinc-500 font-mono mt-1">{m.location}</div>
              </div>
              <div className="text-[#00f2ff] font-black text-sm">{m.price} EGP</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default BidsTerminal;
