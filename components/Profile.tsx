import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const Profile: React.FC = () => {
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => {
    const fetchProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        setProfile(data);
      }
    };
    fetchProfile();
  }, []);

  if (!profile) return <div className="min-h-screen bg-black flex items-center justify-center text-cyan-500">LOADING HERO DATA...</div>;

  return (
    <div className="min-h-screen bg-black text-white p-6 flex flex-col items-center">
      {/* Шапка как на твоем концепте */}
      <div className="mt-10 text-center">
        <h1 className="text-4xl font-black italic tracking-tighter uppercase">Eco-Hero</h1>
        <p className="text-cyan-400 text-xl font-bold italic">Lv. {profile.level || 12}</p>
      </div>

      {/* Полоска опыта XP */}
      <div className="w-full max-w-xs h-3 bg-zinc-900 rounded-full mt-6 overflow-hidden border border-white/5">
        <div 
          className="h-full bg-gradient-to-r from-cyan-500 to-green-500 shadow-[0_0_15px_#06b6d4]" 
          style={{ width: `${(profile.xp % 100) || 74}%` }}
        ></div>
      </div>

      {/* Статус Пирамиды */}
      <div className="mt-20 relative">
        <div className={`w-40 h-40 transition-all duration-1000 ${profile.pyramid_status === 'gold' ? 'scale-110 shadow-[0_0_50px_#FFD700]' : ''}`}>
           <svg viewBox="0 0 24 24" fill={profile.pyramid_status === 'gold' ? '#FFD700' : '#38bd3d'}>
              <path d="M12 2L2 22H22L12 2Z" />
           </svg>
        </div>
        <p className="text-center mt-4 font-black italic uppercase tracking-widest text-zinc-500">
          Status: <span className={profile.pyramid_status === 'gold' ? 'text-yellow-500' : 'text-cyan-500'}>
            {profile.pyramid_status || 'ACTIVE'}
          </span>
        </p>
      </div>

      <button 
        onClick={() => window.location.href = '/'}
        className="mt-auto mb-10 w-full max-w-xs py-4 bg-zinc-900 rounded-2xl font-bold uppercase tracking-widest border border-white/5"
      >
        Back to Map
      </button>
    </div>
  );
};

export default Profile;