import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient'; // Подключаем нашу базу

const BidsTerminal = () => {
  const [task, setTask] = useState('');
  const [price, setPrice] = useState('');
  const [location, setLocation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [missions, setMissions] = useState<any[]>([]);

  // Загружаем список миссий при открытии страницы
  useEffect(() => {
    fetchMissions();
  }, []);

  const fetchMissions = async () => {
    const { data, error } = await supabase
      .from('missions')
      .select('*')
      .order('created_at', { ascending: false }); // Новые сверху

    if (error) {
      console.error('Ошибка загрузки миссий:', error);
    } else {
      setMissions(data || []);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Получаем текущего пользователя, чтобы привязать заявку к нему
    const { data: { session } } = await supabase.auth.getSession();

    // Отправляем данные в нашу новую таблицу missions
    const { error } = await supabase
      .from('missions')
      .insert([
        {
          task_description: task,
          location: location,
          price: parseFloat(price),
          user_id: session?.user?.id
        }
      ]);

    setIsSubmitting(false);

    if (error) {
      alert('Ошибка системы: ' + error.message);
    } else {
      // Очищаем форму и обновляем ленту
      setTask('');
      setPrice('');
      setLocation('');
      fetchMissions();
    }
  };

  return (
    <div className="w-full bg-[#0a0a0a]/80 backdrop-blur-md text-white p-6 font-sans rounded-3xl border border-zinc-800">
      <div className="max-w-2xl mx-auto">
        
        {/* Заголовок терминала */}
        <div className="flex items-center justify-between mb-8 border-b border-[#39FF14]/30 pb-4">
          <h1 className="text-3xl font-black italic tracking-widest uppercase bg-clip-text text-transparent bg-gradient-to-r from-[#39FF14] to-[#BC13FE]">
            Bids Terminal
          </h1>
          <span className="text-xs font-mono text-[#39FF14] bg-[#39FF14]/10 px-2 py-1 rounded border border-[#39FF14]/20 animate-pulse">
            LIVE_MARKET
          </span>
        </div>

        {/* Форма создания заявки */}
        <div className="bg-black/50 p-6 rounded-2xl border border-zinc-800 shadow-[0_0_15px_rgba(188,19,254,0.05)] mb-10 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#39FF14] to-[#BC13FE]"></div>
          
          <h2 className="text-xl font-bold mb-4 text-[#BC13FE]">Create New Mission</h2>
          
          <form onSubmit={handleSubmit} className="space-y-4 font-mono text-sm">
            <div>
              <label className="block text-zinc-400 mb-1">What needs to be clean?</label>
              <input
                type="text"
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="e.g. 2-bedroom apartment deep clean"
                className="w-full bg-[#111] border border-zinc-800 rounded-lg p-3 text-white focus:outline-none focus:border-[#BC13FE] transition-colors"
                required
              />
            </div>
            
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-zinc-400 mb-1">City / Area</label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Hurghada, Marina"
                  className="w-full bg-[#111] border border-zinc-800 rounded-lg p-3 text-white focus:outline-none focus:border-[#BC13FE] transition-colors"
                  required
                />
              </div>
              <div className="flex-1">
                <label className="block text-zinc-400 mb-1">Your Price (EGP)</label>
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="e.g. 500"
                  className="w-full bg-[#111] border border-zinc-800 rounded-lg p-3 text-white focus:outline-none focus:border-[#BC13FE] transition-colors"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-4 bg-gradient-to-r from-[#39FF14] to-[#BC13FE] text-black font-bold py-4 rounded-xl uppercase italic hover:scale-[1.02] active:scale-95 transition-all tracking-widest shadow-[0_0_20px_rgba(57,255,20,0.2)] disabled:opacity-50"
            >
              {isSubmitting ? 'Uploading...' : 'Post Mission 🚀'}
            </button>
          </form>
        </div>

        {/* Лента открытых заявок */}
        <div>
          <h2 className="text-xl font-bold mb-4 text-[#39FF14]">Available Missions</h2>
          
          <div className="space-y-4 max-h-80 overflow-y-auto pr-2 custom-scrollbar">
            {missions.length === 0 ? (
              <p className="text-zinc-500 font-mono text-sm">No active missions yet. Be the first!</p>
            ) : (
              missions.map((mission) => (
                <div key={mission.id} className="bg-zinc-900/40 p-4 rounded-xl border border-zinc-800 flex justify-between items-center hover:border-[#39FF14]/50 transition-colors group">
                  <div>
                    <h3 className="font-bold text-white group-hover:text-[#39FF14] transition-colors">{mission.task_description}</h3>
                    <p className="text-xs text-zinc-400 font-mono mt-1">📍 {mission.location}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-black text-[#BC13FE]">{mission.price} EGP</div>
                    <button className="text-xs bg-zinc-800 text-zinc-300 px-3 py-1 rounded hover:bg-[#39FF14] hover:text-black transition-colors mt-1">
                      ACCEPT
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default BidsTerminal;
