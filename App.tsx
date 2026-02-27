import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabaseClient';
import Header from './components/Header';
// ... остальные импорты ...

const App: React.FC = () => {
  const [userProfile, setUserProfile] = useState({ xp: 0, level: 1 });
  const [session, setSession] = useState<any>(null);

  // 1. Следим за авторизацией
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
  }, []);

  // 2. ЗАГРУЗКА XP ИЗ SUPABASE
  useEffect(() => {
    if (session?.user) {
      const fetchProfile = async () => {
        // Предполагаем, что у вас есть таблица 'profiles' с колонками xp и level
        const { data, error } = await supabase
          .from('profiles')
          .select('xp, level')
          .eq('id', session.user.id)
          .single();

        if (data) {
          setUserProfile({ xp: data.xp, level: data.level });
        } else if (error) {
          console.error("Error loading profile:", error.message);
        }
      };

      fetchProfile();

      // Подписываемся на изменения профиля в реальном времени
      const profileChannel = supabase
        .channel('public:profiles')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${session.user.id}` },
        (payload) => {
          setUserProfile({ xp: payload.new.xp, level: payload.new.level });
        })
        .subscribe();

      return () => { supabase.removeChannel(profileChannel); };
    }
  }, [session]);

  return (
    <div className="h-screen w-full bg-black relative overflow-hidden">
      {/* ПЕРЕДАЕМ РЕАЛЬНЫЕ ДАННЫЕ В HEADER */}
      <Header
        language="en" // или ваш стейт языка
        toggleLanguage={() => {}}
        xp={userProfile.xp % 100} // Процент заполнения текущего уровня
        level={userProfile.level}
      />

      {/* ... остальной код Mapbox и бокового меню ... */}
    </div>
  );
};

export default App;
