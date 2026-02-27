import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase'; // Исправляем путь, как мы делали в прошлый раз

const BidsTerminal = ({ onclose }: { onclose?: () => void }) => {
  const [task, setTask] = useState('');
  const [price, setPrice] = useState('');
  const [location, setLocation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [missions, setMissions] = useState<any[]>([]);

  // Загружаем список миссий
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
    setIsSubmitting(true); // ВКЛЮЧАЕТ СИНЮЮ ЗАГЛУШКУ

    try {
      const { data: { session } } = await supabase.auth.getSession();

      const { error } = await supabase
        .from('missions')
        .insert([
          {
            task_description: task,
            location: location,
            price: parseFloat(price),
            user_id: session?.user?.id,
            status: 'pending' // Добавляем статус для логики
          }
        ]);

      if (error) throw error;

      // ОЧИСТКА И ПЕРЕХОД
      setTask('');
      setPrice('');
      setLocation('');
      
      // Имитируем "Установку защищенного соединения" перед успехом
      setTimeout(() => {
        setIsSubmitting(false); // ВЫКЛЮЧАЕТ ЗАГЛУШКУ
        alert("Mission Uploaded to Cyber-Net! 🚀");
        if (onclose) onclose(); // Закрываем терминал, если передана функция
        fetchMissions();
      }, 2000);

    } catch (error: any) {
      alert('System Error: ' + error.message);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full bg-[#0a0a0a]/90 backdrop-blur-xl text-white p-6 font-sans rounded-3xl border border-zinc-800 shadow-2xl relative">
      {/* ЭКРАН ЗАГРУЗКИ (Синий оверлей) */}
      {isSubmitting && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 rounded-3xl backdrop-blur-md">
          <div className="w-16 h-16 border-4 border-[#BC13FE] border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-[#39FF14] font-mono animate-pulse tracking-tighter uppercase">
            Установка защищенного соединения...
          </p>
        </div>
      )}

      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8 border-b border-[#39FF14]/30 pb-4">
          <h1 className="text-3xl font-black italic tracking-widest uppercase bg-clip-text text-transparent bg-gradient-to-r from-[#39FF14] to-[#BC13FE]">
            Bids Terminal
          </h1>
          <span className="text-xs font-mono text-[#39FF14] bg-[#39FF14]/10 px-2 py-1 rounded border border-[#39FF14]/20">
            {missions.length} ACTIVE_MISSIONS
          </span>
        </div>

        {/* Форма */}
        <form onSubmit={handleSubmit} className="space-y-4 mb-10">
          <input
            type="text"
            placeholder="ОПИСАНИЕ ЗАДАЧИ"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            className="w-full bg-zinc-900/50 border border-zinc-800 p-4 rounded-xl focus:border-[#BC13FE] outline-none transition-all"
            required
          />
          <div className="flex gap-4">
            <input
              type="text"
              placeholder="ЛОКАЦИЯ"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="flex-1 bg-zinc-900/50 border border-zinc-800 p-4 rounded-xl outline-none focus:border-[#BC13FE]"
              required
            />
            <input
              type="number"
              placeholder="EGP"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-32 bg-zinc-900/50 border border-zinc-800 p-4 rounded-xl outline-none focus:border-[#BC13FE]"
              required
            />
          </div>
          <button
            type="submit"
            className="w-full py-4 bg-gradient-to-r from-[#39FF14] to-[#BC13FE] text-black font-black uppercase rounded-xl hover:opacity-90 transition-all shadow-[0_0_20px_rgba(57,255,20,0.3)]"
          >
            CLEAN MY WALLET 🚀
          </button>
        </form>

        {/* Список миссий */}
        <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
          {missions.map((m) => (
            <div key={m.id} className="p-4 bg-zinc-900/30 border border-zinc-800 rounded-xl flex justify-between items-center group hover:border-[#39FF14]/40">
              <div>
                <div className="text-[#39FF14] font-bold">{m.task_description}</div>
                <div className="text-[10px] text-zinc-500 font-mono">{m.location}</div>
              </div>
              <div className="text-[#BC13FE] font-black">{m.price} EGP</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default BidsTerminal;
