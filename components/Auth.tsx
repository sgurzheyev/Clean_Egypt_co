import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import PaymentOverlay from './PaymentOverlay'; // Импортируем наш новый компонент

const Auth: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [isRegister, setIsRegister] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPayment, setShowPayment] = useState(false); // Состояние для показа оплаты

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Если это регистрация — сначала показываем оплату
    if (isRegister) {
      setShowPayment(true);
      return;
    }

    // Если это вход — обычная логика
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (error: any) {
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // Эту функцию можно вызвать из PaymentOverlay после успешного колбэка от Paymob
  const finalizeRegistration = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin }
      });
      if (error) throw error;
      alert('Миссия активирована! Проверьте почту для подтверждения.');
      setShowPayment(false);
    } catch (error: any) {
      alert('Ошибка: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="bg-[#111111] p-8 rounded-[2.5rem] w-full max-w-sm border border-white/5 shadow-2xl">
        <h2 className="text-2xl font-black mb-6 text-center italic text-[#39FF14] tracking-tighter uppercase">
          {isRegister ? 'Join Mission' : 'Welcome Back'}
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
            className="w-full bg-gradient-to-r from-[#39FF14] to-[#BC13FE] text-black font-black py-5 rounded-2xl uppercase italic hover:scale-[1.02] active:scale-95 transition-all mt-4 disabled:opacity-50 shadow-[0_0_20px_rgba(57,255,20,0.2)]"
          >
            {loading ? 'Processing...' : (isRegister ? 'Get Started 🚀' : 'Sign In ⚡')}
          </button>
        </form>

        <button
          onClick={() => setIsRegister(!isRegister)}
          className="w-full mt-6 text-[11px] font-bold text-zinc-500 hover:text-[#BC13FE] transition-colors uppercase tracking-widest"
        >
          {isRegister ? 'Already an Eco-Hero? Login' : 'New to CleanEgypt? Register'}
        </button>
      </div>

      {/* Оверлей оплаты */}
      {showPayment && (
        <PaymentOverlay
          onClose={() => setShowPayment(false)}
        />
      )}
    </>
  );
};

export default Auth;
