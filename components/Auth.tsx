import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

const Auth: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [isRegister, setIsRegister] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isRegister) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName, phone: phone },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        alert('Успех! Теперь проверьте вашу почту для подтверждения.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        alert('С возвращением!');
      }
    } catch (error: any) {
      alert('Ошибка: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#111111] border border-white/5 rounded-3xl p-8 w-full max-w-md mx-auto shadow-2xl shadow-[#39FF14]/5">
      <h2 className="text-2xl font-bold mb-6 text-center text-white">
        {isRegister ? 'Регистрация' : 'Вход'}
      </h2>
      
      <form onSubmit={handleAuth} className="space-y-4">
        {isRegister && (
          <>
            <input
              type="text"
              placeholder="Полное имя"
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-[#39FF14]/50 transition-colors"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
            <input
              type="text"
              placeholder="Телефон"
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-[#39FF14]/50 transition-colors"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </>
        )}
        <input
          type="email"
          placeholder="Email"
          className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-[#39FF14]/50 transition-colors"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Пароль"
          className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-[#39FF14]/50 transition-colors"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#39FF14] text-black font-bold py-4 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {loading ? 'Секунду...' : (isRegister ? 'Зарегистрироваться' : 'Войти')}
        </button>
      </form>
      
      <button
        type="button"
        onClick={() => setIsRegister(!isRegister)}
        className="w-full mt-4 text-sm text-[#BC13FE] hover:underline"
      >
        {isRegister ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Регистрация'}
      </button>
    </div>
  );
};

export default Auth;