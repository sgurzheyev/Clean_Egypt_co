import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
const Auth: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [isRegister, setIsRegister] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isRegister) {
        // Регистрация нового аккаунта
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin }
        });
        if (error) throw error;
        alert('Check your email to confirm registration!');
      } else {
        // Вход в существующий аккаунт
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error: any) {
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#111111] p-8 rounded-[2.5rem] w-full max-w-sm border border-white/5 shadow-2xl">
      <h2 className="text-2xl font-black mb-6 text-center italic text-[#39FF14] tracking-tighter">
        {isRegister ? 'JOIN MISSION' : 'WELCOME BACK'}
      </h2>
      
      <form onSubmit={handleAuth} className="space-y-4">
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-zinc-500 uppercase ml-4">Email Address</label>
          <input
            type="email"
            placeholder="sergio@cleanegypt.co"
            className="w-full bg-black p-4 rounded-2xl border border-white/10 focus:border-[#39FF14] outline-none transition-all text-white"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold text-zinc-500 uppercase ml-4">Password</label>
          <input
            type="password"
            placeholder="••••••••"
            className="w-full bg-black p-4 rounded-2xl border border-white/10 focus:border-[#BC13FE] outline-none transition-all text-white"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-gradient-to-r from-[#39FF14] to-[#BC13FE] text-black font-black py-5 rounded-2xl uppercase italic hover:scale-[1.02] active:scale-95 transition-all mt-4 disabled:opacity-50"
        >
          {loading ? 'Processing...' : (isRegister ? 'Create Account 🚀' : 'Sign In ⚡')}
        </button>
      </form>

      <button
        onClick={() => setIsRegister(!isRegister)}
        className="w-full mt-6 text-[11px] font-bold text-zinc-500 hover:text-[#BC13FE] transition-colors uppercase tracking-widest"
      >
        {isRegister ? 'Already an Eco-Hero? Login' : 'New to CleanEgypt? Register'}
      </button>
    </div>
  );
};

export default Auth;
